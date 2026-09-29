import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { testDatabase } from "./postgres-harness.mjs";
import { fakeSessions, withSessions } from "./fake-session.mjs";

// Node requires duplex for streamed Request bodies; the Worker runtime does not.
const NativeRequest = globalThis.Request;
globalThis.Request = class extends NativeRequest {
  constructor(input, init) { super(input, init?.body instanceof ReadableStream ? { ...init, duplex: "half" } : init); }
};

const { pool: database, drop } = await testDatabase("mvp_test");
const directory = await mkdtemp(join(tmpdir(), "mvp-backend-integration-"));

try {
  await build({ entryPoints: ["src/request-handler.ts", "src/api.ts", "src/voice-context.ts"], outdir: directory, outExtension: { ".js": ".mjs" }, bundle: true, format: "esm", platform: "node" });
  const { handleRequest } = await import(pathToFileURL(join(directory, "request-handler.mjs")));
  const handle = withSessions(handleRequest, fakeSessions({ userId: request => request.headers.get("x-test-user") ?? "owner" }));
  const { appendVoiceTranscript, processReview } = await import(pathToFileURL(join(directory, "api.mjs")));
  const { loadVoiceCodingContext } = await import(pathToFileURL(join(directory, "voice-context.mjs")));
  await database.query("INSERT INTO users (id, display_name, email) VALUES ('owner', 'MVP Fixture', 'mvp@example.invalid'), ('other', 'Other Fixture', 'other-mvp@example.invalid')");
  let dispatchedReviewId;
  const env = {
    BETTER_AUTH_URL: "https://app.example",
    PERSONAL_DATA_COLLECTION_APPROVED: "true",
    DEEPGRAM_API_KEY: "fictional-deepgram-key",
    VOICE_SESSIONS: {},
    REVIEW_PROVIDER_API_KEY: "fictional-review-key",
    REVIEW_PROVIDER_MODEL: "fixture-model",
    REVIEW_QUEUE: { send: async ({ reviewId }) => { dispatchedReviewId = reviewId; } },
    PYTHON_RUNNER: { fetch: async request => {
      const input = await request.json();
      const correct = !input.sourceCode.includes("return -1");
      return Response.json({
        status: correct ? "passed" : "failed",
        testResults: input.tests.map(testCase => ({ testId: testCase.testId, outcome: correct ? "passed" : "failed", actualOutput: correct ? testCase.expectedOutput : -1 })),
        stdout: "", stderr: "", executionTimeMs: 1, runnerVersion: "fictional-hosted-v1", harnessVersion: "json-positional-v1",
      });
    } },
  };
  let order = 0;
  const call = async (method, path, body, user = "owner") => {
    const response = await handle(new Request(`https://app.example${path}`, {
      method,
      headers: { origin: "https://app.example", "x-test-user": user, ...(body === undefined ? {} : { "content-type": "application/json" }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }), env, {}, database);
    return response;
  };
  const metadata = name => ({ sourceId: `${name}:${++order}`, sourceOrder: order, occurrenceOffsetMs: order });

  const voiceKey = env.DEEPGRAM_API_KEY;
  delete env.DEEPGRAM_API_KEY;
  const unavailableVoice = await call("POST", "/api/attempts", { problemId: "sum-odd-positions-v1", mode: "mock", inputMode: "voice", practiceGoal: "Fictional unavailable-provider check", consent: true, saveAudio: false });
  assert.equal(unavailableVoice.status, 503);
  env.DEEPGRAM_API_KEY = voiceKey;
  const created = await call("POST", "/api/attempts", { problemId: "sum-odd-positions-v1", mode: "mock", inputMode: "voice", practiceGoal: "Fictional MVP verification", consent: true, saveAudio: false });
  assert.equal(created.status, 201, await created.clone().text());
  const { attemptId } = await created.json();
  const path = `/api/attempts/${attemptId}`;
  let revision = 0;
  for (const [source, expected] of [["def sum_odd_positions(values):\n    return -1\n", "failed"], ["def sum_odd_positions(values):\n    return sum(values[1::2])\n", "passed"]]) {
    const saved = await call("PATCH", `${path}/draft`, { source, expectedRevision: revision, ...metadata("draft") });
    assert.equal(saved.status, 200, await saved.clone().text());
    revision = (await saved.json()).draftRevision;
    const run = await call("POST", `${path}/run`, metadata("run"));
    assert.equal(run.status, 200, await run.clone().text());
    assert.equal((await run.json()).status, expected);
  }
  const attempt = (await database.query("SELECT * FROM attempts WHERE id = $1", [attemptId])).rows[0];
  const transcript = await appendVoiceTranscript(database, attempt, { role: "user", text: "I changed the index selection.", providerSessionId: "fictional-provider-session", ...metadata("voice") });
  assert.equal(transcript.status, 201);
  const help = await call("POST", `${path}/help`, { category: "hint", ...metadata("help") });
  assert.equal(help.status, 202);
  const context = JSON.parse(await loadVoiceCodingContext(database, attemptId, "owner"));
  assert.equal(context.latestVisibleRun.status, "passed");
  assert.equal(context.latestHelpRequest.category, "hint");
  assert.equal(await loadVoiceCodingContext(database, attemptId, "other"), null);

  const reviewKey = env.REVIEW_PROVIDER_API_KEY;
  delete env.REVIEW_PROVIDER_API_KEY;
  const unavailableReview = await call("POST", `${path}/finish`, metadata("finish-unavailable"));
  assert.equal(unavailableReview.status, 503);
  assert.equal((await database.query("SELECT status FROM attempts WHERE id = $1", [attemptId])).rows[0].status, "active");
  env.REVIEW_PROVIDER_API_KEY = reviewKey;
  const finished = await call("POST", `${path}/finish`, metadata("finish"));
  assert.equal(finished.status, 200, await finished.clone().text());
  const { reviewId } = await finished.json();
  assert.equal(dispatchedReviewId, reviewId);
  await processReview(reviewId, env, database, {
    evaluatorVersion: "fictional-provider/evidence-v1",
    async generate({ payload, allowedEvidenceIds }) {
      const evidence = JSON.parse(payload).evidence;
      const submission = evidence.find(item => item.checkpoint?.type === "submission");
      const passingRun = evidence.find(item => item.run?.status === "passed");
      const spoken = evidence.find(item => item.transcript?.speaker === "candidate");
      assert.ok(submission && passingRun && spoken);
      assert.ok([submission.id, passingRun.id, spoken.id].every(id => allowedEvidenceIds.has(id)));
      return { findings: [{ observation: "The final saved solution passed the visible cases after an earlier failed run.", interpretation: null, limitations: "Visible cases do not establish correctness for all inputs.", suggested_action: "Explain why the slice selects odd indexes.", criterion: "Correctness", evidence_status: "reproducible_observation", evidenceIds: [submission.id, passingRun.id, spoken.id] }] };
    },
  });
  const review = await call("GET", `${path}/review`);
  assert.equal(review.status, 200);
  const reviewBody = await review.json();
  assert.equal(reviewBody.review.status, "ready");
  assert.equal(reviewBody.findings[0].evidence.length, 3);
  const checkpointId = reviewBody.findings[0].retry_checkpoint_id;
  assert.ok(checkpointId);
  const retried = await call("POST", `${path}/retry`, { checkpointId, practiceGoal: "Explain index selection" });
  assert.equal(retried.status, 201, await retried.clone().text());
  const retryId = (await retried.json()).attemptId;
  const retry = (await database.query("SELECT mode, input_mode, source_attempt_id, source_checkpoint_id FROM attempts WHERE id = $1", [retryId])).rows[0];
  assert.deepEqual(retry, { mode: "coach", input_mode: "voice", source_attempt_id: attemptId, source_checkpoint_id: checkpointId });
  assert.equal(JSON.parse(await loadVoiceCodingContext(database, attemptId, "owner")).status, "unavailable");
  assert.equal((await call("GET", path, undefined, "other")).status, 403);
  console.log("MVP backend integration passed: voice evidence, failed/passed runs, bounded context, finish, evidence-backed review, retrieval, and voice retry.");
} finally {
  globalThis.Request = NativeRequest;
  await drop();
  await rm(directory, { recursive: true, force: true });
}
