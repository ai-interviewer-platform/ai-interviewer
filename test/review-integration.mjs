import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { testDatabase } from "./postgres-harness.mjs";
import { env as providerEnv, finding, envelope } from "./reviews/fixtures.mjs";
import { withSessions } from "./fake-session.mjs";

const { pool: database, drop } = await testDatabase("review_test", { problemBank: false });
const directory = await mkdtemp(join(tmpdir(), "review-postgres-"));
const originalFetch = globalThis.fetch;
let dispatched = [];
const env = { ...providerEnv, BETTER_AUTH_URL: "https://app.example", REVIEW_QUEUE: { send: async body => dispatched.push(body) } };
try {
  await build({ entryPoints: ["src/request-handler.ts", "src/api.ts", "src/worker.ts"], outdir: directory, outExtension: { ".js": ".mjs" }, bundle: true, format: "esm", platform: "node",
    // The Worker bundle includes better-auth, whose PostgreSQL driver uses require.
    banner: { js: "import { createRequire } from \"node:module\"; const require = createRequire(import.meta.url);" },
    plugins: [{ name: "queue-runtime", setup(plugin) {
      plugin.onResolve({ filter: /^\.\/(database|voice-session)$/ }, args => ({ path: args.path, namespace: "test" }));
      plugin.onLoad({ filter: /.*/, namespace: "test" }, args => ({ contents: args.path === "./database" ? "export const databaseForInvocation = () => globalThis.reviewQueueDatabase;" : "export class VoiceSession {}" }));
    } }] });
  const { handleRequest } = await import(pathToFileURL(join(directory, "request-handler.mjs")));
  const handle = withSessions(handleRequest);
  const { processReview } = await import(pathToFileURL(join(directory, "api.mjs")));
  await database.query("INSERT INTO users (id, display_name, email) VALUES ('owner','Fixture','owner@example.invalid'), ('other','Other','other@example.invalid')");
  async function seed(name, owner = "owner", before = async () => {}) {
    await database.query("INSERT INTO attempts (id,user_id,problem_id,mode,input_mode,status,setup_context,consent_at,disclosure_version,practice_goal,draft_source) VALUES ($1,$2,'sum-odd-positions-v1','mock','text','active','{}',now(),'test','Do not send this private goal','def sum_odd_positions(values): return sum(values[1::2])')", [name, owner]);
    const events = [["text", "candidate_text", {}], ["checkpoint", "code_checkpoint", {}], ["run", "code_run", {}], ["help", "help_requested", {}], ["legacy", "interviewer_voice", {}], ["verified", "interviewer_voice", { verified: true }], ["hidden", "code_run", {}]];
    for (const [suffix, type, payload] of events) await database.query("INSERT INTO attempt_events (id,attempt_id,event_type,source_id,source_order,occurrence_offset_ms,payload) VALUES ($1,$2,$3,$1,0,0,$4)", [`${name}-${suffix}`, name, type, payload]);
    for (const [suffix, speaker] of [["text", "candidate"], ["legacy", "interviewer"], ["verified", "interviewer"]]) await database.query("INSERT INTO transcript_segments (id,attempt_id,event_id,speaker,text,end_offset_ms) VALUES ($1,$2,$3,$4,$5,0)", [`${name}-${suffix}-segment`, name, `${name}-${suffix}`, speaker, suffix === "legacy" ? "UNVERIFIED_DO_NOT_SEND" : "Discuss odd indexes"]);
    await database.query("INSERT INTO code_checkpoints (id,attempt_id,event_id,source_code,checkpoint_type) VALUES ($1,$2,$3,'def solve(values): return sum(values[1::2])','run')", [`${name}-code`, name, `${name}-checkpoint`]);
    for (const kind of ["visible", "submission"]) await database.query("INSERT INTO code_runs (id,attempt_id,checkpoint_id,event_id,status,tests_passed,test_results,run_kind,runner_version,harness_version) VALUES ($1,$2,$3,$4,'passed',1,$5,$6,'fixture','fixture')", [`${name}-${kind}`, name, `${name}-code`, `${name}-${kind === "visible" ? "run" : "hidden"}`, JSON.stringify([{ testId: kind === "visible" ? "sum-odd-empty-v1" : "HIDDEN_DO_NOT_SEND", outcome: "passed", actualOutput: 0 }]), kind]);
    await database.query("INSERT INTO assistance_events (id,attempt_id,event_id,category,offered,accepted,delivered,content) VALUES ($1,$2,$3,'hint',true,true,false,'')", [`${name}-help-record`, name, `${name}-help`]);
    await before(name);
    if (owner !== "owner") return;
    const response = await handle(new Request(`https://app.example/api/attempts/${name}/finish`, { method: "POST", headers: { origin: "https://app.example", "content-type": "application/json" }, body: JSON.stringify({ sourceId: "finish", sourceOrder: 1, occurrenceOffsetMs: 5 }) }), env, {}, database);
    assert.equal(response.status, 200, await response.clone().text());
    return (await response.json()).reviewId;
  }
  async function state(reviewId) {
    return (await database.query("SELECT r.status, r.failure_reason, (SELECT count(*)::int FROM review_findings f WHERE f.review_id=r.id) AS findings, (SELECT count(*)::int FROM finding_evidence fe JOIN review_findings f ON f.id=fe.finding_id WHERE f.review_id=r.id) AS citations FROM reviews r WHERE r.id=$1", [reviewId])).rows[0];
  }
  function respond(name, extra = {}) { return envelope({ findings: [{ ...finding, evidenceIds: [`${name}-text`, `${name}-checkpoint`, `${name}-run`], ...extra }] }); }
  await seed("foreign", "other");
  const review = await seed("valid");
  let calls = 0;
  globalThis.fetch = async (_url, init) => {
    calls++;
    const raw = JSON.parse(init.body).input;
    assert.ok(!/UNVERIFIED_DO_NOT_SEND|HIDDEN_DO_NOT_SEND|foreign-|private goal|owner@example/.test(raw));
    const payload = JSON.parse(raw);
    assert.ok(payload.allowedEvidenceIds.includes("valid-verified"));
    assert.ok(payload.allowedEvidenceIds.includes("valid-help"));
    assert.equal(payload.evidence.find(item => item.id === "valid-help").assistance.delivered, false);
    const final = payload.evidence.find(item => item.checkpoint?.id === payload.attempt.finalCheckpointId);
    assert.equal(final.checkpoint.type, "submission");
    await new Promise(resolve => setTimeout(resolve, 50));
    return Response.json(respond("valid"));
  };
  await Promise.all([processReview(review, env, database), processReview(review, env, database)]);
  await processReview(review, env, database);
  assert.equal(calls, 1);
  assert.deepEqual(await state(review), { status: "ready", failure_reason: null, findings: 1, citations: 3 });
  const apiReview = await handle(new Request("https://app.example/api/attempts/valid/review"), env, {}, database);
  const detail = await apiReview.json();
  assert.equal(detail.review.status, "ready");
  assert.ok(detail.findings[0].evidence.some(item => item.locator.transcriptId === "valid-text-segment"));
  assert.ok(detail.findings[0].evidence.some(item => item.locator.runId === "valid-visible"));
  assert.equal(detail.findings[0].retry_checkpoint_id, "valid-code");
  console.log("PASS real finish manifest, scoped evidence, voice provenance, API response, concurrent and repeated delivery");

  const crossReview = await seed("cross");
  globalThis.fetch = async () => Response.json(respond("cross", { evidenceIds: ["foreign-text"] }));
  await processReview(crossReview, env, database);
  assert.equal((await state(crossReview)).status, "failed");
  assert.equal((await state(crossReview)).findings, 0);
  console.log("PASS other user's evidence cannot be cited");

  const rollbackReview = await seed("rollback");
  await database.query("CREATE FUNCTION reject_test_citation() RETURNS trigger AS $$ BEGIN IF NEW.event_id = 'rollback-run' THEN RAISE EXCEPTION 'test injected write failure'; END IF; RETURN NEW; END; $$ LANGUAGE plpgsql; CREATE TRIGGER reject_test_citation BEFORE INSERT ON finding_evidence FOR EACH ROW EXECUTE FUNCTION reject_test_citation()");
  globalThis.fetch = async () => Response.json(respond("rollback"));
  await assert.rejects(processReview(rollbackReview, env, database), /test injected write failure/);
  assert.deepEqual(await state(rollbackReview), { status: "pending", failure_reason: null, findings: 0, citations: 0 });
  await database.query("DROP TRIGGER reject_test_citation ON finding_evidence");
  await processReview(rollbackReview, env, database);
  assert.equal((await state(rollbackReview)).status, "ready");
  console.log("PASS real transaction rollback after partial writes, followed by successful retry");

  const transientReview = await seed("transient");
  globalThis.fetch = async () => new Response(null, { status: 503 });
  await assert.rejects(processReview(transientReview, env, database));
  assert.equal((await state(transientReview)).status, "pending");
  globalThis.fetch = async () => Response.json(respond("transient"));
  await processReview(transientReview, env, database);
  assert.equal((await state(transientReview)).status, "ready");
  const missing = await seed("missing");
  globalThis.fetch = async () => { assert.fail("Provider must not be called"); };
  await processReview(missing, { ...env, REVIEW_PROVIDER_API_KEY: undefined }, database);
  assert.equal((await state(missing)).status, "failed");
  assert.equal(dispatched.length, 5);
  console.log("PASS transient retry recovery and missing configuration fail-closed behavior");

  // The Review processor with a fake Review provider: it runs every Finding check.
  globalThis.fetch = async () => { assert.fail("The fake provider makes no request"); };
  let generated = 0;
  const provider = (output) => ({ evaluatorVersion: "fake/evidence-v1", async generate() { generated++; if (output instanceof Error) throw output; return output; } });
  const cite = (name) => ({ ...finding, evidenceIds: [`${name}-text`, `${name}-checkpoint`, `${name}-run`] });
  const invalid = await seed("invalid");
  await processReview(invalid, env, database, provider({ findings: [cite("invalid"), { ...cite("invalid"), evidenceIds: ["invented"] }] }));
  assert.deepEqual(await state(invalid), { status: "failed", failure_reason: "Review output failed finding or evidence-reference validation; no findings were published.", findings: 0, citations: 0 });
  const empty = await seed("empty");
  await processReview(empty, env, database, provider({ findings: [] }));
  assert.deepEqual(await state(empty), { status: "ready", failure_reason: null, findings: 0, citations: 0 });
  generated = 0;
  await processReview(empty, env, database, provider({ findings: [cite("empty")] }));
  await processReview(invalid, env, database, provider({ findings: [cite("invalid")] }));
  assert.equal(generated, 0, "a ready or failed Review is never generated again");
  console.log("PASS the Review processor runs the Finding checks and never regenerates a terminal Review");

  const tokens = async () => (await database.query("SELECT count FROM security_rate_limits WHERE key = 'review:owner'")).rows[0]?.count ?? 0;
  const outage = await seed("outage");
  const before = await tokens();
  await assert.rejects(processReview(outage, env, database, provider(new Error("provider outage"))));
  assert.equal((await state(outage)).status, "pending");
  assert.equal(await tokens(), before, "a transient failure takes no daily review token");
  await assert.rejects(processReview(outage, { ...env, PERSONAL_DATA_COLLECTION_APPROVED: "false" }, database, provider({ findings: [] })));
  assert.equal((await state(outage)).status, "pending", "the collection gate stops queue processing");
  console.log("PASS a transient failure and the collection gate leave the Review pending");

  generated = 0;
  const manifest = await seed("manifest");
  await database.query("UPDATE reviews SET evidence_manifest = $2 WHERE id = $1", [manifest, { attemptId: "other" }]);
  await processReview(manifest, env, database, provider({ findings: [] }));
  const unsubmitted = await seed("unsubmitted");
  await database.query("UPDATE reviews SET evidence_manifest = jsonb_set(evidence_manifest, '{finalCheckpointId}', '\"unsubmitted-code\"') WHERE id = $1", [unsubmitted]);
  await processReview(unsubmitted, env, database, provider({ findings: [] }));
  const crowded = await seed("crowded", "owner", (name) => database.query("INSERT INTO attempt_events (id, attempt_id, event_type, source_id, source_order, occurrence_offset_ms) SELECT $1 || '-extra-' || n, $1, 'draft_saved', $1 || '-extra-' || n, 0, 0 FROM generate_series(1, 200) n", [name]));
  await processReview(crowded, env, database, provider({ findings: [] }));
  for (const reviewId of [manifest, unsubmitted, crowded]) assert.equal((await state(reviewId)).status, "failed");
  assert.equal(generated, 0, "invalid evidence fails before the provider call");
  console.log("PASS an invalid manifest, a missing Submission, and oversized evidence fail closed");

  globalThis.reviewQueueDatabase = { query: database.query.bind(database), connect: database.connect.bind(database), end: async () => {} };
  const { default: worker } = await import(pathToFileURL(join(directory, "worker.mjs")));
  for (const [name, response, expected] of [["queued-transient", () => new Response(null, { status: 503 }), "retry"], ["queued-permanent", () => Response.json(envelope("{")), "ack"]]) {
    const reviewId = await seed(name);
    globalThis.fetch = async () => response();
    const actions = [];
    await worker.queue({ messages: [{ body: { reviewId }, ack: () => actions.push("ack"), retry: () => actions.push("retry") }, { body: {}, ack: () => actions.push("invalid-ack") }] }, env);
    assert.deepEqual(actions, [expected, "invalid-ack"]);
  }
  console.log("PASS the Worker queue retries transient failures and acknowledges terminal and invalid messages");
} finally {
  globalThis.fetch = originalFetch;
  await drop();
  await rm(directory, { recursive: true, force: true });
}
