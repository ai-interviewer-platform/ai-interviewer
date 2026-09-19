import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { fixture } from "./runner/fixtures.mjs";
import { infrastructureResult } from "../scripts/python-runner/contract.mjs";

// Exercise the real workerd service binding and proxy. Candidate execution is
// deliberately simulated here; test:runner requires actual Docker execution.
test("Worker service binding forwards only runner data and the controller token", async () => {
  const bundle = await build({ entryPoints: ["src/python-runner-proxy.ts"], bundle: true, format: "esm", write: false });
  let calls = 0;
  const runtime = new Miniflare(convertV4MiniflareOptions({ workers: [
    { name: "main", modules: true, compatibilityDate: "2026-09-09", script: 'export default { fetch(request, env) { return env.PYTHON_RUNNER.fetch(new Request("https://python-runner/run", request)); } };', serviceBindings: { PYTHON_RUNNER: "proxy" } },
    { name: "proxy", modules: true, compatibilityDate: "2026-09-09", script: bundle.outputFiles[0].text, bindings: { LOCAL_RUNNER_TOKEN: "fictional-token" }, outboundService: async request => {
      calls++;
      assert.equal(request.url, "http://127.0.0.1:8791/run");
      assert.equal(request.headers.get("authorization"), "Bearer fictional-token");
      assert.equal(request.headers.get("cookie"), null);
      const body = await request.json();
      assert.deepEqual(body, fixture());
      return Response.json(infrastructureResult(body, "Simulated engine unavailable"));
    } },
  ] }));
  try {
    const response = await runtime.dispatchFetch("http://localhost/run", { method: "POST", headers: { cookie: "application-session-must-not-forward" }, body: JSON.stringify(fixture()) });
    assert.equal(response.status, 200, `calls=${calls} body=${await response.clone().text()}`);
    assert.equal((await response.json()).status, "runner_error");
    assert.equal(calls, 1);
    const proxy = await runtime.getWorker("proxy");
    assert.equal((await proxy.fetch("http://localhost/run", { method: "POST", body: "{}" })).status, 404);
  } finally { await runtime.dispose(); }
});
