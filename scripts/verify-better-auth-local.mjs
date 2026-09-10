import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import pg from "pg";

const baseUrl = process.env.AUTH_VERIFY_URL ?? "http://127.0.0.1:8790";
const email = `verification-${randomUUID()}@example.invalid`;
const password = randomBytes(24).toString("base64url");

async function databaseUrl() {
  const variables = await readFile(new URL("../.dev.vars", import.meta.url), "utf8");
  const value = variables.match(/^DATABASE_URL=(.+)$/m)?.[1];
  if (!value) throw new Error("DATABASE_URL is missing from .dev.vars.");
  return value;
}

try {
  const signUp = await fetch(`${baseUrl}/api/auth/sign-up/email`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: baseUrl },
    body: JSON.stringify({ name: "Fictional verification", email, password }),
  });
  const signUpBody = await signUp.text();
  assert.equal(signUp.status, 200, signUpBody);

  const cookie = signUp.headers.getSetCookie().map((value) => value.split(";", 1)[0]).join("; ");
  assert.ok(cookie, "signup should return a session cookie");

  const active = await fetch(`${baseUrl}/api/auth/get-session`, { headers: { cookie, origin: baseUrl } });
  assert.equal(active.status, 200);
  assert.equal((await active.json()).user.email, email);

  const signOut = await fetch(`${baseUrl}/api/auth/sign-out`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie, origin: baseUrl },
    body: "{}",
  });
  assert.equal(signOut.status, 200, await signOut.text());

  const revoked = await fetch(`${baseUrl}/api/auth/get-session`, { headers: { cookie, origin: baseUrl } });
  assert.equal(revoked.status, 200);
  assert.equal(await revoked.json(), null);
  console.log("Fictional Better Auth signup, database-backed session, sign-out, and revocation passed.");
} finally {
  const database = new pg.Client({ connectionString: await databaseUrl() });
  await database.connect();
  try {
    await database.query("DELETE FROM users WHERE email LIKE 'verification-%@example.invalid'");
  } finally {
    await database.end();
  }
  console.log("Fictional verification accounts removed.");
}
