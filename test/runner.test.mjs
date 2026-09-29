import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { after, afterEach, test } from "node:test";
import { fixture } from "./runner/fixtures.mjs";

const directory = await mkdtemp(join(tmpdir(), "runner-"));
after(() => rm(directory, { recursive: true, force: true }));
await build({ entryPoints: ["src/runner.ts"], outdir: directory, outExtension: { ".js": ".mjs" }, bundle: true, format: "esm", platform: "node" });
const { inMemoryRunner, runnerConfigured, runnerFor } = await import(pathToFileURL(join(directory, "runner.mjs")));
const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });
const input = fixture();
const verdict = { status: "passed", testResults: input.tests.map(({ testId }) => ({ testId, outcome: "passed" })), runnerVersion: "fixture", harnessVersion: "fixture" };

test("the service binding is the preferred transport", async () => {
  let calls = 0;
  const env = { PYTHON_RUNNER: inMemoryRunner(() => { calls++; return verdict; }), PYTHON_RUNNER_URL: "https://runner.example/run", PYTHON_RUNNER_TOKEN: "unused" };
  globalThis.fetch = async () => { assert.fail("The remote URL must not be used"); };
  assert.equal(runnerConfigured(env), true);
  assert.equal((await runnerFor(env).run(input)).status, "completed");
  assert.equal(calls, 1);
});

test("the remote runner requires a fixed HTTPS URL and a paired secret", () => {
  for (const env of [
    {},
    { PYTHON_RUNNER_URL: "http://runner.example/run", PYTHON_RUNNER_TOKEN: "token" },
    { PYTHON_RUNNER_URL: "https://runner.example/run?target=other", PYTHON_RUNNER_TOKEN: "token" },
    { PYTHON_RUNNER_URL: "https://runner.example/run" },
  ]) {
    assert.equal(runnerConfigured(env), false);
    assert.equal(runnerFor(env), null);
  }
});

test("the remote runner receives only the run request and the server-held authorization", async () => {
  globalThis.fetch = async (target, init) => {
    assert.equal(String(target), "https://runner.example/run");
    assert.equal(init.method, "POST");
    assert.equal(init.redirect, "manual");
    assert.deepEqual(init.headers, { "content-type": "application/json", authorization: "Bearer server-runner-secret" });
    assert.deepEqual(JSON.parse(new TextDecoder().decode(init.body)), input);
    return Response.json(verdict);
  };
  const outcome = await runnerFor({ PYTHON_RUNNER_URL: "https://runner.example/run", PYTHON_RUNNER_TOKEN: "server-runner-secret" }).run(input);
  assert.deepEqual(outcome.result.testResults.map(({ testId }) => testId), ["empty", "values"]);
});
