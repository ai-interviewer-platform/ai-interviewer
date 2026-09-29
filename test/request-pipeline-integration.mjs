// The request pipeline order, through the same handler that the Worker runs.
import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { testDatabase } from "./postgres-harness.mjs";
import { fakeSessions, withSessions } from "./fake-session.mjs";

const { pool: database, drop } = await testDatabase("pipeline_test", { problemBank: false });
const directory = await mkdtemp(join(tmpdir(), "request-pipeline-"));
try {
  await build({ entryPoints: ["src/request-handler.ts"], outdir: directory, outExtension: { ".js": ".mjs" }, bundle: true, format: "esm", platform: "node" });
  const { handleRequest } = await import(pathToFileURL(join(directory, "request-handler.mjs")));
  const origin = "https://app.example";
  const env = { BETTER_AUTH_URL: origin, PERSONAL_DATA_COLLECTION_APPROVED: "true", RESEND_API_KEY: "re_test", EMAIL_FROM: "Coursay <no-reply@example.invalid>" };
  const handle = withSessions(handleRequest);
  const post = (path, body, headers = {}) => new Request(`${origin}${path}`, { method: "POST", headers: { origin, "content-type": "application/json", ...headers }, body });
  await database.query("INSERT INTO users (id, display_name, email) VALUES ('owner', 'Owner', 'owner@example.invalid')");
  await database.query("INSERT INTO attempts (id, user_id, problem_id, mode, input_mode, status, setup_context, consent_at, disclosure_version, practice_goal) VALUES ('voice', 'owner', 'sum-odd-positions-v1', 'mock', 'voice', 'active', '{}', now(), 'test', 'Practice')");

  const availability = await (await handle(new Request(`${origin}/api/personal-availability`), env, {}, database)).json();
  assert.equal(availability.emailEnabled, true);
  assert.equal(availability.collectionEnabled, true);
  const closed = await handle(new Request(`${origin}/api/personal-availability`), { ...env, PERSONAL_DATA_COLLECTION_APPROVED: "false" }, {}, database);
  assert.equal((await closed.json()).collectionEnabled, false, "availability answers before the collection gate");
  console.log("PASS availability has one source and includes emailEnabled");

  const untouched = { query: () => assert.fail("Must reject before database access"), connect: () => assert.fail("Must reject before database access") };
  assert.equal((await handle(post("/api/attempts", "{}"), { ...env, PERSONAL_DATA_COLLECTION_APPROVED: "false" }, {}, untouched)).status, 503);
  assert.equal((await handle(post("/api/attempts", "{}", { origin: "https://attacker.example" }), env, {}, untouched)).status, 403);
  const upgrade = (headers) => new Request(`${origin}/api/attempts/voice/voice`, { headers: { upgrade: "websocket", ...headers } });
  assert.equal((await handle(upgrade({ origin: "https://attacker.example" }), env, {}, untouched)).status, 403, "a WebSocket upgrade from a wrong origin is rejected");
  assert.equal((await handle(upgrade({}), env, {}, untouched)).status, 403, "a WebSocket upgrade with no origin is rejected");
  assert.equal((await handle(post("/api/attempts", JSON.stringify({ text: "x".repeat(256 * 1024) })), env, {}, untouched)).status, 413);
  console.log("PASS collection gate, origin (including WebSocket upgrades) and body size limit run before the database");

  const signedOut = withSessions(handleRequest, fakeSessions({ userId: null }));
  assert.equal((await signedOut(new Request(`${origin}/api/attempts`), env, {}, database)).status, 401);
  assert.equal((await signedOut(new Request(`${origin}/api/catalog`), env, {}, database)).status, 200, "the catalog needs no session");
  assert.equal((await handle(new Request(`${origin}/api/attempts`), env, {}, database)).status, 200);
  await database.query("UPDATE security_rate_limits SET count = 120 WHERE key = 'api:owner'");
  assert.equal((await handle(new Request(`${origin}/api/attempts`), env, {}, database)).status, 429);
  console.log("PASS session and rate limit run before the route");
} finally {
  await drop();
  await rm(directory, { recursive: true, force: true });
}
