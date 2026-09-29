import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { after, test } from "node:test";
import { withSessions } from "./fake-session.mjs";

// Text-mode interviewer turns with Workers AI faked. Reviews are covered by
// test/reviews.test.mjs; `test/llm-integration.mjs` runs these flows against real PostgreSQL.
const directory = await mkdtemp(join(tmpdir(), "llm-"));
after(() => rm(directory, { recursive: true, force: true }));
await build({ entryPoints: ["src/request-handler.ts"], outdir: directory, outExtension: { ".js": ".mjs" }, bundle: true, format: "esm", platform: "node" });
const { handleRequest } = await import(pathToFileURL(join(directory, "request-handler.mjs")));
const handle = withSessions(handleRequest);

const calls = [];
const env = { BETTER_AUTH_URL: "https://app.example", PERSONAL_DATA_COLLECTION_APPROVED: "true" };
function provider(respond) {
  // `run` uses `this`, like the real binding, so a detached call fails here too.
  env.AI = { calls, async run(model, input) {
    this.calls.push({ model, ...input });
    return respond();
  } };
}
const message = (text) => ({ choices: [{ finish_reason: "stop", message: { role: "assistant", content: text } }] });
const outage = () => { throw new Error("3040: Capacity temporarily exceeded"); };

// A minimal in-memory stand-in for the queries a text message issues.
function database() {
  const writes = [];
  const pool = { writes, release() {}, async connect() { return pool; }, async query(sql, values = []) {
    if (/^(BEGIN|COMMIT|ROLLBACK)/.test(sql)) return { rows: [] };
    if (sql.startsWith("INSERT INTO security_rate_limits")) return { rows: [{ count: 1 }] };
    if (sql.startsWith("SELECT * FROM attempts")) return { rows: [{ id: "a1", user_id: "owner", problem_id: "p", mode: "mock", input_mode: "text", status: "active", draft_source: "def f():\n    pass\n", created_at: new Date() }] };
    if (sql.startsWith("SELECT status FROM attempts")) return { rows: [{ status: "active" }] };
    if (sql.startsWith("SELECT count(*)")) return { rows: [{ count: "0" }] };
    if (sql.startsWith("SELECT speaker, text FROM transcript_segments")) return { rows: [{ speaker: "candidate", text: "Hello" }] };
    if (sql.includes("t.end_offset_ms FROM attempt_events")) return { rows: writes.some((write) => write.sql.includes("INSERT INTO transcript_segments") && write.values[3] === "interviewer") ? [{ id: "reply", speaker: "interviewer", text: "Why?", end_offset_ms: 5 }] : [] };
    if (/^(INSERT|UPDATE)/.test(sql)) { writes.push({ sql, values }); return { rows: [{ id: values[0] }] }; }
    return { rows: [] };
  } };
  return pool;
}
const sendMessage = (pool) => handle(new Request("https://app.example/api/attempts/a1/messages", { method: "POST", headers: { origin: "https://app.example", "content-type": "application/json" }, body: JSON.stringify({ text: "Hello", sourceId: "m1", sourceOrder: 1, occurrenceOffsetMs: 1 }) }), env, {}, pool);

test("a text message returns and stores the interviewer reply", async () => {
  provider(() => message("Why?"));
  const pool = database();
  const body = await (await sendMessage(pool)).json();
  assert.deepEqual(body.reply, { eventId: "reply", speaker: "interviewer", text: "Why?", occurrenceOffsetMs: 5 });
  assert.equal(calls.at(-1).model, "@cf/moonshotai/kimi-k2.6");
  assert.equal(calls.at(-1).reasoning_effort, "none");
  assert.equal(calls.at(-1).messages[0].role, "system");
  assert.ok(pool.writes.some((write) => write.sql.includes("INSERT INTO attempt_events") && write.values[2] === "interviewer_text"));
});

test("a provider failure keeps the candidate message and returns no reply", async () => {
  provider(outage);
  const pool = database();
  const response = await sendMessage(pool);
  assert.equal(response.status, 201);
  const body = await response.json();
  assert.equal(body.reply, null);
  assert.match(body.replyError, /no reply was generated/);
  assert.ok(pool.writes.some((write) => write.sql.includes("INSERT INTO transcript_segments") && write.values[3] === "Hello"));
  assert.ok(!pool.writes.some((write) => write.values?.[2] === "interviewer_text"));
});
