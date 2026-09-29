import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";
import { deadlines, limits } from "../scripts/python-runner/contract.mjs";
import { fixture } from "./runner/fixtures.mjs";

// The real hosted Worker with @cloudflare/containers replaced by a fake container.
// test/runner/hosted-container.test.mjs executes the real image.
const stub = { name: "containers-stub", setup(build) {
  build.onResolve({ filter: /^@cloudflare\/containers$/ }, () => ({ path: "stub", namespace: "stub" }));
  build.onLoad({ filter: /.*/, namespace: "stub" }, () => ({ contents: "export class Container {} export const getContainer = (namespace, name) => namespace.get(name);" }));
} };
const bundle = await build({ entryPoints: ["src/python-runner-hosted.ts"], bundle: true, format: "esm", platform: "node", write: false, plugins: [stub] });
const worker = (await import(`data:text/javascript,${encodeURIComponent(bundle.outputFiles[0].text)}`)).default;
const ok = (actualOutput, extra = {}) => ({ exitCode: 0, timedOut: false, oversized: false, stdout: JSON.stringify({ actualOutput, stdout: "", stderr: "", ...extra }) });

async function hosted(request, respond, init = {}) {
  const sandboxes = [];
  const pending = [];
  const env = { RUNNER_SANDBOX: { get(name) {
    const sandbox = { name, bodies: [], destroyed: false, async destroy() { sandbox.destroyed = true; },
      async fetch(request) { sandbox.bodies.push(await request.json()); return respond(sandbox.bodies.length - 1); } };
    sandboxes.push(sandbox);
    return sandbox;
  } } };
  const response = await worker.fetch(new Request(init.url ?? "https://python-runner/run", { method: "POST", headers: { "content-type": "application/json", ...init.headers }, body: init.body ?? JSON.stringify(request) }), env, { waitUntil: promise => pending.push(promise) });
  await Promise.all(pending);
  return { response, body: response.headers.get("content-type")?.includes("json") ? await response.json() : undefined, sandboxes };
}

test("hosted runner judges in the Worker, sends no expected data, and destroys a fresh sandbox per run", async () => {
  const { body, sandboxes } = await hosted(fixture(), index => Response.json(ok(index === 0 ? 0 : -1, { stdout: "printed\n", testId: "forged", outcome: "passed" })));
  assert.equal(body.status, "failed");
  assert.equal(body.runnerVersion, "cloudflare-container-python-v1");
  assert.equal(body.harnessVersion, "json-positional-v1");
  assert.deepEqual(body.testResults, [{ testId: "empty", outcome: "passed", actualOutput: 0 }, { testId: "values", outcome: "failed", actualOutput: -1 }]);
  assert.equal(body.stdout, "printed\nprinted\n");
  assert.equal(sandboxes.length, 1);
  assert.ok(sandboxes[0].destroyed);
  for (const sent of sandboxes[0].bodies) assert.deepEqual(Object.keys(sent).sort(), ["args", "entryPoint", "sourceCode"]);
  assert.deepEqual(sandboxes[0].bodies.map(sent => sent.args), [[[]], [[4, 7, 2, 9]]]);
  const second = await hosted(fixture(), () => Response.json(ok(0)));
  assert.notEqual(second.sandboxes[0].name, sandboxes[0].name);
});

test("timeouts, exits and oversized output fail the test; sandbox failures skip the rest", async () => {
  const failed = await hosted(fixture(), index => Response.json(index === 0 ? { exitCode: -9, timedOut: true, oversized: false, stdout: "" } : { exitCode: 0, timedOut: false, oversized: true, stdout: "" }));
  assert.deepEqual(failed.body.testResults.map(item => item.error), ["Execution timeout", "Output limit exceeded"]);
  assert.equal(failed.body.status, "failed");
  const exited = await hosted(fixture(), () => Response.json({ exitCode: -24, timedOut: false, oversized: false, stdout: "" }));
  assert.equal(exited.body.testResults[0].error, "Candidate process exited (-24)");
  const broken = await hosted(fixture(), () => new Response("Failed to start container", { status: 500 }));
  assert.equal(broken.body.status, "runner_error");
  assert.deepEqual(broken.body.testResults.map(item => item.outcome), ["skipped", "skipped"]);
  assert.equal(broken.sandboxes[0].bodies.length, 1, "no further tests after an infrastructure failure");
  assert.ok(broken.sandboxes[0].destroyed);
  const thrown = await hosted(fixture(), () => { throw new Error("Network connection lost."); });
  assert.equal(thrown.body.status, "runner_error");
});

test("tests after the 60 s run deadline are skipped", async () => {
  const now = performance.now;
  let clock = 0;
  performance.now = () => clock;
  try {
    const { body } = await hosted(fixture(), () => { clock += deadlines.runMs; return Response.json(ok(0)); });
    assert.deepEqual(body.testResults.map(item => item.outcome), ["passed", "skipped"]);
    assert.equal(body.testResults[1].error, "Run deadline exceeded");
    assert.equal(body.status, "failed");
  } finally { performance.now = now; }
});

test("a final response over 256 KiB becomes a runner error", async () => {
  const request = fixture();
  request.tests = Array.from({ length: limits.tests }, (_, index) => ({ testId: `t${index}`, inputData: { args: [[]] }, expectedOutput: 0 }));
  const huge = JSON.stringify({ error: "\u0001".repeat(limits.outputBytes * 3), stdout: "", stderr: "" });
  const { body } = await hosted(request, () => Response.json({ exitCode: 0, timedOut: false, oversized: false, stdout: huge }));
  assert.equal(body.status, "runner_error");
  assert.equal(body.runnerError, "Runner response exceeds 256 KiB");
  assert.equal(body.runnerVersion, "cloudflare-container-python-v1");
});

test("HTTP boundary rejects wrong routes, types, sizes and contracts without starting a sandbox", async () => {
  const never = () => { throw new Error("sandbox must not start"); };
  for (const [init, status] of [[{ url: "https://python-runner/other" }, 404], [{ url: "https://evil.example/run" }, 404], [{ headers: { "content-type": "text/plain" } }, 415], [{ body: "a".repeat(limits.requestBytes + 1) }, 413], [{ body: "{" }, 400], [{ body: "{}" }, 400]]) {
    const { response, sandboxes } = await hosted(fixture(), never, init);
    assert.equal(response.status, status, JSON.stringify(init).slice(0, 80));
    assert.equal(sandboxes.length, 0);
  }
  const get = await worker.fetch(new Request("https://python-runner/run"), {}, { waitUntil() {} });
  assert.equal(get.status, 404);
});
