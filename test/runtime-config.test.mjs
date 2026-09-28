import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { after, test } from "node:test";

const directory = await mkdtemp(join(tmpdir(), "runtime-config-"));
after(() => rm(directory, { recursive: true, force: true }));
await build({ entryPoints: ["src/origin.ts", "src/runtime-config.ts"], outdir: directory, outExtension: { ".js": ".mjs" }, bundle: true, format: "esm", platform: "node" });
const { configuredApplicationOrigin } = await import(pathToFileURL(join(directory, "origin.mjs")));
const { runtimeCapabilities } = await import(pathToFileURL(join(directory, "runtime-config.mjs")));

test("application origin is exact HTTPS except for explicit loopback development", () => {
  for (const valid of ["https://app.example", "http://localhost:8787", "http://127.0.0.1:8787"]) assert.equal(configuredApplicationOrigin(valid), valid);
  for (const invalid of [undefined, "", "https://app.example/extra", "https://app.example/", "https://app.example?x=1", "http://app.example", "javascript:alert(1)"]) assert.equal(configuredApplicationOrigin(invalid), null);
});

test("MVP readiness remains false until every required backend service is configured", () => {
  const base = {
    BETTER_AUTH_URL: "https://app.example",
    BETTER_AUTH_SECRET: "fictional-auth-secret",
    DATABASE_URL: "postgresql://fictional.invalid/app",
    PERSONAL_DATA_COLLECTION_APPROVED: "true",
    DEEPGRAM_API_KEY: "fictional-deepgram-key",
    VOICE_SESSIONS: {},
    PYTHON_RUNNER: { fetch: async () => new Response() },
    REVIEW_PROVIDER_API_KEY: "fictional-review-key",
    REVIEW_PROVIDER_MODEL: "fixture-model",
    REVIEW_QUEUE: { send: async () => {} },
  };
  assert.equal(runtimeCapabilities(base).mvpReady, true);
  for (const key of ["DATABASE_URL", "DEEPGRAM_API_KEY", "PYTHON_RUNNER", "REVIEW_PROVIDER_API_KEY", "REVIEW_QUEUE"]) {
    assert.equal(runtimeCapabilities({ ...base, [key]: undefined }).mvpReady, false, key);
  }
  assert.equal(runtimeCapabilities({ ...base, PERSONAL_DATA_COLLECTION_APPROVED: "false" }).mvpReady, false);
});
