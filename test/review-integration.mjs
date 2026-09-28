import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { parseEnv } from "node:util";
import pg from "pg";
import { env as providerEnv, finding, envelope } from "./reviews/fixtures.mjs";

const connectionString = process.env.DATABASE_URL ?? parseEnv(await readFile(".dev.vars", "utf8")).DATABASE_URL;
assert.ok(connectionString, "Set DATABASE_URL to local PostgreSQL");
assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(new URL(connectionString).hostname), "Only local fictional data is allowed");
const schema = `review_test_${crypto.randomUUID().replaceAll("-", "")}`;
const admin = new pg.Pool({ connectionString });
const database = new pg.Pool({ connectionString, options: `-c search_path=${schema}` });
const directory = await mkdtemp(join(tmpdir(), "review-postgres-"));
const originalFetch = globalThis.fetch;
let dispatched = [];
const env = { ...providerEnv, BETTER_AUTH_URL: "https://app.example", REVIEW_QUEUE: { send: async body => dispatched.push(body) } };
try {
  await admin.query(`CREATE SCHEMA ${schema}`);
  for (const path of ["migrations/auth/0000_colorful_vindicator.sql", "migrations/0002_application.sql", "migrations/0003_security.sql", "migrations/0004_mvp_content_foundation.sql"]) await database.query((await readFile(path, "utf8")).replaceAll('"public".', `"${schema}".`));
  await build({ entryPoints: ["src/api.ts"], outdir: directory, outExtension: { ".js": ".mjs" }, bundle: true, format: "esm", platform: "node", plugins: [{ name: "test-auth", setup(plugin) {
    plugin.onResolve({ filter: /^\.\/auth$/ }, () => ({ path: "auth", namespace: "test" }));
    plugin.onLoad({ filter: /.*/, namespace: "test" }, () => ({ contents: 'export const authenticatedUserId = async () => "owner"; export const passwordMatches = async () => false;' }));
  } }] });
  const { handleApi, processReview } = await import(pathToFileURL(join(directory, "api.mjs")));
  await database.query("INSERT INTO users (id, display_name, email) VALUES ('owner','Fixture','owner@example.invalid'), ('other','Other','other@example.invalid')");
  async function seed(name, owner = "owner") {
    await database.query("INSERT INTO attempts (id,user_id,problem_id,mode,input_mode,status,setup_context,consent_at,disclosure_version,practice_goal,draft_source) VALUES ($1,$2,'sum-odd-positions-v1','mock','text','active','{}',now(),'test','Do not send this private goal','def sum_odd_positions(values): return sum(values[1::2])')", [name, owner]);
    const events = [["text", "candidate_text", {}], ["checkpoint", "code_checkpoint", {}], ["run", "code_run", {}], ["help", "help_requested", {}], ["legacy", "interviewer_voice", {}], ["verified", "interviewer_voice", { verified: true }], ["hidden", "code_run", {}]];
    for (const [suffix, type, payload] of events) await database.query("INSERT INTO attempt_events (id,attempt_id,event_type,source_id,source_order,occurrence_offset_ms,payload) VALUES ($1,$2,$3,$1,0,0,$4)", [`${name}-${suffix}`, name, type, payload]);
    for (const [suffix, speaker] of [["text", "candidate"], ["legacy", "interviewer"], ["verified", "interviewer"]]) await database.query("INSERT INTO transcript_segments (id,attempt_id,event_id,speaker,text,end_offset_ms) VALUES ($1,$2,$3,$4,$5,0)", [`${name}-${suffix}-segment`, name, `${name}-${suffix}`, speaker, suffix === "legacy" ? "UNVERIFIED_DO_NOT_SEND" : "Discuss odd indexes"]);
    await database.query("INSERT INTO code_checkpoints (id,attempt_id,event_id,source_code,checkpoint_type) VALUES ($1,$2,$3,'def solve(values): return sum(values[1::2])','run')", [`${name}-code`, name, `${name}-checkpoint`]);
    for (const kind of ["visible", "submission"]) await database.query("INSERT INTO code_runs (id,attempt_id,checkpoint_id,event_id,status,tests_passed,test_results,run_kind,runner_version,harness_version) VALUES ($1,$2,$3,$4,'passed',1,$5,$6,'fixture','fixture')", [`${name}-${kind}`, name, `${name}-code`, `${name}-${kind === "visible" ? "run" : "hidden"}`, JSON.stringify([{ testId: kind === "visible" ? "sum-odd-empty-v1" : "HIDDEN_DO_NOT_SEND", outcome: "passed", actualOutput: 0 }]), kind]);
    await database.query("INSERT INTO assistance_events (id,attempt_id,event_id,category,offered,accepted,delivered,content) VALUES ($1,$2,$3,'hint',true,true,false,'')", [`${name}-help-record`, name, `${name}-help`]);
    if (owner !== "owner") return;
    const response = await handleApi(new Request(`https://app.example/api/attempts/${name}/finish`, { method: "POST", headers: { origin: "https://app.example", "content-type": "application/json" }, body: JSON.stringify({ sourceId: "finish", sourceOrder: 1, occurrenceOffsetMs: 5 }) }), env, {}, database);
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
  const apiReview = await handleApi(new Request("https://app.example/api/attempts/valid/review"), env, {}, database);
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
} finally {
  globalThis.fetch = originalFetch;
  await database.end();
  await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  await admin.end();
  await rm(directory, { recursive: true, force: true });
}
