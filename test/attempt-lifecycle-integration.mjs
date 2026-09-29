// Checkpoints, Runs, finish, and Retry through the request handler and the Attempt timeline.
// The Runner uses its in-memory adapter; no container or Python process starts.
import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { infrastructureResult } from "../scripts/python-runner/contract.mjs";
import { testDatabase } from "./postgres-harness.mjs";
import { withSessions } from "./fake-session.mjs";

// Node requires duplex for a streamed Request body; workerd does not.
const NativeRequest = globalThis.Request;
globalThis.Request = class extends NativeRequest {
  constructor(input, init) { super(input, init?.body instanceof ReadableStream ? { ...init, duplex: "half" } : init); }
};
const { pool: database, drop } = await testDatabase("lifecycle_test", { problemBank: false });
const directory = await mkdtemp(join(tmpdir(), "attempt-lifecycle-"));
try {
  await build({ entryPoints: ["src/request-handler.ts", "src/runner.ts"], outdir: directory, outExtension: { ".js": ".mjs" }, bundle: true, format: "esm", platform: "node" });
  const { handleRequest } = await import(pathToFileURL(join(directory, "request-handler.mjs")));
  const { inMemoryRunner } = await import(pathToFileURL(join(directory, "runner.mjs")));
  const handle = withSessions(handleRequest);
  const origin = "https://app.example";
  let respond = (input) => ({ status: "passed", testResults: input.tests.map(test => ({ testId: test.testId, outcome: "passed", actualOutput: test.expectedOutput })), stdout: "printed", stderr: "warning", executionTimeMs: 2, runnerVersion: "fixture", harnessVersion: "fixture" });
  const dispatched = [];
  const env = { BETTER_AUTH_URL: origin, PERSONAL_DATA_COLLECTION_APPROVED: "true", PYTHON_RUNNER: inMemoryRunner(input => respond(input)), REVIEW_PROVIDER_API_KEY: "fictional-key", REVIEW_PROVIDER_MODEL: "fixture-model", REVIEW_QUEUE: { send: async body => dispatched.push(body) } };
  let order = 0;
  const envelope = (name) => ({ sourceId: `${name}:${++order}`, sourceOrder: order, occurrenceOffsetMs: order });
  const post = (attempt, action, body, overrides = env) => handle(new Request(`${origin}/api/attempts/${attempt}/${action}`, { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify(body) }), overrides, {}, database);
  const rows = async (sql, values = []) => (await database.query(sql, values)).rows;
  const count = async (table, attempt = "run") => (await rows(`SELECT count(*)::int AS n FROM ${table} WHERE attempt_id = $1`, [attempt]))[0].n;
  await database.query("INSERT INTO users (id, display_name, email) VALUES ('owner', 'Owner', 'owner@example.invalid')");
  await database.query("INSERT INTO attempts (id, user_id, problem_id, mode, input_mode, status, setup_context, consent_at, disclosure_version, practice_goal, draft_source, draft_revision) VALUES ('run', 'owner', 'sum-odd-positions-v1', 'mock', 'text', 'active', '{}', now(), 'test', 'Practice', 'def sum_odd_positions(values):\n    return sum(values[1::2])\n', 3)");
  const visible = await rows("SELECT id FROM test_cases WHERE problem_id = 'sum-odd-positions-v1' AND visibility = 'visible' ORDER BY id");

  // A Run records a Checkpoint of the saved Draft, then the Run of that Checkpoint.
  const runEnvelope = envelope("run");
  const response = await post("run", "run", runEnvelope);
  assert.equal(response.status, 200, await response.clone().text());
  const run = await response.json();
  assert.equal(run.testsPassed, visible.length);
  const [checkpoint] = await rows("SELECT c.source_code, c.checkpoint_type, e.payload FROM code_checkpoints c JOIN attempt_events e ON e.id = c.event_id WHERE c.id = $1", [run.checkpointId]);
  assert.deepEqual(checkpoint, { source_code: "def sum_odd_positions(values):\n    return sum(values[1::2])\n", checkpoint_type: "run", payload: { checkpointType: "run", draftRevision: 3 } });
  const [stored] = await rows("SELECT r.checkpoint_id, r.status, r.tests_passed, r.tests_failed, r.stdout, r.stderr, r.execution_time_ms, e.event_type, e.source_id FROM code_runs r JOIN attempt_events e ON e.id = r.event_id WHERE r.id = $1", [run.runId]);
  assert.deepEqual(stored, { checkpoint_id: run.checkpointId, status: "passed", tests_passed: visible.length, tests_failed: 0, stdout: "printed", stderr: "warning", execution_time_ms: 2, event_type: "code_run", source_id: `${runEnvelope.sourceId}:result` });
  const repeated = await (await post("run", "run", runEnvelope)).json();
  assert.deepEqual([repeated.runId, repeated.checkpointId], [run.runId, run.checkpointId], "a repeated Run returns the first Checkpoint and Run");
  console.log("PASS Run records a Checkpoint and its Run once");

  // Each reason for no result keeps the Checkpoint, records no Run, and keeps its message.
  const unavailable = async (reason, message) => {
    const before = { checkpoints: await count("code_checkpoints"), runs: await count("code_runs") };
    const failed = await post("run", "run", envelope(reason));
    assert.equal(failed.status, 503);
    assert.equal((await failed.json()).error, message, reason);
    assert.deepEqual({ checkpoints: await count("code_checkpoints"), runs: await count("code_runs") }, { checkpoints: before.checkpoints + 1, runs: before.runs });
  };
  const verdict = (testResults) => JSON.stringify({ status: "passed", testResults, runnerVersion: "fixture", harnessVersion: "fixture" });
  const passing = visible.map(({ id }) => ({ testId: id, outcome: "passed" }));
  for (const body of ["{", verdict(passing.slice(1)), verdict([passing[0], passing[0], ...passing.slice(2)]), verdict([{ testId: "forged", outcome: "passed" }, ...passing.slice(1)])]) {
    respond = () => new Response(body);
    await unavailable("invalid", "The isolated Python runner returned an invalid result. No test verdict was recorded.");
  }
  respond = () => new Response("x".repeat(256 * 1024 + 1));
  await unavailable("large", "The runner result exceeded the response limit.");
  respond = () => { throw new Error("offline"); };
  await unavailable("unreachable", "The isolated Python runner could not be reached. Your saved checkpoint is intact and this is not a code result.");
  respond = () => new Response("offline", { status: 503 });
  await unavailable("http", "The isolated Python runner reported an infrastructure failure. Your saved checkpoint is intact and this is not a code result.");
  const checkpoints = await count("code_checkpoints");
  assert.equal((await post("run", "run", envelope("unconfigured"), { ...env, PYTHON_RUNNER: undefined })).status, 503);
  assert.equal(await count("code_checkpoints"), checkpoints, "no Runner, no Checkpoint");
  respond = (input) => infrastructureResult(input, "Fictional infrastructure failure");
  const infrastructure = await post("run", "run", envelope("infrastructure"));
  assert.equal(infrastructure.status, 200);
  assert.equal((await infrastructure.json()).status, "runner_error", "a Runner infrastructure result is recorded");
  assert.equal((await post("run", "run", { sourceId: "", sourceOrder: 1, occurrenceOffsetMs: 1 })).status, 400);
  console.log("PASS invalid, unreachable, and infrastructure Runner results");

  // Finish records the Submission, completes the Attempt, and creates the Review in one transaction.
  const finished = await post("run", "finish", envelope("finish"));
  assert.equal(finished.status, 200, await finished.clone().text());
  const { reviewId, recoveryDispatch } = await finished.json();
  assert.equal(recoveryDispatch, false);
  const [review] = await rows("SELECT r.status, r.evidence_manifest, a.status AS attempt_status, c.checkpoint_type FROM reviews r JOIN attempts a ON a.id = r.attempt_id JOIN code_checkpoints c ON c.id = r.evidence_manifest->>'finalCheckpointId' WHERE r.id = $1", [reviewId]);
  assert.deepEqual([review.status, review.attempt_status, review.checkpoint_type], ["pending", "completed", "submission"]);
  assert.deepEqual(dispatched, [{ reviewId }]);
  await database.query("UPDATE reviews SET dispatch_claimed_at = now() - interval '2 minutes'");
  const again = await (await post("run", "finish", envelope("finish-again"))).json();
  assert.deepEqual([again.reviewId, again.recoveryDispatch], [reviewId, true], "finishing again dispatches the same Review");
  assert.equal((await post("run", "run", envelope("late"))).status, 409, "a completed Attempt records no Run");
  console.log("PASS finish and recovery dispatch");

  // A Retry records its start Event and keeps its source Checkpoint link.
  const retried = await post("run", "retry", { checkpointId: run.checkpointId, practiceGoal: "Explain the slice" });
  assert.equal(retried.status, 201, await retried.clone().text());
  const { attemptId } = await retried.json();
  const [retry] = await rows("SELECT a.mode, a.source_attempt_id, a.source_checkpoint_id, a.draft_source, e.event_type, e.payload FROM attempts a JOIN attempt_events e ON e.attempt_id = a.id WHERE a.id = $1", [attemptId]);
  assert.deepEqual(retry, { mode: "coach", source_attempt_id: "run", source_checkpoint_id: run.checkpointId, draft_source: checkpoint.source_code, event_type: "retry_started", payload: { sourceAttemptId: "run", sourceCheckpointId: run.checkpointId } });
  console.log("PASS Retry start Event and source Checkpoint link");
} finally {
  globalThis.Request = NativeRequest;
  await drop();
  await rm(directory, { recursive: true, force: true });
}
