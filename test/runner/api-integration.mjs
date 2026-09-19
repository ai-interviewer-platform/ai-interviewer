import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { parseEnv } from "node:util";
import pg from "pg";
import { createDockerRunner, prepareDocker } from "../../scripts/python-runner/docker.mjs";
import { createRunnerServer } from "../../scripts/python-runner/server.mjs";
import { correct } from "./fixtures.mjs";

const connectionString = process.env.DATABASE_URL ?? parseEnv(await readFile(".dev.vars", "utf8")).DATABASE_URL;
assert.ok(connectionString, "Set DATABASE_URL for local PostgreSQL");
assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(new URL(connectionString).hostname), "Use only local fictional data");
const image = await prepareDocker();
const schema = `runner_test_${crypto.randomUUID().replaceAll("-", "")}`;
const admin = new pg.Pool({ connectionString });
const database = new pg.Pool({ connectionString, options: `-c search_path=${schema}` });
const directory = await mkdtemp(join(tmpdir(), "runner-postgres-"));
const server = createRunnerServer(createDockerRunner(image), "fictional-integration-token");
const NativeRequest = globalThis.Request;
globalThis.Request = class extends NativeRequest {
  constructor(input, init) { super(input, init?.body instanceof ReadableStream ? { ...init, duplex: "half" } : init); }
};
try {
  await admin.query(`CREATE SCHEMA ${schema}`);
  for (const path of ["migrations/auth/0000_colorful_vindicator.sql", "migrations/0002_application.sql", "migrations/0003_security.sql"]) {
    await database.query((await readFile(path, "utf8")).replaceAll('"public".', `"${schema}".`));
  }
  await build({ entryPoints: ["src/api.ts"], outdir: directory, outExtension: { ".js": ".mjs" }, bundle: true, format: "esm", platform: "node", plugins: [{ name: "fictional-auth", setup(plugin) {
    plugin.onResolve({ filter: /^\.\/auth$/ }, () => ({ path: "auth", namespace: "test" }));
    plugin.onLoad({ filter: /.*/, namespace: "test" }, () => ({ contents: 'export const authenticatedUserId = async () => "fictional-runner-owner";' }));
  } }] });
  const { handleApi } = await import(pathToFileURL(join(directory, "api.mjs")));
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const runnerUrl = `http://127.0.0.1:${server.address().port}/run`;
  const env = { BETTER_AUTH_URL: "https://app.example", PERSONAL_DATA_COLLECTION_APPROVED: "true", PYTHON_RUNNER: { fetch: async request => fetch(runnerUrl, { method: "POST", headers: { authorization: "Bearer fictional-integration-token", "content-type": "application/json" }, body: await request.text() }) } };
  await database.query("INSERT INTO users (id, display_name, email) VALUES ('fictional-runner-owner', 'Runner Fixture', 'runner@example.invalid')");
  await database.query("INSERT INTO attempts (id, user_id, problem_id, mode, input_mode, status, setup_context, consent_at, disclosure_version, practice_goal) VALUES ('fictional-attempt', 'fictional-runner-owner', 'sum-odd-positions-v1', 'mock', 'text', 'active', '{}', now(), 'test', 'Fictional runner verification')");
  let order = 0;
  async function call(action, body, method = "POST") {
    assert.ok(method === "POST" || method === "PATCH");
    // The helper only sends POST/PATCH; it never sends a GET body.
    // eslint-disable-next-line unicorn/no-invalid-fetch-options
    const response = await handleApi(new Request(`https://app.example/api/attempts/fictional-attempt/${action}`, { method, headers: { origin: "https://app.example", "content-type": "application/json" }, body: JSON.stringify({ ...body, sourceId: crypto.randomUUID(), sourceOrder: ++order, occurrenceOffsetMs: order }) }), env, {}, database);
    assert.equal(response.status, 200, await response.clone().text());
    return response.json();
  }
  for (const [index, source, status] of [[0, correct.replace("solve", "sum_odd_positions"), "passed"], [1, "def sum_odd_positions(values):\n    return -1", "failed"]]) {
    await call("draft", { source, expectedRevision: index }, "PATCH");
    const result = await call("run", {});
    assert.equal(result.status, status);
    const stored = (await database.query("SELECT r.*, c.source_code, e.event_type FROM code_runs r JOIN code_checkpoints c ON c.id = r.checkpoint_id JOIN attempt_events e ON e.id = r.event_id WHERE r.id = $1", [result.runId])).rows[0];
    assert.equal(stored.source_code, source);
    assert.equal(stored.checkpoint_id, result.checkpointId);
    assert.equal(stored.event_type, "code_run");
    assert.equal(stored.status, status);
    assert.equal(stored.test_results.length, 2);
    assert.equal(stored.runner_version, "docker-python-local-v1");
    assert.ok(stored.execution_time_ms >= 0);
    console.log(`PASS API -> HTTP controller -> isolated Python -> PostgreSQL: ${status}`);
  }
  const before = Number((await database.query("SELECT count(*) FROM code_runs")).rows[0].count);
  env.PYTHON_RUNNER = { fetch: async () => new Response("{broken") };
  const rejected = await handleApi(new Request("https://app.example/api/attempts/fictional-attempt/run", { method: "POST", headers: { origin: "https://app.example", "content-type": "application/json" }, body: JSON.stringify({ sourceId: crypto.randomUUID(), sourceOrder: ++order, occurrenceOffsetMs: order }) }), env, {}, database);
  assert.equal(rejected.status, 503);
  assert.equal(Number((await database.query("SELECT count(*) FROM code_runs")).rows[0].count), before);
  console.log("PASS malformed runner result preserves checkpoint without recording a verdict");
} finally {
  await new Promise(resolve => server.close(resolve));
  globalThis.Request = NativeRequest;
  await database.end();
  await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  await admin.end();
  await rm(directory, { recursive: true, force: true });
}
