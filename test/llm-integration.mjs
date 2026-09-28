import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import pg from "pg";

// Exercises text interviewer turns against real PostgreSQL with a fake Workers AI
// binding. It never calls the real provider. Reviews: test/review-integration.mjs.
if (!process.env.DATABASE_URL) throw new Error("Set DATABASE_URL to a disposable local PostgreSQL instance.");
const schema = `llm_test_${crypto.randomUUID().replaceAll("-", "")}`;
const admin = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const database = new pg.Pool({ connectionString: process.env.DATABASE_URL, options: `-c search_path=${schema}` });
const directory = await mkdtemp(join(tmpdir(), "llm-integration-"));
const calls = [];
let reply = () => ({ text: "unused" });
const AI = { calls, async run(model, input) {
  this.calls.push({ model, ...input });
  const next = reply(input);
  return { choices: [{ finish_reason: next.stop ?? "stop", message: { role: "assistant", content: next.text } }] };
} };
const outage = () => { throw new Error("3040: Capacity temporarily exceeded"); };
try {
  await admin.query(`CREATE SCHEMA ${schema}`);
  for (const path of ["migrations/auth/0000_colorful_vindicator.sql", "migrations/0002_application.sql", "migrations/0003_security.sql"]) {
    await database.query((await readFile(path, "utf8")).replaceAll('"public".', `"${schema}".`));
  }
  await build({ entryPoints: ["src/api.ts"], outdir: directory, outExtension: { ".js": ".mjs" }, bundle: true, format: "esm", platform: "node", plugins: [{ name: "auth", setup(plugin) {
    plugin.onResolve({ filter: /^\.\/auth$/ }, () => ({ path: "auth", namespace: "test" }));
    plugin.onLoad({ filter: /.*/, namespace: "test" }, () => ({ contents: 'export const authenticatedUserId = async () => "owner"; export const passwordMatches = async () => false;' }));
  } }] });
  const { handleApi } = await import(pathToFileURL(join(directory, "api.mjs")));
  const origin = "https://app.example";
  const env = { BETTER_AUTH_URL: origin, PERSONAL_DATA_COLLECTION_APPROVED: "true", AI, REVIEW_QUEUE: { send: async () => {} } };
  const post = (path, body) => handleApi(new Request(`${origin}/api/attempts/text/${path}`, { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify(body) }), env, {}, database);
  const rows = async (sql, values = []) => (await database.query(sql, values)).rows;

  await database.query("INSERT INTO users (id, display_name, email) VALUES ('owner', 'Owner', 'owner@example.invalid')");
  await database.query("INSERT INTO attempts (id, user_id, problem_id, mode, input_mode, status, setup_context, consent_at, disclosure_version, practice_goal, draft_source) VALUES ('text', 'owner', 'sum-odd-positions-v1', 'mock', 'text', 'active', '{}', now(), 'test', 'Practice', 'def sum_odd_positions(values):\n    return 0\n')");

  // A reply is generated, stored, and returned once.
  reply = () => ({ text: "What should happen for an empty list?" });
  let response = await post("messages", { text: "I will loop over the odd indexes.", sourceId: "message-1", sourceOrder: 1, occurrenceOffsetMs: 100 });
  assert.equal(response.status, 201);
  const first = await response.json();
  assert.equal(first.reply.text, "What should happen for an empty list?");
  assert.equal(first.reply.speaker, "interviewer");
  assert.equal(calls.at(-1).model, "@cf/moonshotai/kimi-k2.6");
  const [system, ...turns] = calls.at(-1).messages;
  assert.match(system.content, /return 0/, "the prompt includes the saved draft");
  assert.deepEqual(turns, [{ role: "user", content: "I will loop over the odd indexes." }]);
  assert.doesNotMatch(system.content, /values\[1::2\]/, "the reference solution never reaches the interviewer");
  response = await post("messages", { text: "I will loop over the odd indexes.", sourceId: "message-1", sourceOrder: 1, occurrenceOffsetMs: 100 });
  assert.deepEqual((await response.json()).reply, first.reply, "a repeated message returns the stored reply");
  assert.equal(calls.length, 1, "a repeated message does not call the model again");
  const stored = await rows("SELECT e.event_type, t.speaker FROM attempt_events e JOIN transcript_segments t ON t.event_id = e.id WHERE e.attempt_id = 'text' ORDER BY t.end_offset_ms");
  assert.deepEqual(stored.map((row) => [row.event_type, row.speaker]), [["candidate_text", "candidate"], ["interviewer_text", "interviewer"]]);

  // Provider failure: the candidate message stays; no reply is invented.
  reply = outage;
  response = await post("messages", { text: "Is the list ever empty?", sourceId: "message-2", sourceOrder: 2, occurrenceOffsetMs: 200 });
  assert.equal(response.status, 201);
  const failed = await response.json();
  assert.equal(failed.reply, null);
  assert.match(failed.replyError, /no reply was generated/);
  assert.equal((await rows("SELECT id FROM transcript_segments WHERE event_id = $1", [failed.eventId])).length, 1);
  assert.equal((await rows("SELECT id FROM attempt_events WHERE event_type = 'interviewer_text'")).length, 1);

  // Requested help in text mode is delivered and recorded.
  reply = () => ({ text: "Which indexes does the slice start from?" });
  response = await post("help", { category: "hint", sourceId: "help-1", sourceOrder: 3, occurrenceOffsetMs: 300 });
  const help = await response.json();
  assert.equal(help.delivered, true);
  assert.match(calls.at(-1).messages.at(-1).content, /asked for a hint/);
  assert.deepEqual(await rows("SELECT delivered, content FROM assistance_events WHERE event_id = $1", [help.eventId]), [{ delivered: true, content: "Which indexes does the slice start from?" }]);
  console.log("Workers AI text replies, stored-reply reuse, provider failure and requested help passed.");
} finally {
  await database.end();
  await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  await admin.end();
  await rm(directory, { recursive: true, force: true });
}
