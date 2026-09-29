// Review provider adapters and the Finding checks, with no database. The Review
// processor runs against PostgreSQL in test/review-integration.mjs.
import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { after, afterEach, test } from "node:test";
import { env, finding, envelope } from "./reviews/fixtures.mjs";

const directory = await mkdtemp(join(tmpdir(), "reviews-unit-"));
after(() => rm(directory, { recursive: true, force: true }));
await build({ entryPoints: ["src/review-provider.ts"], outdir: directory, outExtension: { ".js": ".mjs" }, bundle: true, format: "esm", platform: "node" });
const { PermanentReviewError, TransientReviewError, reviewLimits, reviewProviderConfigured, reviewProviderFor, reviewTransactionIdleTimeoutMs, validateFindings } = await import(pathToFileURL(join(directory, "review-provider.mjs")));
const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });
const allowed = new Set(["transcript", "run", "submission"]);
const generate = (config = env) => reviewProviderFor(config).generate({ payload: "{}", allowedEvidenceIds: allowed });

test("the Review transaction idle timeout is longer than the provider deadline", () => {
  assert.ok(reviewTransactionIdleTimeoutMs > reviewLimits.timeoutMs);
});

test("Finding checks accept exact evidence and reject every invalid finding", () => {
  assert.deepEqual(validateFindings({ findings: [finding] }, allowed), [finding]);
  assert.deepEqual(validateFindings({ findings: [] }, allowed), []);
  for (const value of [
    { ...finding, evidenceIds: ["invented"] },
    { ...finding, evidenceIds: ["run", "run"] },
    { ...finding, timestamp: "invented" },
    { ...finding, evidence_status: "excellent" },
    { ...finding, observation: "x".repeat(501) },
    { ...finding, observation: "  " },
    { ...finding, limitations: undefined },
    { ...finding, evidenceIds: Array(9).fill("run") },
  ]) assert.throws(() => validateFindings({ findings: [finding, value] }, allowed), PermanentReviewError);
  for (const value of [null, [], { findings: [], extra: true }, { findings: Array(9).fill(finding) }, { findings: [finding, { ...finding, observation: ` ${finding.observation.toUpperCase()} ` }] }]) {
    assert.throws(() => validateFindings(value, allowed), PermanentReviewError);
  }
});

test("provider selection and configuration rules", () => {
  const AI = { run: async () => ({}) };
  assert.match(reviewProviderFor({ ...env, AI }).evaluatorVersion, /^workers-ai\//);
  assert.match(reviewProviderFor({ ...env, AI, REVIEW_PROVIDER: "openai-responses" }).evaluatorVersion, /^openai-responses\//);
  assert.match(reviewProviderFor(env).evaluatorVersion, /^openai-responses\//);
  for (const config of [{ ...env, REVIEW_PROVIDER_API_KEY: undefined }, { ...env, REVIEW_PROVIDER_MODEL: " " }, { ...env, REVIEW_PROVIDER_MODEL: "x".repeat(201) }, { ...env, REVIEW_PROVIDER: "workers-ai" }, { ...env, REVIEW_PROVIDER: "unknown" }]) {
    assert.equal(reviewProviderConfigured(config), false);
    assert.throws(() => reviewProviderFor(config), PermanentReviewError);
  }
  assert.equal(reviewProviderConfigured(env), true);
});

test("OpenAI Responses sends a strict, unstored request and returns the unchecked output", async () => {
  globalThis.fetch = async (url, init) => {
    assert.equal(url, "https://api.openai.com/v1/responses");
    assert.equal(init.headers.authorization, "Bearer fictional-key");
    const request = JSON.parse(init.body);
    assert.equal(request.store, false);
    assert.equal(request.model, "fixture-model");
    assert.equal(request.text.format.strict, true);
    return Response.json(envelope({ findings: [{ ...finding, evidenceIds: ["invented"] }] }));
  };
  assert.deepEqual(await generate(), { findings: [{ ...finding, evidenceIds: ["invented"] }] }, "the adapter does not run the Finding checks");
});

for (const [name, response] of [
  ["malformed model JSON", () => Response.json(envelope("{"))],
  ["malformed provider JSON", () => new Response("{")],
  ["oversized streamed response", () => new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode("x".repeat(65537))); c.close(); } }))],
  ["provider refusal", () => Response.json({ status: "completed", output: [{ type: "message", role: "assistant", content: [{ type: "refusal", refusal: "no" }] }] })],
  ["incomplete output", () => Response.json({ ...envelope(), status: "incomplete" })],
  ["provider 401", () => new Response("private diagnostic", { status: 401 })],
  ["provider 400", () => new Response("private diagnostic", { status: 400 })],
]) test(`OpenAI Responses ${name} is a permanent failure with no sensitive text`, async () => {
  globalThis.fetch = async () => response();
  await assert.rejects(generate(), (error) => error instanceof PermanentReviewError && !error.message.includes("private diagnostic"));
});

for (const status of [408, 409, 429, 500, 503]) test(`OpenAI Responses ${status} is a transient failure`, async () => {
  globalThis.fetch = async () => new Response("private", { status });
  await assert.rejects(generate(), TransientReviewError);
});

test("network and body-stream failures are transient", async () => {
  for (const fetch of [async () => { throw new Error("network secret"); }, async () => new Response(new ReadableStream({ start(c) { c.error(new Error("connection reset")); } }))]) {
    globalThis.fetch = fetch;
    await assert.rejects(generate(), (error) => error instanceof TransientReviewError && /connection failed/.test(error.message));
  }
});

test("the deadline covers a stalled provider body", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  globalThis.fetch = async () => new Response(new ReadableStream());
  const assertion = assert.rejects(generate(), /timed out/);
  t.mock.timers.tick(reviewLimits.timeoutMs);
  await assertion;
});

// `run` uses `this`, like the real binding, so a detached call fails here.
function workersAI(respond) {
  return { calls: [], async run(model, input) { this.calls.push({ model, input }); return respond(); } };
}
const completion = (text, finish = "stop") => ({ choices: [{ finish_reason: finish, message: { role: "assistant", content: text } }] });

test("Workers AI constrains evidence IDs to the attempt and returns the unchecked output", async () => {
  const AI = workersAI(() => completion(JSON.stringify({ findings: [finding] })));
  assert.deepEqual(await generate({ ...env, AI }), { findings: [finding] });
  const { model, input } = AI.calls[0];
  assert.equal(model, "@cf/moonshotai/kimi-k2.6");
  assert.deepEqual(input.response_format.json_schema.schema.properties.findings.items.properties.evidenceIds.items.enum, [...allowed]);
});

test("Workers AI maps a model error to a permanent or transient Review error by its retry flag", async () => {
  await assert.rejects(generate({ ...env, AI: workersAI(() => completion("{\"findings\": [", "length")) }), (error) => error instanceof PermanentReviewError && /stopped with length/.test(error.message));
  await assert.rejects(generate({ ...env, AI: workersAI(() => completion("")) }), PermanentReviewError);
  await assert.rejects(generate({ ...env, AI: workersAI(() => { throw new Error("3040: Capacity temporarily exceeded"); }) }), TransientReviewError);
  await assert.rejects(generate({ ...env, AI: workersAI(() => completion("{")) }), PermanentReviewError);
});
