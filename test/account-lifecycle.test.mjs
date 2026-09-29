import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { after, test } from "node:test";

const directory = await mkdtemp(join(tmpdir(), "account-lifecycle-"));
after(() => rm(directory, { recursive: true, force: true }));
// Account deletion and export run against PostgreSQL in test/account-deletion-integration.mjs.
await build({ entryPoints: ["src/email.ts"], outdir: directory, outExtension: { ".js": ".mjs" }, bundle: true, format: "esm", platform: "node" });
const { emailConfigured, passwordResetText, sendEmail, verificationText } = await import(pathToFileURL(join(directory, "email.mjs")));

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
