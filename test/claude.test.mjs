import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { after, test } from "node:test";

// The Anthropic API is always faked here; `test/claude-integration.mjs` runs
// the same flows against real PostgreSQL.
const directory = await mkdtemp(join(tmpdir(), "claude-"));
after(() => rm(directory, { recursive: true, force: true }));
await build({ entryPoints: ["src/api.ts", "src/review.ts"], outdir: directory, outExtension: { ".js": ".mjs" }, bundle: true, format: "esm", platform: "node", plugins: [{ name: "auth", setup(plugin) {
  plugin.onResolve({ filter: /^\.\/auth$/ }, () => ({ path: "auth", namespace: "test" }));
  plugin.onLoad({ filter: /.*/, namespace: "test" }, () => ({ contents: 'export const authenticatedUserId = async () => "owner"; export const passwordMatches = async () => false;' }));
} }] });
const { handleApi } = await import(pathToFileURL(join(directory, "api.mjs")));
const { citableEvent, processReview, validateFindings } = await import(pathToFileURL(join(directory, "review.mjs")));

const originalFetch = globalThis.fetch;
after(() => { globalThis.fetch = originalFetch; });
const calls = [];
function provider(respond) {
  globalThis.fetch = async (url, init) => {
    calls.push(JSON.parse(init.body));
    return respond();
  };
}
const message = (text) => Response.json({ id: "msg", type: "message", role: "assistant", model: "fake", content: [{ type: "text", text }], stop_reason: "end_turn", stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } });
const outage = () => new Response(JSON.stringify({ type: "error", error: { type: "invalid_request_error", message: "fake" } }), { status: 400, headers: { "content-type": "application/json" } });

const finding = (eventId) => ({ observation: "Two visible tests failed on the submitted draft.", interpretation: null, limitations: "Hidden tests were not run.", suggested_action: null, criterion: null, evidence_status: "reproducible_observation", retry_checkpoint_id: null, evidence: [{ event_id: eventId, locator: null }] });
const events = new Set(["e1"]);

test("only verified voice events are citable", () => {
  assert.equal(citableEvent({ event_type: "candidate_text", payload: {} }), true);
  assert.equal(citableEvent({ event_type: "candidate_voice", payload: { verified: true } }), true);
  assert.equal(citableEvent({ event_type: "candidate_voice", payload: { inputMode: "voice" } }), false);
  assert.equal(citableEvent({ event_type: "interviewer_voice", payload: { verified: "true" } }), false);
});

test("findings must match the schema, cite reviewed events, and respect the product contract", () => {
  assert.equal(validateFindings(JSON.stringify({ findings: [finding("e1")] }), events, new Set()).length, 1);
  assert.deepEqual(validateFindings(JSON.stringify({ findings: [] }), events, new Set()), []);
  for (const [output, reason] of [
    ["not json", /not JSON/],
    [JSON.stringify({ findings: [finding("e2")] }), /outside the reviewed evidence/],
    [JSON.stringify({ findings: [{ ...finding("e1"), evidence: [] }] }), /must cite/],
    [JSON.stringify({ findings: [{ ...finding("e1"), evidence: [{ event_id: "e1", locator: null }, { event_id: "e1", locator: null }] }] }), /twice/],
    [JSON.stringify({ findings: [{ ...finding("e1"), retry_checkpoint_id: "other" }] }), /checkpoint outside/],
    [JSON.stringify({ findings: [{ ...finding("e1"), observation: "You would likely pass a real interview." }] }), /out-of-contract/],
    [JSON.stringify({ findings: [{ ...finding("e1"), interpretation: "Scored 8/10 overall." }] }), /out-of-contract/],
    [JSON.stringify({ findings: [{ ...finding("e1"), evidence_status: "certain" }] }), /evidence status/],
    [JSON.stringify({ findings: [{ ...finding("e1"), extra: 1 }] }), /schema/],
    [JSON.stringify({ findings: Array.from({ length: 7 }, () => finding("e1")) }), /more than 6/],
    [JSON.stringify({ findings: [finding("e1")], score: 1 }), /schema/],
  ]) assert.match(validateFindings(output, events, new Set()), reason);
});

