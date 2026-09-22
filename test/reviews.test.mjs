import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { after, afterEach, test } from "node:test";
import { env, finding, evidence, envelope, fakeDatabase } from "./reviews/fixtures.mjs";

const directory = await mkdtemp(join(tmpdir(), "reviews-unit-"));
after(() => rm(directory, { recursive: true, force: true }));
await build({ entryPoints: ["src/reviews.ts", "src/review-provider.ts", "src/worker.ts"], outdir: directory, outExtension: { ".js": ".mjs" }, bundle: true, format: "esm", platform: "node", plugins: [{ name: "queue-runtime", setup(plugin) {
  plugin.onResolve({ filter: /^\.\/(database|auth|voice-session)$/ }, args => ({ path: args.path, namespace: "test" }));
  plugin.onLoad({ filter: /.*/, namespace: "test" }, args => ({ contents: args.path === "./database" ? "export const databaseForInvocation = () => globalThis.reviewTestDatabase;" : args.path === "./auth" ? "export const authenticatedUserId = async () => 'owner'; export const authFor = () => ({});" : "export class VoiceSession {}" }));
} }] });
const { processReview } = await import(pathToFileURL(join(directory, "reviews.mjs")));
const { validateFindings, generateFindings } = await import(pathToFileURL(join(directory, "review-provider.mjs")));
const { default: worker } = await import(pathToFileURL(join(directory, "worker.mjs")));
const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; delete globalThis.reviewTestDatabase; });
function provider(value = { findings: [finding] }) { globalThis.fetch = async () => Response.json(envelope(value)); }

test("valid findings use exact evidence and server-generated transcript/checkpoint/run locators", async () => {
  const db = fakeDatabase();
  globalThis.fetch = async (url, init) => {
    assert.equal(url, "https://api.openai.com/v1/responses");
    assert.equal(init.headers.authorization, "Bearer fictional-key");
    const request = JSON.parse(init.body);
    assert.equal(request.store, false);
    assert.equal(request.model, "fixture-model");
    assert.equal(request.text.format.strict, true);
    const payload = JSON.parse(request.input);
    assert.deepEqual(payload.allowedEvidenceIds, evidence.map(item => item.id));
    assert.equal(payload.attempt.user_id, undefined);
    return Response.json(envelope());
  };
  await processReview("review", env, db);
  assert.equal(db.saved.status, "ready");
  assert.equal(db.saved.findings.length, 1);
  const locators = Object.fromEntries(db.saved.citations.map(row => [row[2], JSON.parse(row[3])]));
  assert.equal(locators.transcript.transcriptId, "segment");
  assert.equal(locators.submission.checkpointId, "final");
  assert.equal(locators.run.runId, "run-record");
  assert.equal(db.saved.findings[0][8], "final");
});

for (const [name, value] of [
  ["invented ID", { ...finding, evidenceIds: ["invented"] }],
  ["other attempt ID", { ...finding, evidenceIds: ["other-attempt-event"] }],
  ["duplicate reference", { ...finding, evidenceIds: ["run", "run"] }],
  ["unknown field", { ...finding, timestamp: "invented" }],
  ["invalid status", { ...finding, evidence_status: "excellent" }],
  ["oversized field", { ...finding, observation: "x".repeat(501) }],
  ["empty observation", { ...finding, observation: "  " }],
  ["missing field", { ...finding, limitations: undefined }],
  ["too many references", { ...finding, evidenceIds: Array(9).fill("run") }],
]) test(`rejects ${name} without partial publication`, async () => {
  const db = fakeDatabase(); provider({ findings: [finding, value] });
  await processReview("review", env, db);
  assert.equal(db.saved.status, "failed");
  assert.equal(db.saved.findings.length, 0);
  assert.equal(db.saved.citations.length, 0);
});

test("strict overall shape, duplicate findings and finding count", () => {
  for (const value of [null, [], { findings: [], extra: true }, { findings: Array(9).fill(finding) }, { findings: [finding, { ...finding, observation: ` ${finding.observation.toUpperCase()} ` }] }]) {
    assert.throws(() => validateFindings(value, new Set(evidence.map(item => item.id))));
  }
});

test("no defensible findings is a valid ready review", async () => {
  const db = fakeDatabase(); provider({ findings: [] });
  await processReview("review", env, db);
  assert.equal(db.saved.status, "ready"); assert.equal(db.saved.findings.length, 0);
});

