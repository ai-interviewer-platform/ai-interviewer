import type { Env, PythonRunner } from "./env";

function remoteRunnerUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.hash || url.search) return null;
    return url;
  } catch { return null; }
}

export function pythonRunnerConfigured(env: Env): boolean {
  if (env.PYTHON_RUNNER) return true;
  return Boolean(env.PYTHON_RUNNER_URL?.trim() && env.PYTHON_RUNNER_TOKEN?.trim() && remoteRunnerUrl(env.PYTHON_RUNNER_URL));
}

export function pythonRunnerFor(env: Env): PythonRunner | null {
  if (env.PYTHON_RUNNER) return env.PYTHON_RUNNER;
  const url = env.PYTHON_RUNNER_URL?.trim();
  const token = env.PYTHON_RUNNER_TOKEN?.trim();
  if (!url || !token) return null;
  const target = remoteRunnerUrl(url);
  if (!target) return null;
  return {
    async fetch(request: Request): Promise<Response> {
      return fetch(target, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: await request.arrayBuffer(),
        redirect: "manual",
        signal: AbortSignal.timeout(90_000),
      });
    },
  };
}
