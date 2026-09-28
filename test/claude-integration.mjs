import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import pg from "pg";

// Exercises reviews and text interviewer turns against real PostgreSQL with a
// fake Anthropic API. It never calls the real provider.
if (!process.env.DATABASE_URL) throw new Error("Set DATABASE_URL to a disposable local PostgreSQL instance.");
const schema = `claude_test_${crypto.randomUUID().replaceAll("-", "")}`;
const admin = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const database = new pg.Pool({ connectionString: process.env.DATABASE_URL, options: `-c search_path=${schema}` });
const directory = await mkdtemp(join(tmpdir(), "claude-integration-"));
const originalFetch = globalThis.fetch;
const calls = [];
let reply = () => ({ text: "unused" });
const message = (text, stop = "end_turn") => Response.json({ id: "msg_test", type: "message", role: "assistant", model: "fake", content: [{ type: "text", text }], stop_reason: stop, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } });
globalThis.fetch = async (url, init) => {
  assert.equal(String(url), "https://api.anthropic.com/v1/messages");
  const body = JSON.parse(init.body);
  calls.push(body);
  const next = reply(body);
  return next instanceof Response ? next : message(next.text, next.stop);
};
try {
  await admin.query(`CREATE SCHEMA ${schema}`);
  for (const path of ["migrations/auth/0000_colorful_vindicator.sql", "migrations/0002_application.sql", "migrations/0003_security.sql"]) {
    await database.query((await readFile(path, "utf8")).replaceAll('"public".', `"${schema}".`));
  }
  await build({ entryPoints: ["src/api.ts", "src/review.ts"], outdir: directory, outExtension: { ".js": ".mjs" }, bundle: true, format: "esm", platform: "node", plugins: [{ name: "auth", setup(plugin) {
    plugin.onResolve({ filter: /^\.\/auth$/ }, () => ({ path: "auth", namespace: "test" }));
    plugin.onLoad({ filter: /.*/, namespace: "test" }, () => ({ contents: 'export const authenticatedUserId = async () => "owner";' }));
  } }] });
  const { handleApi } = await import(pathToFileURL(join(directory, "api.mjs")));
  const { processReview } = await import(pathToFileURL(join(directory, "review.mjs")));
  const origin = "https://app.example";
  const env = { BETTER_AUTH_URL: origin, PERSONAL_DATA_COLLECTION_APPROVED: "true", ANTHROPIC_API_KEY: "fake-test-key", REVIEW_QUEUE: { send: async () => {} } };
  const post = (path, body) => handleApi(new Request(`${origin}/api/attempts/text/${path}`, { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify(body) }), env, {}, database);
  const rows = async (sql, values = []) => (await database.query(sql, values)).rows;

  await database.query("INSERT INTO users (id, display_name, email) VALUES ('owner', 'Owner', 'owner@example.invalid'), ('other', 'Other', 'other@example.invalid')");
  await database.query("INSERT INTO attempts (id, user_id, problem_id, mode, input_mode, status, setup_context, consent_at, disclosure_version, practice_goal, draft_source) VALUES ('text', 'owner', 'sum-odd-positions-v1', 'mock', 'text', 'active', '{}', now(), 'test', 'Practice', 'def sum_odd_positions(values):\n    return 0\n'), ('foreign', 'other', 'sum-odd-positions-v1', 'mock', 'text', 'active', '{}', now(), 'test', 'Practice', '')");
  await database.query("INSERT INTO attempt_events (id, attempt_id, event_type, source_id, source_order, occurrence_offset_ms, payload) VALUES ('foreign-event', 'foreign', 'candidate_text', 'foreign', 0, 0, '{}')");

  // Text interviewer: a reply is generated, stored, and returned once.
  reply = () => ({ text: "What should happen for an empty list?" });
  let response = await post("messages", { text: "I will loop over the odd indexes.", sourceId: "message-1", sourceOrder: 1, occurrenceOffsetMs: 100 });
  assert.equal(response.status, 201);
  const first = await response.json();
  assert.equal(first.reply.text, "What should happen for an empty list?");
  assert.equal(first.reply.speaker, "interviewer");
  assert.equal(calls.at(-1).model, "claude-sonnet-5");
  assert.match(calls.at(-1).system, /return 0/, "the prompt includes the saved draft");
  assert.deepEqual(calls.at(-1).messages, [{ role: "user", content: "I will loop over the odd indexes." }]);
  assert.doesNotMatch(calls.at(-1).system, /values\[1::2\]/, "the reference solution never reaches the interviewer");
  response = await post("messages", { text: "I will loop over the odd indexes.", sourceId: "message-1", sourceOrder: 1, occurrenceOffsetMs: 100 });
  assert.deepEqual((await response.json()).reply, first.reply, "a repeated message returns the stored reply");
  assert.equal(calls.length, 1, "a repeated message does not call the model again");
  const stored = await rows("SELECT e.event_type, e.payload, t.speaker, t.text FROM attempt_events e JOIN transcript_segments t ON t.event_id = e.id WHERE e.attempt_id = 'text' ORDER BY t.end_offset_ms");
  assert.deepEqual(stored.map((row) => [row.event_type, row.speaker]), [["candidate_text", "candidate"], ["interviewer_text", "interviewer"]]);

  // Provider failure: the candidate message stays; no reply is invented.
  reply = () => new Response(JSON.stringify({ type: "error", error: { type: "api_error", message: "fake outage" } }), { status: 500, headers: { "content-type": "application/json" } });
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

  // Unverified voice evidence must never reach the review or be citable.
  await database.query("INSERT INTO attempt_events (id, attempt_id, event_type, source_id, source_order, occurrence_offset_ms, payload) VALUES ('unverified-voice', 'text', 'candidate_voice', 'legacy-voice', 0, 400, '{\"inputMode\":\"voice\"}')");
  await database.query("INSERT INTO transcript_segments (id, attempt_id, event_id, speaker, text, end_offset_ms) VALUES ('unverified-segment', 'text', 'unverified-voice', 'candidate', 'UNVERIFIED VOICE TEXT', 400)");
  response = await post("finish", { sourceId: "finish", sourceOrder: 4, occurrenceOffsetMs: 500 });
  const { reviewId } = await response.json();
  const candidateEvent = first.eventId;
  const checkpoint = (await rows("SELECT id FROM code_checkpoints WHERE attempt_id = 'text'"))[0].id;
  const finding = (eventId, extra = {}) => ({ observation: "The submitted draft returns 0 for every input.", interpretation: null, limitations: "Only the visible tests were run.", suggested_action: "Trace the four-value example by hand.", criterion: "index selection", evidence_status: "reproducible_observation", retry_checkpoint_id: checkpoint, evidence: [{ event_id: eventId, locator: "line 2" }], ...extra });
  const review = async () => (await rows("SELECT status, failure_reason, evaluator_version FROM reviews WHERE id = $1", [reviewId]))[0];
  const findingCount = async () => Number((await rows("SELECT count(*) FROM review_findings"))[0].count);
  const reset = () => database.query("UPDATE reviews SET status = 'pending', failure_reason = NULL WHERE id = $1", [reviewId]);

  await processReview(reviewId, { ...env, ANTHROPIC_API_KEY: undefined }, database);
  assert.match((await review()).failure_reason, /not configured/);
  for (const [label, output, reason] of [
    ["foreign event", () => ({ text: JSON.stringify({ findings: [finding("foreign-event")] }) }), /outside the reviewed evidence/],
    ["unverified voice event", () => ({ text: JSON.stringify({ findings: [finding("unverified-voice")] }) }), /outside the reviewed evidence/],
    ["unknown event", () => ({ text: JSON.stringify({ findings: [finding("invented-id")] }) }), /outside the reviewed evidence/],
    ["no evidence", () => ({ text: JSON.stringify({ findings: [finding(candidateEvent, { evidence: [] })] }) }), /must cite/],
    ["score", () => ({ text: JSON.stringify({ findings: [finding(candidateEvent, { observation: "Overall score of 7/10." })] }) }), /out-of-contract/],
    ["refusal", () => ({ text: "{}", stop: "refusal" }), /stopped with refusal/],
    ["provider error", () => new Response(JSON.stringify({ type: "error", error: { type: "invalid_request_error", message: "bad" } }), { status: 400, headers: { "content-type": "application/json" } }), /provider HTTP 400/],
  ]) {
    await reset();
    reply = output;
    await processReview(reviewId, env, database);
    const result = await review();
    assert.equal(result.status, "failed", label);
    assert.match(result.failure_reason, reason, label);
    assert.equal(await findingCount(), 0, `${label} publishes nothing`);
  }

  await reset();
  const submissionEvent = (await rows("SELECT event_id FROM code_checkpoints WHERE id = $1", [checkpoint]))[0].event_id;
  const valid = [finding(candidateEvent), finding(submissionEvent, {
    observation: "The submission checkpoint keeps the starter return value.",
    evidence_status: "supported_interpretation",
    interpretation: "The loop was described but not written.",
    retry_checkpoint_id: null,
    evidence: [{ event_id: submissionEvent, locator: null }, { event_id: candidateEvent, locator: null }],
  })];
  reply = () => ({ text: JSON.stringify({ findings: valid }) });
  const before = calls.length;
  await processReview(reviewId, env, database);
  const request = calls.at(-1);
  assert.equal(request.model, "claude-opus-5-5");
  assert.equal(request.output_config.format.type, "json_schema");
  assert.doesNotMatch(request.messages[0].content, /UNVERIFIED VOICE TEXT|unverified-voice/);
  assert.doesNotMatch(request.messages[0].content, /foreign-event/);
  assert.match(request.messages[0].content, new RegExp(candidateEvent));
  assert.deepEqual(await review(), { status: "ready", failure_reason: null, evaluator_version: "claude-opus-5-5/review-v1" });
  assert.equal(await findingCount(), 2);
  assert.deepEqual((await rows("SELECT event_id FROM finding_evidence")).map((row) => row.event_id).sort(), [candidateEvent, candidateEvent, submissionEvent].sort());

  // Queue redelivery after publication is a no-op.
  await processReview(reviewId, env, database);
  assert.equal(calls.length, before + 1, "redelivery does not call the model");
  assert.equal(await findingCount(), 2, "redelivery publishes nothing new");
  const detail = await (await handleApi(new Request(`${origin}/api/attempts/text/review`), env, {}, database)).json();
  assert.equal(detail.findings.length, 2);
  assert.ok(detail.findings.every((item) => item.evidence.length > 0));
  console.log("Claude review publication, validation failures, redelivery, text replies, provider failure and requested help passed.");
} finally {
  globalThis.fetch = originalFetch;
  await database.end();
  await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  await admin.end();
  await rm(directory, { recursive: true, force: true });
}