for (const [name, response] of [
  ["malformed model JSON", () => Response.json(envelope("{"))],
  ["malformed provider JSON", () => new Response("{")],
  ["oversized streamed response", () => new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode("x".repeat(65537))); c.close(); } }))],
  ["provider refusal", () => Response.json({ status: "completed", output: [{ type: "message", role: "assistant", content: [{ type: "refusal", refusal: "no" }] }] })],
  ["incomplete output", () => Response.json({ ...envelope(), status: "incomplete" })],
  ["provider 401", () => new Response("private diagnostic", { status: 401 })],
  ["provider 400", () => new Response("private diagnostic", { status: 400 })],
]) test(`${name} permanently fails with no sensitive error`, async () => {
  const db = fakeDatabase(); globalThis.fetch = async () => response();
  await processReview("review", env, db);
  assert.equal(db.saved.status, "failed"); assert.equal(db.saved.findings.length, 0);
  assert.ok(!db.saved.reason.includes("private diagnostic"));
});

for (const status of [408, 409, 429, 500, 503]) test(`provider ${status} remains retryable`, async () => {
  const db = fakeDatabase(); globalThis.fetch = async () => new Response("private", { status });
  await assert.rejects(processReview("review", env, db));
  assert.equal(db.saved.status, "pending"); assert.equal(db.saved.findings.length, 0);
});

test("network and body-stream failures remain retryable", async () => {
  for (const fetch of [async () => { throw new Error("network secret"); }, async () => new Response(new ReadableStream({ start(c) { c.error(new Error("connection reset")); } }))]) {
    const db = fakeDatabase(); globalThis.fetch = fetch;
    await assert.rejects(processReview("review", env, db), /connection failed/);
    assert.equal(db.saved.status, "pending");
  }
});

test("deadline covers stalled provider body", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  globalThis.fetch = async () => new Response(new ReadableStream());
  const pending = generateFindings(env, "{}", new Set());
  const assertion = assert.rejects(pending, /timed out/);
  t.mock.timers.tick(45000);
  await assertion;
});

test("duplicate delivery and terminal reviews never regenerate", async () => {
  let calls = 0; globalThis.fetch = async () => { calls++; return Response.json(envelope()); };
  const db = fakeDatabase(); await processReview("review", env, db); await processReview("review", env, db);
  for (const status of ["ready", "failed"]) await processReview("review", env, fakeDatabase({ status }));
  assert.equal(calls, 1); assert.equal(db.saved.findings.length, 1);
});

test("partial database writes roll back, leaving pending with no findings", async () => {
  const db = fakeDatabase({ failCitation: true }); provider();
  await assert.rejects(processReview("review", env, db), /database failure/);
  assert.equal(db.saved.status, "pending"); assert.equal(db.saved.findings.length, 0);
});

test("missing provider configuration fails closed without a request", async () => {
  globalThis.fetch = async () => { assert.fail("No request allowed"); };
  for (const config of [{ ...env, REVIEW_PROVIDER_API_KEY: undefined }, { ...env, REVIEW_PROVIDER_MODEL: " " }]) {
    const db = fakeDatabase(); await processReview("review", config, db);
    assert.equal(db.saved.status, "failed"); assert.match(db.saved.reason, /not configured/);
  }
});

test("invalid manifest, missing final checkpoint and oversized evidence fail closed", async () => {
  globalThis.fetch = async () => { assert.fail("No request allowed"); };
  for (const options of [{ manifest: { attemptId: "other" } }, { rows: evidence.slice(0, 2) }, { rows: Array(201).fill(evidence[0]) }, { rows: [null] }, { rows: [...evidence, { ...evidence[0], id: "large", transcript: { text: "x".repeat(192 * 1024) } }] }]) {
    const db = fakeDatabase(options); await processReview("review", env, db); assert.equal(db.saved.status, "failed");
  }
});

test("collection gate prevents queue processing", async () => {
  const db = fakeDatabase(); await assert.rejects(processReview("review", { ...env, PERSONAL_DATA_COLLECTION_APPROVED: "false" }, db));
  assert.equal(db.queries.length, 0);
});

test("Worker acknowledges terminal/invalid messages and retries transient failures", async () => {
  for (const transient of [false, true]) {
    const db = fakeDatabase(); db.end = async () => {}; globalThis.reviewTestDatabase = db;
    globalThis.fetch = async () => transient ? new Response(null, { status: 503 }) : Response.json(envelope("{"));
    const actions = [];
    await worker.queue({ messages: [{ body: { reviewId: "review" }, ack: () => actions.push("ack"), retry: () => actions.push("retry") }, { body: {}, ack: () => actions.push("invalid-ack") }] }, env);
    assert.deepEqual(actions, [transient ? "retry" : "ack", "invalid-ack"]);
  }
});
