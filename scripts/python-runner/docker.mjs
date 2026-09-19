import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { candidateResult, infrastructureResult, limits, versions } from "./contract.mjs";

export const imageTag = "ai-interviewer-python:local-v1";
const docker = process.env.PYTHON_RUNNER_DOCKER ?? "docker";

// No shell, candidate-controlled command arguments, mounts, or forwarded env.
export function containerArgs(name, image) {
  return ["create", "--name", name, "--network=none", "--read-only", "--user=65534:65534", "--cap-drop=ALL", "--security-opt=no-new-privileges", "--memory=128m", "--memory-swap=128m", "--cpus=1", "--pids-limit=32", "--ulimit=cpu=2:2", "--ulimit=fsize=65536:65536", "--ulimit=nofile=64:64", "--ulimit=core=0:0", "--tmpfs=/tmp:rw,noexec,nosuid,size=16m,mode=1777", "--log-driver=none", "-i", image];
}

export function dockerCommand(args, { input, timeoutMs = 10_000, maxBytes = 256 * 1024 } = {}) {
  return new Promise(resolve => {
    const child = spawn(docker, args, { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    const chunks = [[], []];
    let bytes = 0;
    let failure;
    const timer = setTimeout(() => { failure = "timeout"; child.kill("SIGKILL"); }, timeoutMs);
    [child.stdout, child.stderr].forEach((stream, index) => stream.on("data", chunk => {
      bytes += chunk.length;
      if (bytes > maxBytes) { failure = "output_limit"; child.kill("SIGKILL"); }
      else chunks[index].push(chunk);
    }));
    child.stdin.on("error", () => {});
    child.on("error", () => { failure = "unavailable"; });
    child.on("close", code => {
      clearTimeout(timer);
      resolve({ code, failure, stdout: Buffer.concat(chunks[0]).toString("utf8"), stderr: Buffer.concat(chunks[1]).toString("utf8") });
    });
    child.stdin.end(input);
  });
}

export async function prepareDocker() {
  const info = await dockerCommand(["info", "--format", "{{json .}}"]);
  if (info.code !== 0) throw new Error("Docker Linux engine is unavailable. Start Docker Desktop and enable WSL integration if needed.");
  const settings = JSON.parse(info.stdout);
  if (settings.OSType !== "linux" || !settings.MemoryLimit || !settings.SwapLimit || !settings.PidsLimit || !settings.CpuCfsQuota || !settings.SecurityOptions?.some(option => option.includes("seccomp"))) throw new Error("Docker must enforce Linux memory, swap, PID, CPU and seccomp controls.");
  const image = await dockerCommand(["image", "inspect", imageTag, "--format", "{{.Id}}"]);
  if (image.code !== 0 || !/^sha256:[a-f0-9]{64}$/.test(image.stdout.trim())) throw new Error("Runner image is missing. Run npm run runner:build.");
  return image.stdout.trim();
}

export function createDockerRunner(image, command = dockerCommand) {
  let active = false;
  let unhealthy = false;
  return async request => {
    if (unhealthy) return infrastructureResult(request, "Runner cleanup failed. Restart the controller after checking Docker.");
    if (active) return infrastructureResult(request, "Runner is busy. Retry later.");
    active = true;
    const start = performance.now();
    const result = { ...versions, status: "passed", testResults: [], stdout: "", stderr: "", executionTimeMs: 0 };
    try {
      for (const test of request.tests) {
        if (result.runnerError || performance.now() - start >= limits.runMs) {
          result.status = result.runnerError ? "runner_error" : "failed";
          result.testResults.push({ testId: test.testId, outcome: "skipped", error: result.runnerError ?? "Run deadline exceeded" });
          continue;
        }
        const name = `interviewer-python-${randomUUID()}`;
        let outcome;
        let output;
        try {
          const created = await command(containerArgs(name, image));
          if (created.code !== 0 || created.failure) throw new Error("Runner container could not be created.");
          const executed = await command(["start", "--attach", "--interactive", name], {
            input: JSON.stringify({ sourceCode: request.sourceCode, entryPoint: request.entryPoint, args: test.inputData.args }),
            timeoutMs: Math.min(limits.testMs, Math.max(1, limits.runMs - (performance.now() - start))),
          });
          if (executed.failure === "unavailable") throw new Error("Runner transport is unavailable.");
          if (executed.failure) outcome = { testId: test.testId, outcome: "failed", error: executed.failure === "timeout" ? "Execution timeout" : "Output limit exceeded" };
          else {
            const inspected = await command(["inspect", "--format", "{{json .State}}", name]);
            if (inspected.code !== 0 || inspected.failure) throw new Error("Runner could not inspect execution state.");
            const state = JSON.parse(inspected.stdout);
            if (state.Error || state.Running || state.Status !== "exited") throw new Error("Runner container did not complete normally.");
            if (state.ExitCode !== 0 || state.OOMKilled) outcome = { testId: test.testId, outcome: "failed", error: state.OOMKilled ? "Memory limit exceeded" : `Candidate process exited (${state.ExitCode})` };
            else {
              try {
                output = JSON.parse(executed.stdout);
                outcome = candidateResult(test, output);
              } catch {
                output = undefined;
                outcome = { testId: test.testId, outcome: "failed", error: "Candidate returned invalid or oversized output" };
              }
            }
          }
        } catch {
          result.runnerError = "Runner infrastructure failed; this is not a code verdict.";
          outcome = { testId: test.testId, outcome: "skipped", error: result.runnerError };
        } finally {
          // Killing the CLI alone does not stop a container. Always remove it.
          const removed = await command(["rm", "--force", name]);
          if (removed.code !== 0 || removed.failure) {
            unhealthy = true;
            result.runnerError = "Runner cleanup failed. Check Docker before restarting the controller.";
            outcome = { testId: test.testId, outcome: "skipped", error: result.runnerError };
          }
        }
        result.testResults.push(outcome);
        for (const stream of ["stdout", "stderr"]) result[stream] = Buffer.from(result[stream] + (output?.[stream] ?? "")).subarray(0, limits.outputBytes).toString("utf8");
        if (outcome.error && !output?.stderr) result.stderr = Buffer.from(result.stderr + outcome.error + "\n").subarray(0, limits.outputBytes).toString("utf8");
        if (result.runnerError) result.status = "runner_error";
        else if (outcome.outcome !== "passed") result.status = "failed";
      }
    } finally { active = false; }
    result.executionTimeMs = Math.round(performance.now() - start);
    // JSON escaping can expand strings considerably; stay below API's 256 KiB.
    if (Buffer.byteLength(JSON.stringify(result)) > limits.requestBytes) return { ...infrastructureResult(request, "Runner response exceeds 256 KiB"), executionTimeMs: result.executionTimeMs };
    return result;
  };
}
