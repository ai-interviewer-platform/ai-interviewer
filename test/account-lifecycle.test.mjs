import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { after, test } from "node:test";
import { fakeSessions, withSessions } from "./fake-session.mjs";

const directory = await mkdtemp(join(tmpdir(), "account-lifecycle-"));
after(() => rm(directory, { recursive: true, force: true }));
await build({ entryPoints: ["src/request-handler.ts", "src/email.ts"], outdir: directory, outExtension: { ".js": ".mjs" }, bundle: true, format: "esm", platform: "node" });
const { handleRequest } = await import(pathToFileURL(join(directory, "request-handler.mjs")));
const handle = withSessions(handleRequest, fakeSessions({ userId: () => globalThis.accountTestUser ?? null }));
const { emailConfigured, passwordResetText, sendEmail, verificationText } = await import(pathToFileURL(join(directory, "email.mjs")));
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
  assert.equal((await handle(deleteRequest({ password: "correct password" }, { origin: "https://attacker.example" }), env, {}, untouched)).status, 403);

  globalThis.accountTestUser = null;
  const signedOut = database();
  assert.equal((await handle(deleteRequest({ password: "correct password" }), env, {}, signedOut)).status, 401);
  assert.equal(deletions(signedOut).length, 0);

  globalThis.accountTestUser = "owner";
  for (const body of [{}, { password: "" }, { password: "wrong" }]) {
    const pool = database();
    const response = await handle(deleteRequest(body), env, {}, pool);
    assert.equal(response.status, body.password === "wrong" ? 403 : 400);
    assert.equal(deletions(pool).length, 0, "nothing is deleted without the correct password");
  }

  const pool = database();
  const response = await handle(deleteRequest({ password: "correct password" }), env, {}, pool);
  assert.equal(response.status, 200);
  assert.deepEqual(deletions(pool).map(({ values }) => values), [["owner"]]);
});

test("data export is an attachment scoped to the signed-in user without hidden problem content", async () => {
  globalThis.accountTestUser = "owner";
  const pool = database();
  const response = await handle(new Request(`${origin}/api/me/export`), env, {}, pool);
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

test("email is skipped without Resend configuration and sent as plain text when configured", async () => {
  const originalFetch = globalThis.fetch;
  const sent = [];
  globalThis.fetch = async (url, init) => { sent.push({ url, init }); return new Response("{}", { status: sent.length > 1 ? 500 : 200 }); };
  try {
    for (const partial of [{}, { RESEND_API_KEY: "re_test" }, { EMAIL_FROM: "Coursay <no-reply@example.invalid>" }]) {
      assert.equal(emailConfigured(partial), false);
      await sendEmail(partial, "someone@example.invalid", "Subject", "Body");
    }
    assert.equal(sent.length, 0, "no request leaves the Worker without both values");

    const configured = { RESEND_API_KEY: "re_test", EMAIL_FROM: "Coursay <no-reply@example.invalid>" };
    const hostile = '"<script>alert(1)</script>"@example.invalid';
    await sendEmail(configured, hostile, "Reset", passwordResetText("https://app.example", "a&b<c>"));
    assert.equal(sent[0].url, "https://api.resend.com/emails");
    assert.equal(sent[0].init.headers.authorization, "Bearer re_test");
    const body = JSON.parse(sent[0].init.body);
    assert.deepEqual(Object.keys(body).sort(), ["from", "subject", "text", "to"], "no HTML body is ever sent");
    assert.deepEqual(body.to, [hostile]);
    assert.match(body.text, /https:\/\/app\.example\/#personal\?reset=a%26b%3Cc%3E\n/);
    await assert.rejects(sendEmail(configured, "someone@example.invalid", "Reset", "Body"), /status 500/);
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.match(verificationText("https://app.example", "jwt.token"), /^Confirm[\s\S]*https:\/\/app\.example\/api\/auth\/verify-email\?token=jwt\.token&callbackURL=%2F%23personal\n/);
});
