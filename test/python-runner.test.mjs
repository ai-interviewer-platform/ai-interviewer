import assert from "node:assert/strict";
import { test } from "node:test";
import { createRunnerServer } from "../scripts/python-runner/server.mjs";
import { candidateResult, infrastructureResult, limits, validateRequest } from "../scripts/python-runner/contract.mjs";
import { containerArgs, createDockerRunner } from "../scripts/python-runner/docker.mjs";
import { fixture } from "./runner/fixtures.mjs";

test("runner validates IDs, size, entry points and authored invocation contract", () => {
  assert.equal(validateRequest(fixture()), true);
  const mutations = [
    value => { value.tests.push(value.tests[0]); },
    value => { delete value.tests[0].testId; },
    value => { value.tests[0].testId = 42; },
    value => { value.tests = []; },
    value => { value.tests = Array.from({ length: 17 }, (_, index) => ({ ...value.tests[0], testId: String(index) })); },
    value => { value.tests[0].inputData = { args: [42] }; },
    value => { value.tests[0].inputData.kwargs = {}; },
    value => { delete value.tests[0].expectedOutput; },
    value => { value.entryPoint = "os.system"; },
    value => { value.entryPoint = "__import__"; },
    value => { value.testContract.comparison = "eval"; },
    value => { value.sourceCode = "a".repeat(limits.sourceBytes + 1); },
  ];
  for (const mutate of mutations) { const value = fixture(); mutate(value); assert.equal(validateRequest(value), false); }
});

test("positional contract accepts any JSON arguments within the argument limit", () => {
  const positional = () => ({ ...fixture(), testContract: { ...fixture().testContract, arguments: "positional JSON arguments" } });
  for (const args of [[], [42], ["text", [1, 2], { key: null }], Array.from({ length: limits.arguments }, (_, index) => index)]) {
    const value = positional();
    value.tests[0].inputData = { args };
    assert.equal(validateRequest(value), true, JSON.stringify(args));
  }
  const tooMany = positional();
  tooMany.tests[0].inputData = { args: Array.from({ length: limits.arguments + 1 }, () => 0) };
  assert.equal(validateRequest(tooMany), false);
  const notArray = positional();
  notArray.tests[0].inputData = { args: 42 };
  assert.equal(validateRequest(notArray), false);
  const unknown = positional();
  unknown.testContract.arguments = "keyword arguments";
  assert.equal(validateRequest(unknown), false);
});

test("verdict and identity are assigned outside candidate output using JSON equality", () => {
  const item = fixture().tests[0];
  assert.deepEqual(candidateResult(item, { actualOutput: 0, stdout: "", stderr: "", testId: "forged", outcome: "failed" }), { testId: "empty", outcome: "passed", actualOutput: 0 });
  assert.equal(candidateResult(item, { actualOutput: false, stdout: "", stderr: "" }).outcome, "failed");
  assert.throws(() => candidateResult(item, { outcome: "passed", stdout: "", stderr: "" }));
  assert.throws(() => candidateResult(item, { actualOutput: "a".repeat(limits.outputBytes + 1), stdout: "", stderr: "" }));
});

test("Docker invocation has no network, mounts, secrets or candidate-controlled flags", () => {
  const args = containerArgs("test-name", "sha256:fixed-image");
  for (const flag of ["--network=none", "--read-only", "--user=65534:65534", "--cap-drop=ALL", "--security-opt=no-new-privileges", "--memory=128m", "--memory-swap=128m", "--pids-limit=32", "--cpus=1"]) assert.ok(args.includes(flag));
  assert.ok(!args.some(flag => /^--(mount|volume|env|privileged)/.test(flag)));
});

test("controller handles timeout, cleanup, infrastructure failure and exactly-once IDs", async () => {
  const calls = [];
  const run = createDockerRunner("image", async (args, options) => {
    calls.push(args);
    if (args[0] === "start") {
      const input = JSON.parse(options.input);
      assert.deepEqual(Object.keys(input).sort(), ["args", "entryPoint", "sourceCode"]);
      return { code: null, failure: "timeout", stdout: "", stderr: "" };
    }
    return { code: 0, stdout: "", stderr: "" };
  });
  const result = await run(fixture());
  assert.equal(result.status, "failed");
  assert.equal(result.testResults.length, 2);
  assert.deepEqual(result.testResults.map(item => item.testId), ["empty", "values"]);
  assert.ok(result.testResults.every(item => /timeout/.test(item.error)));
  assert.equal(calls.filter(args => args[0] === "rm").length, 2);
  let failures = 0;
  const unavailable = createDockerRunner("image", async () => { failures++; return { code: 1 }; });
  const error = await unavailable(fixture());
  assert.equal(error.status, "runner_error");
  assert.ok(error.testResults.every(item => item.outcome === "skipped"));
  const count = failures;
  assert.equal((await unavailable(fixture())).status, "runner_error");
  assert.equal(failures, count, "cleanup failure disables further execution");
});

test("HTTP boundary rejects unauthenticated, malformed and oversized requests", async () => {
  let executions = 0;
  const server = createRunnerServer(async value => { executions++; return infrastructureResult(value, "Fictional unavailable engine"); }, "test-token");
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${server.address().port}/run`;
  const send = (body, extra = {}) => fetch(url, { method: "POST", headers: { authorization: "Bearer test-token", "content-type": "application/json", ...extra }, body });
  try {
    assert.equal((await send(JSON.stringify(fixture()), { authorization: "wrong" })).status, 403);
    assert.equal((await send(JSON.stringify(fixture()), { origin: "http://evil.example" })).status, 403);
    assert.equal((await send("{" )).status, 400);
    assert.equal((await send("{}" )).status, 400);
    assert.equal((await send("{}", { "content-type": "text/plain" })).status, 415);
    assert.equal((await send("a".repeat(limits.requestBytes + 1))).status, 413);
    const result = await send(JSON.stringify(fixture()));
    assert.equal(result.status, 200);
    assert.equal((await result.json()).status, "runner_error");
    assert.equal(executions, 1);
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test("controller compares each value, captures streams and distinguishes engine failures", async () => {
  const input = fixture();
  let index = 0;
  const run = createDockerRunner("image", async args => {
    if (args[0] === "start") return { code: 0, stdout: JSON.stringify({ actualOutput: index++ === 0 ? 0 : -1, stdout: "printed\n", stderr: "warning\n" }) };
    if (args[0] === "inspect") return { code: 0, stdout: JSON.stringify({ Status: "exited", ExitCode: 0, Running: false, Error: "", OOMKilled: false }) };
    return { code: 0, stdout: "" };
  });
  const result = await run(input);
  assert.equal(result.status, "failed");
  assert.deepEqual(result.testResults.map(item => item.outcome), ["passed", "failed"]);
  assert.equal(result.stdout, "printed\nprinted\n");
  assert.equal(result.stderr, "warning\nwarning\n");
  const broken = createDockerRunner("image", async args => ({ code: args[0] === "create" ? 1 : 0, stdout: "" }));
  assert.equal((await broken(input)).status, "runner_error");
});
