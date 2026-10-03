// The Review queue through its interface: real local PostgreSQL and the in-memory queue.
import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { testDatabase } from "./postgres-harness.mjs";
import { env as providerEnv, finding } from "./reviews/fixtures.mjs";

const { pool: database, drop } = await testDatabase("review_queue_test", { problemBank: false });
const directory = await mkdtemp(join(tmpdir(), "review-queue-"));
const originalFetch = globalThis.fetch;
try {
  await build({ entryPoints: ["src/review-queue.ts"], outdir: directory, outExtension: { ".js": ".mjs" }, bundle: true, format: "esm", platform: "node" });
  const { dispatchReview, InMemoryReviewQueue, reviewConfigured } = await import(pathToFileURL(join(directory, "review-queue.mjs")));
  globalThis.fetch = async () => { assert.fail("The fake Review provider makes no request"); };
  const env = { ...providerEnv };
  await database.query("INSERT INTO users (id, display_name, email) VALUES ('owner', 'Fixture', 'owner@example.invalid')");

  // A completed Attempt with its Submission and a pending Review, as the finish route leaves it.
  async function completed(name) {
    await database.query("INSERT INTO attempts (id,user_id,problem_id,mode,input_mode,status,setup_context,consent_at,disclosure_version,practice_goal,draft_source) VALUES ($1,'owner','sum-odd-positions-v1','mock','text','active','{}',now(),'test','Practice','def sum_odd_positions(values): return 0')", [name]);
    await database.query("INSERT INTO attempt_events (id,attempt_id,event_type,source_id,source_order,occurrence_offset_ms,payload) VALUES ($1,$2,'code_checkpoint',$1,0,0,'{}')", [`${name}-submission`, name]);
    await database.query("INSERT INTO code_checkpoints (id,attempt_id,event_id,source_code,checkpoint_type) VALUES ($1,$2,$3,'def sum_odd_positions(values): return 0','submission')", [`${name}-code`, name, `${name}-submission`]);
    await database.query("UPDATE attempts SET status = 'completed', completed_at = now() WHERE id = $1", [name]);
    const manifest = { attemptId: name, finalCheckpointId: `${name}-code`, frozenAt: new Date().toISOString() };
    await database.query("INSERT INTO reviews (id, attempt_id, status, evidence_manifest) VALUES ($1, $2, 'pending', $3::jsonb)", [`${name}-review`, name, JSON.stringify(manifest)]);
    return { attemptId: name, reviewId: `${name}-review` };
  }
  async function review(reviewId) {
    return (await database.query("SELECT status, dispatch_claimed_at IS NOT NULL AS claimed FROM reviews WHERE id = $1", [reviewId])).rows[0];
  }
  const expireClaim = (reviewId) => database.query("UPDATE reviews SET dispatch_claimed_at = now() - interval '61 seconds' WHERE id = $1", [reviewId]);

  assert.equal(reviewConfigured({ ...env, REVIEW_QUEUE: new InMemoryReviewQueue() }), true);
  assert.equal(reviewConfigured(env), false, "a Review needs a queue");
  assert.equal(reviewConfigured({ ...env, REVIEW_PROVIDER_API_KEY: undefined, REVIEW_QUEUE: new InMemoryReviewQueue() }), false, "a Review needs a provider");
  console.log("PASS the Review configured rule needs a provider and a queue");

  const queue = new InMemoryReviewQueue();
  const first = await completed("claim");
  assert.deepEqual(await dispatchReview(database, queue, first.attemptId), { status: "queued", reviewId: first.reviewId });
  assert.deepEqual(queue.messages, [{ reviewId: first.reviewId }]);
  assert.deepEqual(await review(first.reviewId), { status: "pending", claimed: true });
  console.log("PASS dispatch claims the Review and sends one message");

  assert.deepEqual(await dispatchReview(database, queue, first.attemptId), { status: "already dispatched", reviewId: first.reviewId });
  const concurrent = await completed("concurrent");
  const both = await Promise.all([dispatchReview(database, queue, concurrent.attemptId), dispatchReview(database, queue, concurrent.attemptId)]);
  assert.deepEqual(both.map(result => result.status).sort(), ["already dispatched", "queued"]);
  assert.deepEqual(queue.messages, [{ reviewId: first.reviewId }, { reviewId: concurrent.reviewId }]);
  console.log("PASS a second dispatch within the 60-second claim window sends nothing");

  const failing = await completed("send-failure");
  queue.failNextSend();
  assert.deepEqual(await dispatchReview(database, queue, failing.attemptId), { status: "failed" });
  assert.deepEqual(await review(failing.reviewId), { status: "pending", claimed: false }, "a failed send releases the claim");
  assert.deepEqual(await dispatchReview(database, queue, failing.attemptId), { status: "queued", reviewId: failing.reviewId }, "a finish retry dispatches at once");
  console.log("PASS a send failure releases the claim and a finish retry dispatches again");

  // A lost dispatch: the claim was taken but no message reaches the consumer.
  queue.messages.length = 0;
  assert.equal((await dispatchReview(database, queue, first.attemptId)).status, "already dispatched");
  await expireClaim(first.reviewId);
  assert.deepEqual(await dispatchReview(database, queue, first.attemptId), { status: "queued", reviewId: first.reviewId });
  assert.deepEqual(queue.messages, [{ reviewId: first.reviewId }]);
  console.log("PASS a finish retry after the claim window recovers a lost dispatch");

  assert.deepEqual(await dispatchReview(database, queue, "no-attempt"), { status: "missing" });
  await database.query("UPDATE reviews SET status = 'ready' WHERE id = $1", [concurrent.reviewId]);
  await expireClaim(concurrent.reviewId);
  assert.deepEqual(await dispatchReview(database, queue, concurrent.attemptId), { status: "already dispatched", reviewId: concurrent.reviewId }, "a terminal Review is never dispatched again");
  assert.deepEqual(queue.messages, [{ reviewId: first.reviewId }]);
  console.log("PASS an Attempt without a Review and a terminal Review send nothing");

  // The fake Review provider answers by the Attempt of the delivered Review.
  const provider = { evaluatorVersion: "fake/queue-v1", async generate({ allowedEvidenceIds }) {
    if (allowedEvidenceIds.has("transient-submission")) throw new Error("provider outage");
    if (allowedEvidenceIds.has("permanent-submission")) return { findings: [{ ...finding, evidenceIds: ["invented"] }] };
    return { findings: [] };
  } };
  const transient = await completed("transient");
  const permanent = await completed("permanent");
  queue.messages.length = 0;
  await expireClaim(first.reviewId);
  for (const attempt of [first, transient, permanent]) assert.equal((await dispatchReview(database, queue, attempt.attemptId)).status, "queued");
  await queue.send({});
  await queue.send("not a Review");
  assert.deepEqual(await queue.deliver(env, database, provider), ["ack", "retry", "ack", "ack", "ack"]);
  assert.equal((await review(first.reviewId)).status, "ready");
  assert.equal((await review(transient.reviewId)).status, "pending");
  assert.equal((await review(permanent.reviewId)).status, "failed");
  assert.deepEqual(queue.messages, [{ reviewId: transient.reviewId }], "only the retried message stays queued");
  console.log("PASS consumption acknowledges valid, invalid and permanently failed messages and retries a transient failure");

  assert.deepEqual(await queue.deliver(env, database, { ...provider, generate: async () => ({ findings: [] }) }), ["ack"]);
  assert.equal((await review(transient.reviewId)).status, "ready");
  assert.deepEqual(queue.messages, []);
  await queue.send({ reviewId: transient.reviewId });
  assert.deepEqual(await queue.deliver(env, database, { evaluatorVersion: "unused", async generate() { assert.fail("A terminal Review is never generated again"); } }), ["ack"]);
  await queue.send({ reviewId: failing.reviewId });
  assert.deepEqual(await queue.deliver({ ...env, PERSONAL_DATA_COLLECTION_APPROVED: "false" }, database, provider), ["retry"], "the collection gate retries the message");
  assert.equal((await review(failing.reviewId)).status, "pending");
  console.log("PASS a retried message is processed on the next delivery and a terminal Review is acknowledged");
} finally {
  globalThis.fetch = originalFetch;
  await drop();
  await rm(directory, { recursive: true, force: true });
}
