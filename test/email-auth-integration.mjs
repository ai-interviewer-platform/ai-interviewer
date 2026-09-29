// Better Auth email verification and password reset against PostgreSQL, with
// Resend replaced by a fetch mock. No email leaves this process.
// DATABASE_URL=<local database> node test/email-auth-integration.mjs
import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { testDatabase } from "./postgres-harness.mjs";

const { pool: database, drop } = await testDatabase("email_test", { problemBank: false });
// Inside the repository (ignored output/) so external packages resolve from node_modules.
await mkdir("output", { recursive: true });
const directory = resolve(await mkdtemp(join("output", "email-auth-")));
const originalFetch = globalThis.fetch;
const sent = [];
globalThis.fetch = async (url, init) => {
  assert.equal(url, "https://api.resend.com/emails");
  sent.push(JSON.parse(init.body));
  return new Response("{}", { status: 200 });
};

try {
  await build({ entryPoints: ["src/auth.ts"], outdir: directory, outExtension: { ".js": ".mjs" }, bundle: true, packages: "external", format: "esm", platform: "node" });
  const { authFor } = await import(pathToFileURL(join(directory, "auth.mjs")));
  const origin = "http://localhost:8795";
  const base = { BETTER_AUTH_URL: origin, BETTER_AUTH_SECRET: "fictional-test-secret-with-enough-length-0123456789" };
  const withEmail = { ...base, RESEND_API_KEY: "re_test", EMAIL_FROM: "Coursay <no-reply@example.invalid>" };
  let ip = 0;
  const call = (env, path, body, cookie = "") => authFor(env, database).handler(new Request(`${origin}/api/auth${path}`, body === undefined
    ? { headers: { cookie, "cf-connecting-ip": `192.0.2.${++ip}` } }
    : { method: "POST", headers: { origin, cookie, "content-type": "application/json", "cf-connecting-ip": `192.0.2.${++ip}` }, body: JSON.stringify(body) }));
  const email = `email-${crypto.randomUUID()}@example.invalid`;

  const signUp = await call(withEmail, "/sign-up/email", { email, password: "first-password", name: "<b>Fictional</b>" });
  assert.equal(signUp.status, 200);
  assert.equal((await signUp.json()).token, null, "no session before verification");
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0].to, [email]);
  assert.equal(sent[0].html, undefined);
  assert.doesNotMatch(sent[0].text, /Fictional/, "the display name is never placed in email");
  const verifyUrl = new URL(sent[0].text.match(/https?:\/\/\S+verify-email\S+/)[0]);
  assert.equal(verifyUrl.origin, origin);
  assert.equal((await call(withEmail, "/sign-in/email", { email, password: "first-password" })).status, 403, "unverified accounts cannot sign in");
  assert.equal(sent.length, 2, "sign-in resends the confirmation link");

  const verified = await call(withEmail, `/verify-email${verifyUrl.search}`);
  assert.equal(verified.status, 302);
  assert.equal(verified.headers.get("location"), "/#personal");
  assert.match(verified.headers.get("set-cookie") ?? "", /session_token=/);
  const session = await call(withEmail, "/sign-in/email", { email, password: "first-password" });
  assert.equal(session.status, 200);
  const cookie = session.headers.getSetCookie().map((value) => value.split(";", 1)[0]).join("; ");
  console.log("Passed: sign-up confirmation email, blocked unverified sign-in, verification link");

  assert.equal((await call(withEmail, "/request-password-reset", { email })).status, 200);
  const resetUrl = new URL(sent.at(-1).text.match(/https?:\/\/\S+reset=\S+/)[0]);
  assert.equal(resetUrl.origin, origin);
  const token = decodeURIComponent(resetUrl.hash.split("reset=")[1]);
  assert.equal((await call(withEmail, "/reset-password", { newPassword: "second-password", token })).status, 200);
  assert.equal((await call(withEmail, "/reset-password", { newPassword: "third-password", token })).status, 400, "a reset token works once");
  assert.equal(await (await call(withEmail, "/get-session", undefined, cookie)).json(), null, "reset signs out existing sessions");
  assert.equal((await call(withEmail, "/sign-in/email", { email, password: "first-password" })).status, 401);
  assert.equal((await call(withEmail, "/sign-in/email", { email, password: "second-password" })).status, 200);
  console.log("Passed: password reset link, single-use token, session revocation");

  const before = sent.length;
  const plain = await call(base, "/sign-up/email", { email: `plain-${crypto.randomUUID()}@example.invalid`, password: "plain-password", name: "Plain" });
  assert.equal(plain.status, 200);
  assert.ok((await plain.json()).token, "without email configuration, sign-up signs in directly");
  assert.equal((await call(base, "/request-password-reset", { email })).status, 400);
  assert.equal(sent.length, before, "no email without Resend configuration");
  console.log("Passed: without RESEND_API_KEY and EMAIL_FROM, no verification is required and reset is off");
} finally {
  globalThis.fetch = originalFetch;
  await drop();
  await rm(directory, { recursive: true, force: true });
}
