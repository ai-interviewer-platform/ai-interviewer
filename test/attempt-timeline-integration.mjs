// Attempt timeline rules for conversation Events, through the request handler.
import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { testDatabase } from "./postgres-harness.mjs";
import { withSessions } from "./fake-session.mjs";

const { pool: database, drop } = await testDatabase("timeline_test", { problemBank: false });
const directory = await mkdtemp(join(tmpdir(), "attempt-timeline-"));
try {
  await build({ entryPoints: ["src/request-handler.ts"], outdir: directory, outExtension: { ".js": ".mjs" }, bundle: true, format: "esm", platform: "node" });
  const { handleRequest } = await import(pathToFileURL(join(directory, "request-handler.mjs")));
  const handle = withSessions(handleRequest);
  const origin = "https://app.example";
  const AI = { async run() { return { choices: [{ finish_reason: "stop", message: { role: "assistant", content: "Why that index?" } }] }; } };
  const env = { BETTER_AUTH_URL: origin, PERSONAL_DATA_COLLECTION_APPROVED: "true", AI };
  // Only POST and PATCH are sent.
  // eslint-disable-next-line unicorn/no-invalid-fetch-options
  const send = (method, attempt, action, body) => handle(new Request(`${origin}/api/attempts/${attempt}/${action}`, { method, headers: { origin, "content-type": "application/json" }, body: JSON.stringify(body) }), env, {}, database);
  const rows = async (sql, values = []) => (await database.query(sql, values)).rows;
  await database.query("INSERT INTO users (id, display_name, email) VALUES ('owner', 'Owner', 'owner@example.invalid')");
  for (const [id, mode] of [["mock", "mock"], ["coach", "coach"], ["closed", "mock"], ["full", "mock"]]) {
    await database.query("INSERT INTO attempts (id, user_id, problem_id, mode, input_mode, status, setup_context, consent_at, disclosure_version, practice_goal) VALUES ($1, 'owner', 'sum-odd-positions-v1', $2, 'text', 'active', '{}', now(), 'test', 'Practice')", [id, mode]);
  }

  // Candidate text and the Interviewer reply; the speaker follows the Attempt Mode.
  for (const mode of ["mock", "coach"]) {
    const response = await send("POST", mode, "messages", { text: " My plan ", sourceId: "m1", sourceOrder: 1, occurrenceOffsetMs: 10 });
    assert.equal(response.status, 201);
    const body = await response.json();
    assert.equal(body.reply.speaker, mode === "coach" ? "coach" : "interviewer");
    const repeated = await (await send("POST", mode, "messages", { text: " My plan ", sourceId: "m1", sourceOrder: 1, occurrenceOffsetMs: 10 })).json();
    assert.equal(repeated.eventId, body.eventId, "a duplicate sourceId returns the first Event");
    assert.deepEqual(await rows("SELECT speaker, text FROM transcript_segments WHERE attempt_id = $1 ORDER BY end_offset_ms", [mode]), [{ speaker: "candidate", text: "My plan" }, { speaker: body.reply.speaker, text: "Why that index?" }]);
  }
  console.log("PASS candidate text, Interviewer reply speaker from the Mode, and sourceId idempotency");

  // A duplicate Help request returns the first Event and its child row.
  const help = await (await send("POST", "mock", "help", { category: "hint", sourceId: "h1", sourceOrder: 2, occurrenceOffsetMs: 20 })).json();
  const again = await (await send("POST", "mock", "help", { category: "hint", sourceId: "h1", sourceOrder: 2, occurrenceOffsetMs: 20 })).json();
  assert.equal(again.eventId, help.eventId);
  assert.equal((await rows("SELECT id FROM assistance_events WHERE event_id = $1", [help.eventId])).length, 1);
  console.log("PASS Help request idempotency");

  // Draft saves record draft_saved and keep the revision check.
  const saved = await send("PATCH", "mock", "draft", { source: "def f():\n    return 1\n", expectedRevision: 0, sourceId: "d1", sourceOrder: 3, occurrenceOffsetMs: 30 });
  assert.equal(saved.status, 200);
  assert.equal((await saved.json()).draftRevision, 1);
  assert.equal((await send("PATCH", "mock", "draft", { source: "x", expectedRevision: 0, sourceId: "d2", sourceOrder: 4, occurrenceOffsetMs: 40 })).status, 409);
  assert.deepEqual(await rows("SELECT payload FROM attempt_events WHERE attempt_id = 'mock' AND event_type = 'draft_saved'"), [{ payload: { draftRevision: 1 } }]);
  console.log("PASS draft save and revision conflict");

  // A bad envelope, a completed Attempt, and the Event limit each give their own response.
  for (const envelope of [{}, { sourceId: "", sourceOrder: 1, occurrenceOffsetMs: 1 }, { sourceId: "x", sourceOrder: -1, occurrenceOffsetMs: 1 }, { sourceId: "x", sourceOrder: 1, occurrenceOffsetMs: 1.5 }]) {
    assert.equal((await send("POST", "mock", "messages", { text: "hi", ...envelope })).status, 400);
    assert.equal((await send("PATCH", "mock", "draft", { source: "x", expectedRevision: 1, ...envelope })).status, 400);
  }
  assert.equal((await rows("SELECT draft_revision FROM attempts WHERE id = 'mock'"))[0].draft_revision, 1, "an invalid envelope saves no draft");
  await database.query("UPDATE attempts SET status = 'completed', completed_at = now() WHERE id = 'closed'");
  for (const [method, action, body] of [["POST", "messages", { text: "hi" }], ["POST", "help", { category: "hint" }], ["PATCH", "draft", { source: "x", expectedRevision: 0 }]]) {
    const response = await send(method, "closed", action, { ...body, sourceId: `closed-${action}`, sourceOrder: 1, occurrenceOffsetMs: 1 });
    assert.equal(response.status, 409);
    assert.match((await response.json()).error, /finished/);
  }
  await database.query("INSERT INTO attempt_events (id, attempt_id, event_type, source_id, source_order, occurrence_offset_ms) SELECT 'full-' || n, 'full', 'draft_saved', 'full-' || n, 0, 0 FROM generate_series(1, 10000) n");
  const full = await send("POST", "full", "messages", { text: "hi", sourceId: "over", sourceOrder: 1, occurrenceOffsetMs: 1 });
  assert.equal(full.status, 409);
  assert.match((await full.json()).error, /evidence limit/);
  console.log("PASS invalid envelope, completed Attempt, and Event limit results");
} finally {
  await drop();
  await rm(directory, { recursive: true, force: true });
}
