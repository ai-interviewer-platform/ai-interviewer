import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { after, afterEach, test } from "node:test";

const directory = await mkdtemp(join(tmpdir(), "runner-client-"));
after(() => rm(directory, { recursive: true, force: true }));
await build({ entryPoints: ["src/python-runner-client.ts"], outdir: directory, outExtension: { ".js": ".mjs" }, bundle: true, format: "esm", platform: "node" });
const { pythonRunnerConfigured, pythonRunnerFor } = await import(pathToFileURL(join(directory, "python-runner-client.mjs")));
const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

test("service binding remains the preferred production runner transport", async () => {
  const binding = { fetch: async () => Response.json({ ok: true }) };
  const env = { PYTHON_RUNNER: binding, PYTHON_RUNNER_URL: "https://runner.example/run", PYTHON_RUNNER_TOKEN: "unused" };
  assert.equal(pythonRunnerConfigured(env), true);
  assert.equal(pythonRunnerFor(env), binding);
});

test("remote runner requires fixed HTTPS URL and paired secret", () => {
  for (const env of [
    {},
    { PYTHON_RUNNER_URL: "http://runner.example/run", PYTHON_RUNNER_TOKEN: "token" },
    { PYTHON_RUNNER_URL: "https://runner.example/run?target=other", PYTHON_RUNNER_TOKEN: "token" },
    { PYTHON_RUNNER_URL: "https://runner.example/run" },
  ]) {
    assert.equal(pythonRunnerConfigured(env), false);
    assert.equal(pythonRunnerFor(env), null);
  }
});

test("remote runner forwards only JSON body and server-held authorization", async () => {
  globalThis.fetch = async (target, init) => {
    assert.equal(String(target), "https://runner.example/run");
    assert.equal(init.method, "POST");
    assert.equal(init.redirect, "manual");
    assert.equal(init.headers.authorization, "Bearer server-runner-secret");
    assert.equal(init.headers.cookie, undefined);
    assert.equal(init.headers.origin, undefined);
    assert.deepEqual(JSON.parse(new TextDecoder().decode(init.body)), { sourceCode: "print('fictional')" });
    return Response.json({ status: "runner_error" });
  };
  const runner = pythonRunnerFor({ PYTHON_RUNNER_URL: "https://runner.example/run", PYTHON_RUNNER_TOKEN: "server-runner-secret" });
  const response = await runner.fetch(new Request("https://python-runner/run", { method: "POST", headers: { cookie: "must-not-forward", origin: "https://app.example" }, body: JSON.stringify({ sourceCode: "print('fictional')" }) }));
  assert.equal(response.status, 200);
});
