import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { testDatabase } from "./postgres-harness.mjs";
import { withSessions } from "./fake-session.mjs";

// The Coding context of both Interviewer adapters against real PostgreSQL, with a
// fake Workers AI binding. ADR 0001: the Interviewer sees only saved state.
const { pool: database, drop } = await testDatabase("interviewer_turn_test", { problemBank: false });
const directory = await mkdtemp(join(tmpdir(), "interviewer-turn-"));
const calls = [];
const AI = { async run(model, input) {
  calls.push(input);
  return { choices: [{ finish_reason: "stop", message: { role: "assistant", content: "What does the failing case expect?" } }] };
} };
try {
  await build({ entryPoints: ["src/request-handler.ts", "src/interviewer-turn.ts", "src/attempt-timeline.ts"], outdir: directory, outExtension: { ".js": ".mjs" }, bundle: true, format: "esm", platform: "node" });
  const { handleRequest } = await import(pathToFileURL(join(directory, "request-handler.mjs")));
  const { loadCodingContext } = await import(pathToFileURL(join(directory, "interviewer-turn.mjs")));
  const { withTimeline } = await import(pathToFileURL(join(directory, "attempt-timeline.mjs")));
  const handle = withSessions(handleRequest);
  const origin = "https://app.example";
  const env = { BETTER_AUTH_URL: origin, PERSONAL_DATA_COLLECTION_APPROVED: "true", AI, REVIEW_QUEUE: { send: async () => {} } };
  const call = (method, attemptId, path, body) => handle(new Request(`${origin}/api/attempts/${attemptId}/${path}`, { method, headers: { origin, "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }), env, {}, database);
  const result = (outcome, testId, error) => ({ status: outcome, stdout: "PRIVATE_STDOUT", stderr: error, runnerVersion: "test", harnessVersion: "test", testResults: [{ testId, outcome, actualOutput: "private-output", error: "private-test-error" }] });

  await database.query("INSERT INTO users (id, display_name, email) VALUES ('owner', 'Owner', 'owner@example.invalid')");
  const attempt = async (id, inputMode, draft) => database.query(
    "INSERT INTO attempts (id, user_id, problem_id, mode, input_mode, status, setup_context, consent_at, disclosure_version, practice_goal, draft_source) VALUES ($1, 'owner', 'sum-odd-positions-v1', 'mock', $2, 'active', '{}', now(), 'test', 'Practice', $3)",
    [id, inputMode, draft],
  );
  const visibleRun = (attemptId, runResult) => withTimeline(database, attemptId, async (timeline) => {
    const checkpoint = await timeline.record("code_checkpoint", { sourceId: "checkpoint-1", sourceOrder: 1, occurrenceOffsetMs: 10 }, {}, { checkpoint: { type: "run" } });
    await timeline.record("code_run", { sourceId: "run-1", sourceOrder: 2, occurrenceOffsetMs: 20 }, {}, { run: { checkpointId: checkpoint.detailId, result: runResult } });
    return checkpoint.detailId;
  });
  // A visible Run, a later Submission check on the same Checkpoint,
  // and an unsaved Draft change: a save from a stale editor that the server refuses.
  const seed = async (attemptId) => {
    const checkpointId = await visibleRun(attemptId, result("failed", "visible-a", "VISIBLE_RUN_ERROR"));
    await database.query("INSERT INTO attempt_events (id, attempt_id, event_type, source_id, source_order, occurrence_offset_ms, payload) VALUES ($1, $2, 'code_run', 'submission-run', 3, 30, '{}')", [`${attemptId}-submission-run`, attemptId]);
    await database.query("INSERT INTO code_runs (id, attempt_id, checkpoint_id, event_id, status, tests_passed, tests_failed, test_results, run_kind, check_state, runner_version, harness_version, created_at) VALUES ($1, $2, $3, $1, 'failed', 0, 1, '[{\"testId\":\"hidden-case\",\"category\":\"HIDDEN_RUN_ERROR\"}]', 'submission', 'checked', 'test', 'test', now() + interval '1 minute')", [`${attemptId}-submission-run`, attemptId, checkpointId]);
    const stale = await call("PATCH", attemptId, "draft", { source: unsaved, expectedRevision: 7, sourceId: "stale-save", sourceOrder: 4, occurrenceOffsetMs: 40 });
    assert.equal(stale.status, 409);
  };
  const saved = "def sum_odd_positions(values):\n    return SAVED_DRAFT\n";
  const unsaved = "def sum_odd_positions(values):\n    return UNSAVED_EDITOR\n";
  const neverSeen = ["HIDDEN_RUN_ERROR", "hidden-case", "UNSAVED_EDITOR", "PRIVATE_STDOUT", "private-output", "private-test-error"];

  // Text adapter: what the model receives.
  await attempt("text", "text", saved);
  await seed("text");
  const response = await call("POST", "text", "messages", { text: "Why does my code fail?", sourceId: "message-1", sourceOrder: 5, occurrenceOffsetMs: 100 });
  assert.equal(response.status, 201);
  assert.equal((await response.json()).reply.text, "What does the failing case expect?");
  const prompt = JSON.stringify(calls.at(-1).messages);
  assert.match(prompt, /SAVED_DRAFT/, "the text Interviewer sees the saved Draft");
  assert.match(prompt, /VISIBLE_RUN_ERROR/, "the text Interviewer sees the error output of the visible Run");
  for (const value of neverSeen) assert.ok(!prompt.includes(value), `the text Interviewer never sees ${value}`);

  // Voice adapter: what the get_coding_context function call returns.
  await attempt("voice", "voice", saved);
  assert.equal(JSON.parse(await loadCodingContext(database, "voice", "owner")).latestVisibleRun, null, "no Run yet");
  await seed("voice");
  assert.equal((await call("POST", "voice", "help", { category: "hint", sourceId: "help-1", sourceOrder: 5, occurrenceOffsetMs: 50 })).status, 202);
  const context = JSON.parse(await loadCodingContext(database, "voice", "owner"));
  assert.equal(context.savedDraft.source, saved);
  assert.deepEqual(context.latestVisibleRun.outcomes, [{ testId: "visible-a", outcome: "failed" }]);
  assert.equal(context.latestVisibleRun.errorOutput, "VISIBLE_RUN_ERROR");
  assert.equal(context.latestVisibleRun.errorOutputTruncated, false);
  assert.deepEqual(Object.keys(context.latestHelpRequest), ["category", "delivered", "createdAt"]);
  assert.deepEqual([context.latestHelpRequest.category, context.latestHelpRequest.delivered], ["hint", false]);
  assert.equal(context.latestCheckpoint.type, "run");
  for (const value of neverSeen) assert.ok(!JSON.stringify(context).includes(value), `the voice Interviewer never sees ${value}`);
  assert.equal(await loadCodingContext(database, "voice", "other"), null, "another user gets no Coding context");

  // The Coding context is clipped by bytes: 10 KiB for the Draft, 16 KiB for the whole context.
  const bytes = (value) => new TextEncoder().encode(value).byteLength;
  const quoted = "\"\\\n".repeat(8 * 1024);
  await attempt("large", "voice", quoted);
  await visibleRun("large", {
    ...result("runner_error", "visible-a", quoted),
    testResults: Array.from({ length: 20 }, (_, index) => ({ testId: `visible-${index}-${"\u0001".repeat(300)}`, outcome: "\u0001".repeat(300) })),
  });
  const large = await loadCodingContext(database, "large", "owner");
  assert.ok(bytes(large) <= 16 * 1024, `the whole context is at most 16 KiB, not ${bytes(large)}`);
  const clipped = JSON.parse(large);
  assert.equal(clipped.savedDraft.truncated, true);
  assert.ok(bytes(JSON.stringify(clipped.savedDraft.source)) <= 10 * 1024, "the Draft is at most 10 KiB");
  assert.ok(quoted.startsWith(clipped.savedDraft.source));
  assert.equal(clipped.latestVisibleRun.outcomes.length, 16);
  assert.ok(quoted.startsWith(clipped.latestVisibleRun.errorOutput), "the error output is clipped to fit the whole context");
  assert.equal(clipped.latestVisibleRun.errorOutputTruncated, true);

  await database.query("UPDATE attempts SET status = 'completed' WHERE id = 'voice'");
  assert.deepEqual(JSON.parse(await loadCodingContext(database, "voice", "owner")), { status: "unavailable", reason: "attempt_not_active" });
  console.log("ADR 0001: neither Interviewer adapter sees a hidden Run or unsaved code.");
  console.log("The Coding context is owner-scoped, clipped by bytes and unavailable after completion.");
} finally {
  await drop();
  await rm(directory, { recursive: true, force: true });
}
