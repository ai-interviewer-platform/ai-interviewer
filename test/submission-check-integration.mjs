// The Submission check (CONTEXT.md, docs/adr/0002) through the request handler and real PostgreSQL.
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
const { pool: database, drop } = await testDatabase("submission_check_test", { problemBank: false });
const directory = await mkdtemp(join(tmpdir(), "submission-check-"));
const logged = [];
const consoleMethods = Object.fromEntries(["info", "warn", "error", "log"].map(level => [level, console[level]]));
for (const level of ["info", "warn", "error"]) console[level] = (...values) => { logged.push(values.join(" ")); };
try {
  await build({ entryPoints: ["src/request-handler.ts", "src/runner.ts"], outdir: directory, outExtension: { ".js": ".mjs" }, bundle: true, format: "esm", platform: "node" });
  const { handleRequest } = await import(pathToFileURL(join(directory, "request-handler.mjs")));
  const { inMemoryRunner } = await import(pathToFileURL(join(directory, "runner.mjs")));
  const handle = withSessions(handleRequest);
  const origin = "https://app.example";
  const PROBLEM = "sum-odd-positions-v1";
  const NO_HIDDEN = "count-rises-v1";
  // Fictional hidden inputs and expected values; none of these may leave the server.
  const hidden = [1, 2, 3, 4, 5, 6].map(index => ({ id: `hidden-${index}`, input: [`SECRET-INPUT-${index}`], expected: `SECRET-EXPECTED-${index}` }));
  for (const test of hidden) await database.query("INSERT INTO test_cases (id, problem_id, input_data, expected_output, visibility) VALUES ($1, $2, $3::jsonb, $4::jsonb, 'hidden')", [test.id, PROBLEM, JSON.stringify({ args: [test.input] }), JSON.stringify(test.expected)]);
  const secrets = ["SECRET-INPUT", "SECRET-EXPECTED", "SECRET-MESSAGE", "SECRET-STDOUT", "SECRET-STDERR", "SECRET-OUTPUT"];

  const traceback = (name, message = "SECRET-MESSAGE") => `Traceback (most recent call last):\n  File "/runner/harness.py", line 26, in <module>\n    result["actualOutput"] = function(*request["args"])\n  File "candidate.py", line 2, in sum_odd_positions\n    return values[99]\n${name}: ${message}\n`;
  // One outcome for each category kind, in hidden test order.
  const mixed = [
    { outcome: "passed", actualOutput: "expected" },
    { outcome: "passed", actualOutput: "expected" },
    { outcome: "failed", actualOutput: "SECRET-OUTPUT" },
    { outcome: "failed", error: traceback("IndexError", "list index out of range SECRET-MESSAGE") },
    { outcome: "failed", error: traceback("candidate.MyError") },
    { outcome: "failed", error: "Execution timeout" },
  ];
  const calls = [];
  let respond = (input) => ({ status: "passed", testResults: input.tests.map(test => ({ testId: test.testId, outcome: "passed", actualOutput: test.expectedOutput })), stdout: "", stderr: "", runnerVersion: "fixture", harnessVersion: "fixture" });
  const dispatched = [];
  const env = { BETTER_AUTH_URL: origin, PERSONAL_DATA_COLLECTION_APPROVED: "true", PYTHON_RUNNER: inMemoryRunner(input => { calls.push(input); return respond(input); }), REVIEW_PROVIDER_API_KEY: "fictional-key", REVIEW_PROVIDER_MODEL: "fixture-model", REVIEW_QUEUE: { send: async body => dispatched.push(body) } };
  let order = 0;
  const envelope = (name) => ({ sourceId: `${name}:${++order}`, sourceOrder: order, occurrenceOffsetMs: order });
  const request = (path, method = "GET", body) => handle(new Request(`${origin}/api${path}`, { method, headers: { origin, "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) }), env, {}, database);
  const post = (attempt, action, body, overrides = env) => handle(new Request(`${origin}/api/attempts/${attempt}/${action}`, { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify(body) }), overrides, {}, database);
  const rows = async (sql, values = []) => (await database.query(sql, values)).rows;
  await database.query("INSERT INTO users (id, display_name, email) VALUES ('owner', 'Owner', 'owner@example.invalid'), ('other', 'Other', 'other@example.invalid')");
  let attempts = 0;
  async function attempt({ problem = PROBLEM, mode = "mock", inputMode = "text", user = "owner" } = {}) {
    const id = `attempt-${++attempts}`;
    await database.query("INSERT INTO attempts (id, user_id, problem_id, mode, input_mode, status, setup_context, consent_at, disclosure_version, practice_goal, draft_source) VALUES ($1, $2, $3, $4, $5, 'active', '{}', now(), 'test', 'Practice', $6)", [id, user, problem, mode, inputMode, `def sum_odd_positions(values):\n    return ${attempts}\n`]);
    return id;
  }
  async function finish(attemptId, metadata = envelope("finish"), overrides = env) {
    // This test sends more requests than the per-minute API limit allows.
    await database.query("DELETE FROM security_rate_limits");
    const response = await post(attemptId, "finish", metadata, overrides);
    assert.equal(response.status, 200, await response.clone().text());
    return response.json();
  }
  const stored = async (attemptId) => rows("SELECT r.check_state, r.status, r.tests_passed, r.tests_failed, r.test_results, r.stdout, r.stderr, r.runner_error, r.execution_time_ms, r.checkpoint_id, c.checkpoint_type, e.event_type FROM code_runs r JOIN code_checkpoints c ON c.id = r.checkpoint_id JOIN attempt_events e ON e.id = r.event_id WHERE r.attempt_id = $1 AND r.run_kind = 'submission'", [attemptId]);
  const detail = async (attemptId) => (await request(`/attempts/${attemptId}`)).json();
  const unavailable = { state: "unavailable", passed: null, total: null, failures: {} };

  // Checked: each hidden test keeps only its ID and one category, recorded with the completion.
  respond = (input) => ({ status: "failed", testResults: input.tests.map((test, index) => ({ testId: test.testId, ...mixed[index] })), stdout: "SECRET-STDOUT", stderr: "SECRET-STDERR", executionTimeMs: 3, runnerVersion: "fixture", harnessVersion: "fixture" });
  const checked = await attempt();
  const result = await finish(checked);
  const expected = { state: "checked", passed: 2, total: 6, failures: { "wrong answer": 1, IndexError: 1, "other error": 1, timeout: 1 } };
  assert.deepEqual(result.submissionCheck, expected);
  const call = calls.at(-1);
  assert.deepEqual(call.tests.map(test => test.testId), hidden.map(test => test.id), "the Runner gets the hidden tests only");
  assert.deepEqual(call.tests[0], { testId: "hidden-1", inputData: { args: [hidden[0].input] }, expectedOutput: hidden[0].expected });
  assert.equal(call.entryPoint, "sum_odd_positions");
  assert.equal(call.sourceCode, "def sum_odd_positions(values):\n    return 1\n");
  const [submissionCheck] = await stored(checked);
  assert.deepEqual(submissionCheck, {
    check_state: "checked", status: "failed", tests_passed: 2, tests_failed: 4, stdout: "", stderr: "", runner_error: null, execution_time_ms: null,
    checkpoint_id: call.checkpointId, checkpoint_type: "submission", event_type: "submission_check",
    test_results: [["hidden-1", "passed"], ["hidden-2", "passed"], ["hidden-3", "wrong answer"], ["hidden-4", "IndexError"], ["hidden-5", "other error"], ["hidden-6", "timeout"]].map(([testId, category]) => ({ testId, category })),
  });
  const [review] = await rows("SELECT r.status, r.evidence_manifest, a.status AS attempt_status FROM reviews r JOIN attempts a ON a.id = r.attempt_id WHERE r.id = $1", [result.reviewId]);
  assert.deepEqual([review.status, review.attempt_status, review.evidence_manifest.finalCheckpointId], ["pending", "completed", call.checkpointId]);
  const [checkEvent] = await rows("SELECT id, payload FROM attempt_events WHERE attempt_id = $1 AND event_type = 'submission_check'", [checked]);
  assert.equal(review.evidence_manifest.submissionCheckEventId, checkEvent.id);
  assert.deepEqual(checkEvent.payload, { checkpointId: call.checkpointId, state: "checked" });
  assert.deepEqual(dispatched.at(-1), { reviewId: result.reviewId });
  const shown = await detail(checked);
  assert.deepEqual(shown.submissionCheck, expected);
  assert.deepEqual(shown.runs, [], "Visible Runs exclude the Submission check");
  console.log("PASS checked Submission check keeps categories only and completes the Attempt");

  // Allowlisted built-in exception names, and everything else as other error.
  for (const [error, category] of [
    [traceback("TypeError"), "TypeError"], [traceback("ZeroDivisionError", "division by zero"), "ZeroDivisionError"], [traceback("RecursionError"), "RecursionError"],
    [traceback("KeyError", "'SECRET-MESSAGE'"), "KeyError"], [`${traceback("ValueError")}`.replace(/: SECRET-MESSAGE\n$/, "\n"), "ValueError"],
    [`Traceback (most recent call last):\n  File "/runner/harness.py", line 23, in <module>\n    exec(compile(request["sourceCode"], "candidate.py", "exec"), scope)\n  File "candidate.py", line 1\n    def f(:\n          ^\nSyntaxError: invalid syntax\n`, "SyntaxError"],
    [traceback("candidate.TypeError"), "other error"], [traceback("ExceptionGroup"), "other error"], [traceback("TypeError").replace("\nTypeError: SECRET-MESSAGE", "\nTypeError: x\nValueError: SECRET-MESSAGE"), "TypeError"],
    [`Traceback (most recent call last):\n  File "/runner/harness.py", line 25, in <module>\n    raise ValueError("Entry point is missing or is not callable")\nValueError: Entry point is missing or is not callable\n`, "other error"],
    [`Traceback (most recent call last):\n  File "/runner/harness.py", line 28, in <module>\n    encoded = json.dumps(result["actualOutput"], allow_nan=False)\nTypeError: Object of type set is not JSON serializable\n`, "other error"],
    ["Candidate process exited (1)", "other error"], ["Output exceeds 8 KiB per stream", "other error"], ["Candidate returned invalid or oversized output", "other error"], ["SECRET-MESSAGE", "other error"],
  ]) {
    respond = (input) => ({ status: "failed", testResults: input.tests.map((test, index) => ({ testId: test.testId, ...(index === 0 ? { outcome: "failed", error } : { outcome: "passed", actualOutput: "expected" }) })), runnerVersion: "fixture", harnessVersion: "fixture" });
    const attemptId = await attempt();
    assert.deepEqual((await finish(attemptId)).submissionCheck.failures, { [category]: 1 }, error);
    assert.equal((await stored(attemptId))[0].test_results[0].category, category);
  }
  // A test the run deadline skipped is not a pass.
  respond = (input) => ({ status: "failed", testResults: input.tests.map((test, index) => index ? { testId: test.testId, outcome: "skipped", error: "Run deadline exceeded" } : { testId: test.testId, outcome: "passed" }), runnerVersion: "fixture", harnessVersion: "fixture" });
  assert.deepEqual((await finish(await attempt())).submissionCheck, { state: "checked", passed: 1, total: 6, failures: { "other error": 5 } });
  console.log("PASS allowlisted exception names; candidate-defined and other failures are other error");

  // No result from the Runner: the Attempt completes, and the check is unavailable with no counts.
  const unavailableCases = [
    ["not configured", { ...env, PYTHON_RUNNER: undefined }, null],
    ["unreachable", env, () => { throw new Error("offline SECRET-MESSAGE"); }],
    ["http failure", env, () => new Response("SECRET-MESSAGE", { status: 503 })],
    ["invalid result", env, () => new Response("{")],
    ["oversized result", env, () => new Response("x".repeat(256 * 1024 + 1))],
    ["missing test result", env, (input) => ({ status: "passed", testResults: input.tests.slice(1).map(test => ({ testId: test.testId, outcome: "passed" })), runnerVersion: "fixture", harnessVersion: "fixture" })],
    ["runner_error at the start", env, (input) => infrastructureResult(input, "SECRET-MESSAGE")],
    ["runner_error part-way", env, (input) => ({ status: "runner_error", runnerError: "SECRET-MESSAGE", testResults: input.tests.map((test, index) => index < 3 ? { testId: test.testId, outcome: "passed" } : { testId: test.testId, outcome: "skipped", error: "SECRET-MESSAGE" }), runnerVersion: "fixture", harnessVersion: "fixture" })],
    ["memory limit", env, (input) => ({ status: "failed", testResults: input.tests.map((test, index) => index ? { testId: test.testId, outcome: "passed" } : { testId: test.testId, outcome: "failed", error: "Memory limit exceeded" }), runnerVersion: "fixture", harnessVersion: "fixture" })],
  ];
  for (const [name, overrides, responder] of unavailableCases) {
    if (responder) respond = responder;
    const attemptId = await attempt();
    const finished = await finish(attemptId, envelope("finish"), overrides);
    assert.deepEqual(finished.submissionCheck, unavailable, name);
    assert.deepEqual((await stored(attemptId)).map(row => [row.check_state, row.status, row.tests_passed, row.tests_failed, row.test_results]), [["unavailable", null, null, null, []]], name);
    assert.equal((await rows("SELECT status FROM attempts WHERE id = $1", [attemptId]))[0].status, "completed", name);
    assert.deepEqual((await detail(attemptId)).submissionCheck, unavailable, name);
  }
  console.log("PASS an unavailable Runner never blocks finishing and records no counts");

  // No hidden tests: the Runner is not called.
  const before = calls.length;
  const empty = await attempt({ problem: NO_HIDDEN });
  assert.deepEqual((await finish(empty)).submissionCheck, { state: "no hidden tests", passed: null, total: null, failures: {} });
  assert.equal(calls.length, before, "no Runner call without hidden tests");
  assert.deepEqual((await stored(empty)).map(row => row.check_state), ["no hidden tests"]);
  console.log("PASS no hidden tests skips the Runner");

  // A retried finish with the same event metadata: one Submission and one Submission check.
  respond = (input) => ({ status: "passed", testResults: input.tests.map(test => ({ testId: test.testId, outcome: "passed" })), runnerVersion: "fixture", harnessVersion: "fixture" });
  const retried = await attempt();
  const metadata = envelope("finish");
  // The first request loses its Review dispatch after the Submission check is recorded.
  const lost = await post(retried, "finish", metadata, { ...env, REVIEW_QUEUE: { send: async () => { throw new Error("queue offline"); } } });
  assert.equal(lost.status, 503);
  const first = await finish(retried, metadata);
  const second = await finish(retried, metadata);
  assert.equal(first.recoveryDispatch, true);
  assert.deepEqual([first.submissionCheck, second.submissionCheck], [{ state: "checked", passed: 6, total: 6, failures: {} }, { state: "checked", passed: 6, total: 6, failures: {} }]);
  assert.deepEqual((await rows("SELECT checkpoint_type, count(*)::int AS n FROM code_checkpoints WHERE attempt_id = $1 GROUP BY checkpoint_type", [retried])), [{ checkpoint_type: "submission", n: 1 }]);
  assert.equal((await stored(retried)).length, 1);
  // A Submission recorded before a lost response, then retried: the check runs once against that Submission.
  const interrupted = await attempt();
  const interruptedMetadata = envelope("finish");
  await database.query("UPDATE attempts SET draft_source = $2 WHERE id = $1", [interrupted, "def sum_odd_positions(values):\n    return 'first'\n"]);
  // The first request records the Submission, then fails before completion.
  await database.query(`CREATE FUNCTION fail_completion() RETURNS trigger AS $$ BEGIN IF NEW.status = 'completed' THEN RAISE EXCEPTION 'fictional crash'; END IF; RETURN NEW; END; $$ LANGUAGE plpgsql;
    CREATE TRIGGER fail_completion BEFORE UPDATE ON attempts FOR EACH ROW WHEN (NEW.id = '${interrupted}') EXECUTE FUNCTION fail_completion()`);
  assert.equal((await post(interrupted, "finish", interruptedMetadata)).status, 500);
  await database.query("DROP TRIGGER fail_completion ON attempts");
  assert.equal((await stored(interrupted)).length, 0, "the failure rolled back the check and the completion");
  assert.deepEqual((await rows("SELECT count(*)::int AS n FROM code_checkpoints WHERE attempt_id = $1 AND checkpoint_type = 'submission'", [interrupted])), [{ n: 1 }]);
  // The Draft changes before the retry; the check still runs against the recorded Submission.
  await database.query("UPDATE attempts SET draft_source = $2 WHERE id = $1", [interrupted, "def sum_odd_positions(values):\n    return 'changed'\n"]);
  respond = (input) => ({ status: "passed", testResults: input.tests.map(test => ({ testId: test.testId, outcome: "passed" })), runnerVersion: "fixture", harnessVersion: "fixture" });
  assert.equal((await finish(interrupted, interruptedMetadata)).submissionCheck.state, "checked");
  assert.equal(calls.at(-1).sourceCode, "def sum_odd_positions(values):\n    return 'first'\n", "the check runs against the recorded Submission");
  assert.deepEqual((await rows("SELECT count(*)::int AS n FROM code_checkpoints WHERE attempt_id = $1 AND checkpoint_type = 'submission'", [interrupted])), [{ n: 1 }]);
  assert.equal((await stored(interrupted)).length, 1);
  console.log("PASS a retried finish records one Submission and one Submission check");

  // The completed Attempt rejects new Evidence; recovery dispatch is unchanged.
  for (const [action, body] of [["run", envelope("late")], ["messages", { text: "Late", ...envelope("late") }], ["help", { category: "hint", ...envelope("late") }]]) assert.equal((await post(checked, action, body)).status, 409, action);
  await assert.rejects(database.query("UPDATE code_runs SET test_results = '[]' WHERE attempt_id = $1", [checked]), /completed attempt evidence is immutable/);
  await database.query("UPDATE reviews SET dispatch_claimed_at = now() - interval '2 minutes' WHERE attempt_id = $1", [checked]);
  const recovered = await finish(checked);
  assert.deepEqual([recovered.reviewId, recovered.dispatch, recovered.recoveryDispatch, recovered.submissionCheck], [result.reviewId, "queued", true, expected]);
  assert.equal((await stored(checked)).length, 1);
  console.log("PASS completed Attempt stays frozen; recovery dispatch is unchanged");

  // Mock, coach, voice, and Retry Attempts all get their own check; a Retry leaves its original unchanged.
  for (const options of [{ mode: "coach" }, { inputMode: "voice" }]) {
    const attemptId = await attempt(options);
    assert.equal((await finish(attemptId)).submissionCheck.state, "checked", JSON.stringify(options));
  }
  const originalBefore = await rows("SELECT * FROM code_runs WHERE attempt_id = $1 ORDER BY id", [checked]);
  const submissionCheckpoint = (await rows("SELECT id FROM code_checkpoints WHERE attempt_id = $1 AND checkpoint_type = 'submission'", [checked]))[0].id;
  const retry = await post(checked, "retry", { checkpointId: submissionCheckpoint, practiceGoal: "Handle the hidden cases" });
  assert.equal(retry.status, 201, await retry.clone().text());
  const { attemptId: retryId } = await retry.json();
  assert.deepEqual((await finish(retryId)).submissionCheck, { state: "checked", passed: 6, total: 6, failures: {} });
  assert.deepEqual(await rows("SELECT * FROM code_runs WHERE attempt_id = $1 ORDER BY id", [checked]), originalBefore);
  assert.deepEqual((await detail(checked)).submissionCheck, expected, "the original keeps its own check");
  console.log("PASS mock, coach, voice, and Retry Attempts each get a Submission check");

  // The Submission fills the last Event slot; the Submission check still closes the Attempt.
  const full = await attempt();
  await database.query("INSERT INTO attempt_events (id, attempt_id, event_type, source_id, source_order, occurrence_offset_ms) SELECT $1 || '-' || n, $1, 'draft_saved', 'filler:' || n, 0, 0 FROM generate_series(1, 9999) AS n", [full]);
  assert.equal((await finish(full)).submissionCheck.state, "checked");
  assert.equal((await rows("SELECT count(*)::int AS n FROM attempt_events WHERE attempt_id = $1", [full]))[0].n, 10_001);
  console.log("PASS the evidence limit never refuses the Submission check");

  // An active Attempt has no check, and another account cannot see one.
  assert.equal((await detail(await attempt())).submissionCheck, null);
  const foreign = await attempt({ user: "other" });
  assert.equal((await request(`/attempts/${foreign}`)).status, 403);
  console.log("PASS active Attempts have no Submission check");

  // Responses, the export, and the logs never contain hidden test definitions, outputs, or messages.
  const exported = await (await request("/me/export")).json();
  const exportedChecks = exported.runs.filter(run => run.run_kind === "submission");
  assert.ok(exportedChecks.some(run => run.check_state === "checked") && exportedChecks.some(run => run.check_state === "unavailable") && exportedChecks.some(run => run.check_state === "no hidden tests"));
  assert.deepEqual(exportedChecks.find(run => run.attempt_id === checked).test_results, submissionCheck.test_results);
  const responses = [JSON.stringify(exported), JSON.stringify(await detail(checked)), JSON.stringify(result), JSON.stringify(await (await request(`/attempts/${checked}/review`)).json())];
  for (const text of [...responses, logged.join("\n")]) for (const secret of secrets) assert.ok(!text.includes(secret), `${secret} leaked`);
  console.log("PASS no hidden input, expected value, output, or message text in responses, the export, or logs");

  // Account deletion removes every Submission check.
  const deleted = await request("/me", "DELETE", { password: "correct password" });
  assert.equal(deleted.status, 200, await deleted.clone().text());
  assert.deepEqual(await rows("SELECT count(*)::int AS n FROM attempts WHERE user_id = 'owner'"), [{ n: 0 }]);
  assert.deepEqual(await rows("SELECT count(*)::int AS n FROM code_runs WHERE run_kind = 'submission'"), [{ n: 0 }]);
  console.log("PASS account deletion removes Submission checks");
} finally {
  Object.assign(console, consoleMethods);
  globalThis.Request = NativeRequest;
  await drop();
  await rm(directory, { recursive: true, force: true });
}
