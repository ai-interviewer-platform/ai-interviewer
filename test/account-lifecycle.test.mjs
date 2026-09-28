import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { after, test } from "node:test";

const directory = await mkdtemp(join(tmpdir(), "account-lifecycle-"));
after(() => rm(directory, { recursive: true, force: true }));
await build({ entryPoints: ["src/api.ts"], outdir: directory, outExtension: { ".js": ".mjs" }, bundle: true, format: "esm", platform: "node", plugins: [{ name: "test-auth", setup(plugin) {
  plugin.onResolve({ filter: /^\.\/auth$/ }, () => ({ path: "auth", namespace: "test" }));
  plugin.onLoad({ filter: /.*/, namespace: "test" }, () => ({ contents: 'export const authenticatedUserId = async () => globalThis.accountTestUser ?? null; export const passwordMatches = async (_request, _env, _pool, password) => password === "correct password";' }));
} }] });
const { handleApi } = await import(pathToFileURL(join(directory, "api.mjs")));
const origin = "https://app.example";
const env = { BETTER_AUTH_URL: origin, PERSONAL_DATA_COLLECTION_APPROVED: "true" };
const deleteRequest = (body, headers = {}) => new Request(`${origin}/api/me`, { method: "DELETE", headers: { origin, "content-type": "application/json", ...headers }, body: JSON.stringify(body) });

function database() {
  const queries = [];
  return { queries, async query(sql, values) {
    queries.push({ sql, values });
    return { rows: sql.startsWith("INSERT INTO security_rate_limits") ? [{ count: 1 }] : [] };
  } };
}
const deletions = (pool) => pool.queries.filter(({ sql }) => sql.includes("delete_user_account"));

test("account deletion requires the exact origin, a session, and the current password", async () => {
  globalThis.accountTestUser = "owner";
  const untouched = { query: () => { throw new Error("Must reject before database access"); } };
  assert.equal((await handleApi(deleteRequest({ password: "correct password" }, { origin: "https://attacker.example" }), env, {}, untouched)).status, 403);

  globalThis.accountTestUser = null;
  const signedOut = database();
  assert.equal((await handleApi(deleteRequest({ password: "correct password" }), env, {}, signedOut)).status, 401);
  assert.equal(deletions(signedOut).length, 0);

  globalThis.accountTestUser = "owner";
  for (const body of [{}, { password: "" }, { password: "wrong" }]) {
    const pool = database();
    const response = await handleApi(deleteRequest(body), env, {}, pool);
    assert.equal(response.status, body.password === "wrong" ? 403 : 400);
    assert.equal(deletions(pool).length, 0, "nothing is deleted without the correct password");
  }

  const pool = database();
  const response = await handleApi(deleteRequest({ password: "correct password" }), env, {}, pool);
  assert.equal(response.status, 200);
  assert.deepEqual(deletions(pool).map(({ values }) => values), [["owner"]]);
});

test("data export is an attachment scoped to the signed-in user without hidden problem content", async () => {
  globalThis.accountTestUser = "owner";
  const pool = database();
  const response = await handleApi(new Request(`${origin}/api/me/export`), env, {}, pool);
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-disposition"), /^attachment; filename="coursay-export\.json"$/);
  const exported = await response.json();
  for (const key of ["user", "attempts", "events", "transcripts", "checkpoints", "runs", "reviews", "findings", "corrections"]) assert.ok(key in exported, key);
  const reads = pool.queries.filter(({ sql }) => sql.startsWith("SELECT"));
  assert.ok(reads.length >= 10);
  for (const { sql, values } of reads) {
    assert.deepEqual(values, ["owner"], sql);
    assert.match(sql, /\$1/);
    assert.doesNotMatch(sql, /reference_solution|test_cases|password|token/);
  }
});
