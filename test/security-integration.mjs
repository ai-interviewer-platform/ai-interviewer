import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import pg from "pg";

if (!process.env.DATABASE_URL) throw new Error("Set DATABASE_URL to a disposable local PostgreSQL instance.");
const schema = `security_test_${crypto.randomUUID().replaceAll("-", "")}`;
const admin = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const database = new pg.Pool({ connectionString: process.env.DATABASE_URL, options: `-c search_path=${schema}` });
const directory = await mkdtemp(join(tmpdir(), "security-integration-"));
const background = [];
const originalFetch = globalThis.fetch;
const OriginalResponse = globalThis.Response;
let provider;
let socket;
let providerCalls = 0;
class Socket extends EventTarget {
  sent = [];
  closed = false;
  accept() {}
  send(data) { this.sent.push(data); }
  close() { this.closed = true; }
  message(data) { this.dispatchEvent(new MessageEvent("message", { data })); }
}
globalThis.WebSocketPair = class { constructor() { this[0] = new Socket(); this[1] = socket = new Socket(); } };
globalThis.Response = class extends OriginalResponse {
  constructor(body, init) { super(body, init?.status === 101 ? {} : init); this.webSocket = init?.webSocket; }
};
globalThis.fetch = async (url, init) => {
  assert.equal(url, "https://agent.deepgram.com/v1/agent/converse");
  assert.equal(init.headers.Authorization, "Token fake-test-key");
  providerCalls++;
  provider = new Socket();
  return { webSocket: provider };
};
globalThis.securityTestDatabase = () => ({ query: database.query.bind(database), connect: database.connect.bind(database), end: async () => {} });
try {
  await admin.query(`CREATE SCHEMA ${schema}`);
  for (const path of ["migrations/auth/0000_colorful_vindicator.sql", "migrations/0002_application.sql", "migrations/0003_security.sql"]) {
    const sql = (await readFile(path, "utf8")).replaceAll('"public".', `"${schema}".`);
    await database.query(sql);
  }
  await build({ entryPoints: ["src/security.ts", "src/voice-session.ts", "src/api.ts"], outdir: directory, outExtension: { ".js": ".mjs" }, bundle: true, format: "esm", platform: "node", plugins: [{ name: "runtime", setup(plugin) {
    plugin.onResolve({ filter: /^(cloudflare:workers|\.\/database|\.\/auth)$/ }, args => ({ path: args.path, namespace: "test" }));
    plugin.onLoad({ filter: /.*/, namespace: "test" }, args => ({ contents: args.path === "cloudflare:workers"
      ? "export class DurableObject { constructor(ctx, env) { this.ctx = ctx; this.env = env; } }"
      : args.path === "./auth" ? 'export const authenticatedUserId = async () => "owner";'
      : "export const databaseForInvocation = () => globalThis.securityTestDatabase();" }));
  } }] });
  const { consumeRate, limits } = await import(pathToFileURL(join(directory, "security.mjs")));
  const { VoiceSession } = await import(pathToFileURL(join(directory, "voice-session.mjs")));
  const { handleApi } = await import(pathToFileURL(join(directory, "api.mjs")));
  const decisions = await Promise.all(Array.from({ length: 20 }, () => consumeRate(database, "auth:test", 60, 3)));
  assert.equal(decisions.filter(result => result.allowed).length, 3, "concurrent requests must share the atomic bucket");
  await database.query("INSERT INTO users (id, display_name, email) VALUES ('owner', 'Fixture', 'fixture@example.invalid')");
  await database.query("INSERT INTO attempts (id, user_id, problem_id, mode, input_mode, status, setup_context, consent_at, disclosure_version, practice_goal) VALUES ('attempt', 'owner', 'sum-odd-positions-v1', 'mock', 'voice', 'active', '{}', now(), 'test', 'Practice')");
  const env = { DEEPGRAM_API_KEY: "fake-test-key", BETTER_AUTH_URL: "https://app.example", PERSONAL_DATA_COLLECTION_APPROVED: "true" };
  const makeSession = () => new VoiceSession({ storage: { setAlarm: async deadline => assert.ok(deadline > Date.now()) }, waitUntil: task => background.push(task) }, env);
  const upgrade = () => new Request("https://app.example/api/attempts/attempt/voice", { headers: { "x-attempt-id": "attempt", "x-user-id": "owner" } });
  const session = makeSession();
  assert.ok((await session.fetch(upgrade())).webSocket);
  const firstSocket = socket;
  const firstProvider = provider;
  assert.equal((await makeSession().fetch(upgrade())).status, 429, "other isolates must respect the active reservation");
  assert.equal(providerCalls, 1);
  firstProvider.message(JSON.stringify({ type: "Welcome", request_id: "provider-session" }));
  const settings = JSON.parse(firstProvider.sent[0]);
  assert.equal(settings.agent.think.provider.model, "gpt-5.6-terra");
  assert.equal(settings.agent.think.functions, undefined);
  firstProvider.message(JSON.stringify({ type: "ConversationText", role: "assistant", content: "Explain the loop." }));
  // Drain the provider write by closing, which registers its completion promise.
  await session.alarm();
  await Promise.all(background.splice(0));
  assert.ok(firstSocket.closed && firstProvider.closed, "deadline closes both peers");
  const evidence = await database.query("SELECT e.payload, t.speaker, t.text FROM transcript_segments t JOIN attempt_events e ON e.id = t.event_id");
  assert.equal(evidence.rows[0].payload.verified, true);
  assert.equal(evidence.rows[0].speaker, "interviewer");
  assert.equal(evidence.rows[0].text, "Explain the loop.");
  const blockedSettings = makeSession();
  assert.ok((await blockedSettings.fetch(upgrade())).webSocket);
  socket.message(JSON.stringify({ type: "Settings", agent: { think: { provider: { model: "attacker" } } } }));
  assert.ok(socket.closed && provider.closed);
  assert.equal(provider.sent.length, 0, "browser settings never reach provider");
  await Promise.all(background.splice(0));
  await database.query("UPDATE voice_reservations SET reserved_seconds = $1, expires_at = now()", [limits.accountVoiceSeconds]);
  assert.equal((await makeSession().fetch(upgrade())).status, 429);
  await database.query("UPDATE voice_reservations SET reserved_seconds = 0");
  await database.query("INSERT INTO users (id, display_name, email) VALUES ('other', 'Other', 'other@example.invalid')");
  await database.query("UPDATE voice_reservations SET user_id = 'other', reserved_seconds = $1", [limits.projectVoiceSeconds]);
  assert.equal((await makeSession().fetch(upgrade())).status, 429);
  let dispatched = 0;
  env.REVIEW_QUEUE = { send: async () => { dispatched++; } };
  const finish = () => handleApi(new Request("https://app.example/api/attempts/attempt/finish", { method: "POST", headers: { origin: "https://app.example", "content-type": "application/json" }, body: JSON.stringify({ sourceId: "finish", sourceOrder: 1, occurrenceOffsetMs: 1 }) }), env, {}, database);
  const finishes = await Promise.all([finish(), finish()]);
  assert.ok(finishes.every(response => response.status === 200));
  assert.equal(dispatched, 1, "concurrent finish only dispatches once");
  await database.query("UPDATE reviews SET status = 'failed'");
  assert.equal((await finish()).status, 200);
  assert.equal(dispatched, 1, "terminal review never dispatches again");
  console.log("PostgreSQL concurrency, voice quotas, server settings, verified transcripts, deadline closure and review dispatch passed.");
} finally {
  socket?.close(); provider?.close();
  await Promise.all(background);
  globalThis.fetch = originalFetch; globalThis.Response = OriginalResponse;
  await database.end();
  await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  await admin.end();
  await rm(directory, { recursive: true, force: true });
}
