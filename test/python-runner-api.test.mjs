import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { after, test } from "node:test";
import { infrastructureResult } from "../scripts/python-runner/contract.mjs";
import { fixture } from "./runner/fixtures.mjs";

// Node requires duplex for a streamed Request body; workerd does not.
const NativeRequest = globalThis.Request;
globalThis.Request = class extends NativeRequest {
  constructor(input, init) { super(input, init?.body instanceof ReadableStream ? { ...init, duplex: "half" } : init); }
};
after(() => { globalThis.Request = NativeRequest; });

const directory = await mkdtemp(join(tmpdir(), "runner-api-"));
after(() => rm(directory, { recursive: true, force: true }));
await build({ entryPoints: ["src/api.ts"], outdir: directory, outExtension: { ".js": ".mjs" }, bundle: true, format: "esm", platform: "node", plugins: [{ name: "test-auth", setup(plugin) {
  plugin.onResolve({ filter: /^\.\/auth$/ }, () => ({ path: "auth", namespace: "test" }));
  plugin.onLoad({ filter: /.*/, namespace: "test" }, () => ({ contents: 'export const authenticatedUserId = async () => "owner";' }));
} }] });
const { handleApi } = await import(pathToFileURL(join(directory, "api.mjs")));
const origin = "https://app.example";
const input = fixture();
const attempt = { id: input.attemptId, user_id: "owner", problem_id: "p", draft_source: input.sourceCode, draft_revision: 4, status: "active" };
const verdict = { runnerVersion: "fixture", harnessVersion: "fixture", status: "passed", testResults: input.tests.map(item => ({ testId: item.testId, outcome: "passed", actualOutput: item.expectedOutput })), stdout: "printed", stderr: "warning", executionTimeMs: 2 };
function database() {
  const writes = [];
  const pool = { writes, release() {}, async connect() { return pool; }, async query(sql, values) {
    if (sql.startsWith("INSERT INTO security_rate_limits")) return { rows: [{ count: 1 }] };
    if (sql.startsWith("SELECT * FROM attempts")) return { rows: [attempt] };
    if (sql.startsWith("SELECT status FROM attempts")) return { rows: [{ status: "active" }] };
    if (sql.startsWith("SELECT count(*)")) return { rows: [{ count: "0" }] };
    if (sql.includes("FROM problems p JOIN test_cases")) return { rows: input.tests.map(item => ({ id: item.testId, input_data: item.inputData, expected_output: item.expectedOutput, entry_point: input.entryPoint, test_contract: input.testContract })) };
    if (sql.startsWith("INSERT")) { writes.push({ sql, values }); return { rows: [{ id: values[0] }] }; }
    return { rows: [] };
  } };
  return pool;
}
async function request(binding, pool) {
  return handleApi(new Request(`${origin}/api/attempts/${attempt.id}/run`, { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify({ sourceId: "fictional-run", sourceOrder: 1, occurrenceOffsetMs: 0 }) }), { BETTER_AUTH_URL: origin, PERSONAL_DATA_COLLECTION_APPROVED: "true", PYTHON_RUNNER: binding }, {}, pool);
}

test("API sends stored source/visible tests and persists checkpoint, event and full result", async () => {
  const pool = database();
  const response = await request({ fetch: async received => {
    const body = await received.json();
    assert.equal(body.sourceCode, attempt.draft_source);
    assert.ok(body.checkpointId);
    assert.deepEqual(body.tests, input.tests);
    return Response.json(verdict);
  } }, pool);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.testsPassed, 2);
  const checkpoint = pool.writes.find(write => write.sql.startsWith("INSERT INTO code_checkpoints"));
  const run = pool.writes.find(write => write.sql.includes("INSERT INTO code_runs"));
  assert.equal(checkpoint.values[3], input.sourceCode);
  assert.equal(run.values[2], body.checkpointId);
  assert.deepEqual(run.values.slice(4, 11), ["passed", 2, 0, "printed", "warning", 2, null]);
  assert.deepEqual(JSON.parse(run.values[11]), verdict.testResults);
});

test("API rejects missing, duplicate and unexpected runner test IDs and malformed JSON", async () => {
  const invalid = ["{", JSON.stringify({ ...verdict, testResults: [verdict.testResults[0]] }), JSON.stringify({ ...verdict, testResults: [verdict.testResults[0], verdict.testResults[0]] }), JSON.stringify({ ...verdict, testResults: [{ testId: "forged", outcome: "passed" }, verdict.testResults[1]] }), "x".repeat(256 * 1024 + 1)];
  for (const body of invalid) {
    const pool = database();
    assert.equal((await request({ fetch: async () => new Response(body) }, pool)).status, 503);
    assert.ok(pool.writes.some(write => write.sql.startsWith("INSERT INTO code_checkpoints")));
    assert.ok(!pool.writes.some(write => write.sql.includes("INSERT INTO code_runs")));
  }
});

test("API distinguishes absent/unreachable runner from recorded infrastructure result", async () => {
  const missing = database();
  assert.equal((await request(undefined, missing)).status, 503);
  assert.equal(missing.writes.length, 0);
  for (const fetch of [async () => { throw new Error("offline"); }, async () => new Response("offline", { status: 503 })]) {
    const pool = database();
    assert.equal((await request({ fetch }, pool)).status, 503);
    assert.ok(!pool.writes.some(write => write.sql.includes("INSERT INTO code_runs")));
  }
  const pool = database();
  const response = await request({ fetch: async () => Response.json(infrastructureResult(input, "Fictional infrastructure failure")) }, pool);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.status, "runner_error");
  assert.equal(body.testsFailed, 0);
  assert.ok(pool.writes.some(write => write.sql.includes("INSERT INTO code_runs")));
});
