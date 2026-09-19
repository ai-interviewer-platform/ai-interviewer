import { isDeepStrictEqual } from "node:util";

export const limits = Object.freeze({ requestBytes: 256 * 1024, sourceBytes: 64 * 1024, outputBytes: 8192, tests: 16, testMs: 5000, runMs: 60_000 });
export const versions = Object.freeze({ runnerVersion: "docker-python-local-v1", harnessVersion: "json-positional-v1" });
const record = value => value !== null && typeof value === "object" && !Array.isArray(value);
const identifier = value => typeof value === "string" && /^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(value) && !value.startsWith("__");
const id = value => typeof value === "string" && value.length > 0 && value.length <= 256;

export function validateRequest(value) {
  if (!record(value) || !id(value.attemptId) || !id(value.checkpointId) || typeof value.sourceCode !== "string" || Buffer.byteLength(value.sourceCode) > limits.sourceBytes || !identifier(value.entryPoint)) return false;
  if (!record(value.testContract) || value.testContract.arguments !== "values: list" || value.testContract.return !== "JSON-serializable return value" || value.testContract.comparison !== "exact JSON equality") return false;
  if (!Array.isArray(value.tests) || value.tests.length === 0 || value.tests.length > limits.tests) return false;
  const ids = new Set();
  for (const item of value.tests) {
    if (!record(item) || !id(item.testId) || ids.has(item.testId) || !record(item.inputData) || Object.keys(item.inputData).length !== 1 || !Array.isArray(item.inputData.args) || item.inputData.args.length !== 1 || !Array.isArray(item.inputData.args[0]) || !Object.hasOwn(item, "expectedOutput")) return false;
    ids.add(item.testId);
  }
  return true;
}

export function candidateResult(test, output) {
  if (!record(output) || typeof output.stdout !== "string" || typeof output.stderr !== "string" || [output.stdout, output.stderr].some(value => Buffer.byteLength(value) > limits.outputBytes * 3)) throw new Error("Invalid candidate output");
  if (typeof output.error === "string" && Buffer.byteLength(output.error) <= limits.outputBytes * 3) return { testId: test.testId, outcome: "failed", error: output.error };
  if (!Object.hasOwn(output, "actualOutput") || Buffer.byteLength(JSON.stringify(output.actualOutput)) > limits.outputBytes) throw new Error("Invalid candidate return value");
  return { testId: test.testId, outcome: isDeepStrictEqual(output.actualOutput, test.expectedOutput) ? "passed" : "failed", actualOutput: output.actualOutput };
}

export function infrastructureResult(request, message) {
  return { ...versions, status: "runner_error", testResults: request.tests.map(({ testId }) => ({ testId, outcome: "skipped", error: message })), stdout: "", stderr: "", executionTimeMs: 0, runnerError: message };
}
