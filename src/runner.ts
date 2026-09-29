// The Runner: runs the visible test cases of one Checkpoint in the isolated Python runner.
// It owns the request, the transport, the deadline, the size limit, and the result check.
import { deadlines, limits as runnerLimits } from "../scripts/python-runner/contract.mjs";
import type { Env, PythonRunner } from "./env";
import { boundedBytes, string } from "./http";
import { logOperationalEvent } from "./observability";

export type RunnerResult = {
  status: "passed" | "failed" | "runner_error";
  testResults: Array<{ testId: string; outcome: "passed" | "failed" | "skipped"; actualOutput?: unknown; error?: string }>;
  stdout?: string;
  stderr?: string;
  executionTimeMs?: number;
  runnerVersion: string;
  harnessVersion: string;
  runnerError?: string;
};

export type RunInput = {
  attemptId: string;
  checkpointId: string;
  sourceCode: string;
  entryPoint: string;
  testContract: unknown;
  tests: Array<{ testId: string; inputData: unknown; expectedOutput: unknown }>;
};

export type RunOutcome =
  | { status: "completed"; result: RunnerResult }
  | { status: "unavailable"; reason: "unreachable" | "http failure" | "invalid result" | "too large" };

export interface Runner {
  run(input: RunInput): Promise<RunOutcome>;
}

function remoteRunnerUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.hash || url.search) return null;
    return url;
  } catch { return null; }
}

// The transport: the PYTHON_RUNNER service binding (the hosted runner, or the local
// proxy in development, or an in-memory adapter in tests), else a remote HTTPS URL.
function transportFor(env: Env): PythonRunner | null {
  if (env.PYTHON_RUNNER) return env.PYTHON_RUNNER;
  const url = env.PYTHON_RUNNER_URL?.trim();
  const token = env.PYTHON_RUNNER_TOKEN?.trim();
  const target = url && token ? remoteRunnerUrl(url) : null;
  if (!target) return null;
  return {
    async fetch(request: Request): Promise<Response> {
      return fetch(target, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: await request.arrayBuffer(),
        redirect: "manual",
        signal: AbortSignal.timeout(deadlines.transportMs),
      });
    },
  };
}

// A binding-shaped transport for tests: no container or Python process starts.
// `respond` returns the result body, or a Response, or throws for an unreachable runner.
export function inMemoryRunner(respond: (input: RunInput) => unknown): PythonRunner {
  return {
    async fetch(request: Request): Promise<Response> {
      const output = await respond(await request.json());
      return output instanceof Response ? output : Response.json(output);
    },
  };
}

export function runnerConfigured(env: Env): boolean {
  return transportFor(env) !== null;
}

// Every test ID must come back exactly once, with a known outcome.
function checkedResult(value: unknown, permittedTestIds: Set<string>): RunnerResult | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  const status = string(candidate.status);
  const runnerVersion = string(candidate.runnerVersion);
  const harnessVersion = string(candidate.harnessVersion);
  if ((status !== "passed" && status !== "failed" && status !== "runner_error") || !runnerVersion || !harnessVersion || !Array.isArray(candidate.testResults)) return null;
  const testResults: RunnerResult["testResults"] = [];
  const receivedTestIds = new Set<string>();
  for (const item of candidate.testResults) {
    if (typeof item !== "object" || item === null || Array.isArray(item)) return null;
    const result = item as Record<string, unknown>;
    const testId = string(result.testId);
    const outcome = string(result.outcome);
    if (!testId || !permittedTestIds.has(testId) || receivedTestIds.has(testId) || (outcome !== "passed" && outcome !== "failed" && outcome !== "skipped")) return null;
    receivedTestIds.add(testId);
    testResults.push({ testId, outcome, actualOutput: result.actualOutput, error: string(result.error) ?? undefined });
  }
  if (receivedTestIds.size !== permittedTestIds.size) return null;
  const executionTimeMs = typeof candidate.executionTimeMs === "number" && Number.isSafeInteger(candidate.executionTimeMs) && candidate.executionTimeMs >= 0 ? candidate.executionTimeMs : undefined;
  return {
    status,
    testResults,
    stdout: string(candidate.stdout) ?? "",
    stderr: string(candidate.stderr) ?? "",
    executionTimeMs,
    runnerVersion,
    harnessVersion,
    runnerError: string(candidate.runnerError) ?? undefined,
  };
}

export function runnerFor(env: Env): Runner | null {
  const transport = transportFor(env);
  if (!transport) return null;
  return {
    async run(input) {
      let response: Response;
      try {
        response = await transport.fetch(new Request("https://python-runner/run", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(input),
          signal: AbortSignal.timeout(deadlines.requestMs),
        }));
      } catch {
        logOperationalEvent("warn", "runner_unreachable");
        return { status: "unavailable", reason: "unreachable" };
      }
      if (!response.ok) {
        logOperationalEvent("warn", "runner_http_failure", { status: response.status });
        return { status: "unavailable", reason: "http failure" };
      }
      let result: RunnerResult | null;
      try {
        const bytes = await boundedBytes(response.body, runnerLimits.requestBytes);
        if (!bytes) return { status: "unavailable", reason: "too large" };
        result = checkedResult(JSON.parse(new TextDecoder().decode(bytes)), new Set(input.tests.map((test) => test.testId)));
      } catch {
        result = null;
      }
      if (!result) {
        logOperationalEvent("warn", "runner_invalid_result");
        return { status: "unavailable", reason: "invalid result" };
      }
      return { status: "completed", result };
    },
  };
}
