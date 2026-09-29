// Hosted runner, reachable only through the PYTHON_RUNNER service binding. No app secrets or DB bindings.
import { Container, getContainer } from "@cloudflare/containers";
import { deadlines, executionResult, limits, runTests, validateRequest } from "../scripts/python-runner/contract.mjs";
import { boundedRequest, json } from "./http";

export class RunnerSandbox extends Container {
  defaultPort = 8080;
  // Backstop only: every run destroys its own instance.
  sleepAfter = "2m";
  enableInternet = false;
}

interface RunRequest { sourceCode: string; entryPoint: string }

export default {
  async fetch(request, env, ctx): Promise<Response> {
    const url = new URL(request.url);
    if (request.method !== "POST" || url.pathname !== "/run" || url.hostname !== "python-runner") return json({ error: "Not found" }, { status: 404 });
    if (request.headers.get("content-type")?.split(";")[0] !== "application/json") return json({ error: "Expected application/json" }, { status: 415 });
    const bounded = await boundedRequest(request, limits.requestBytes);
    if (bounded instanceof Response) return bounded;
    let body: RunRequest;
    try { body = await bounded.json(); } catch { return json({ error: "Malformed JSON request" }, { status: 400 }); }
    if (!validateRequest(body)) return json({ error: "Invalid runner request, test IDs, entry point, or unsupported test contract" }, { status: 400 });
    // A fresh container per run: no two runs or users ever share a sandbox.
    // ponytail: one run = one cold container start (seconds); a warm pool needs a proven per-run reset first.
    const sandbox = getContainer(env.RUNNER_SANDBOX, crypto.randomUUID());
    try {
      // Expected outputs and test IDs never enter the container; runTests judges its output here.
      return json(await runTests(body, async test => {
        const response = await sandbox.fetch(new Request("http://sandbox/exec", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ sourceCode: body.sourceCode, entryPoint: body.entryPoint, args: test.inputData.args }),
          // Covers a cold start; the sandbox enforces the 5 s candidate wall time itself.
          signal: AbortSignal.timeout(deadlines.sandboxRequestMs),
        }));
        if (!response.ok) throw new Error("Runner sandbox unavailable");
        return executionResult(test, await response.json());
      }, "cloudflare-container-python-v1"));
    } finally {
      ctx.waitUntil(sandbox.destroy().catch(() => {}));
    }
  },
} satisfies ExportedHandler<{ RUNNER_SANDBOX: DurableObjectNamespace<RunnerSandbox> }>;