// A minimal in-memory stand-in for the queries each path issues.
function database({ reviewStatus = "pending", inputMode = "text" } = {}) {
  const writes = [];
  const pool = { writes, release() {}, async connect() { return pool; }, async query(sql, values = []) {
    if (/^(BEGIN|COMMIT|ROLLBACK)/.test(sql)) return { rows: [] };
    if (sql.startsWith("INSERT INTO security_rate_limits")) return { rows: [{ count: 1 }] };
    if (sql.startsWith("SELECT * FROM attempts")) return { rows: [{ id: "a1", user_id: "owner", problem_id: "p", mode: "mock", input_mode: inputMode, status: "active", draft_source: "def f():\n    pass\n", created_at: new Date() }] };
    if (sql.startsWith("SELECT status FROM attempts")) return { rows: [{ status: "active" }] };
    if (sql.startsWith("SELECT count(*)")) return { rows: [{ count: "0" }] };
    if (sql.startsWith("SELECT speaker, text FROM transcript_segments")) return { rows: [{ speaker: "candidate", text: "Hello" }] };
    if (sql.startsWith("SELECT r.status")) return { rows: [{ status: reviewStatus, evidence_manifest: { finalCheckpointId: "c1" }, attempt_id: "a1", user_id: "owner", problem_id: "p" }] };
    if (sql.startsWith("SELECT id FROM code_checkpoints")) return { rows: [{ id: "c1" }] };
    if (sql.includes("FROM attempt_events e\n")) return { rows: [{ id: "e1", event_type: "candidate_text", occurrence_offset_ms: 1, payload: {}, speaker: "candidate", text: "Hello", checkpoint_id: null, help_category: null, run_status: null }] };
    if (sql.includes("t.end_offset_ms FROM attempt_events")) return { rows: writes.some((write) => write.sql.includes("INSERT INTO transcript_segments") && write.values[3] === "interviewer") ? [{ id: "reply", speaker: "interviewer", text: "Why?", end_offset_ms: 5 }] : [] };
    if (sql.startsWith("UPDATE reviews SET status = 'ready'")) { writes.push({ sql, values }); return { rows: [{ id: values[1] }] }; }
    if (/^(INSERT|UPDATE)/.test(sql)) { writes.push({ sql, values }); return { rows: [{ id: values[0] }] }; }
    return { rows: [] };
  } };
  return pool;
}
const env = { BETTER_AUTH_URL: "https://app.example", PERSONAL_DATA_COLLECTION_APPROVED: "true", ANTHROPIC_API_KEY: "fake-test-key" };
const sendMessage = (pool) => handleApi(new Request("https://app.example/api/attempts/a1/messages", { method: "POST", headers: { origin: "https://app.example", "content-type": "application/json" }, body: JSON.stringify({ text: "Hello", sourceId: "m1", sourceOrder: 1, occurrenceOffsetMs: 1 }) }), env, {}, pool);

test("a text message returns and stores the interviewer reply", async () => {
  provider(() => message("Why?"));
  const pool = database();
  const body = await (await sendMessage(pool)).json();
  assert.deepEqual(body.reply, { eventId: "reply", speaker: "interviewer", text: "Why?", occurrenceOffsetMs: 5 });
  assert.equal(calls.at(-1).model, "claude-sonnet-5");
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

test("reviews publish validated findings once and fail closed otherwise", async () => {
  provider(() => message(JSON.stringify({ findings: [finding("e1")] })));
  let pool = database();
  await processReview("r1", env, pool);
  assert.ok(pool.writes.some((write) => write.sql.startsWith("UPDATE reviews SET status = 'ready'")));
  assert.ok(pool.writes.some((write) => write.sql.includes("INSERT INTO finding_evidence") && write.values[2] === "e1"));
  assert.equal(calls.at(-1).model, "claude-opus-5-5");

  for (const respond of [outage, () => message(JSON.stringify({ findings: [finding("foreign")] }))]) {
    provider(respond);
    pool = database();
    await processReview("r1", env, pool);
    assert.ok(pool.writes.some((write) => write.sql.includes("status = 'failed'")));
    assert.ok(!pool.writes.some((write) => write.sql.includes("review_findings") || write.sql.includes("status = 'ready'")));
  }

  const before = calls.length;
  pool = database({ reviewStatus: "ready" });
  await processReview("r1", env, pool);
  assert.equal(calls.length, before, "a redelivered terminal review does not call the model");
  assert.equal(pool.writes.length, 0);
});
