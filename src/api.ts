import type { Pool, PoolClient } from "pg";
import { deleteAccount, exportAccount } from "./account";
import { withTransaction } from "./transaction";
import { deepgramVoiceEnabled } from "./deepgram";
import { limits } from "./security";
import { runnerFor, type RunOutcome } from "./runner";
import { reviewProviderConfigured } from "./review-provider";
import { logOperationalEvent } from "./observability";
import { answerInterviewerTurn, type UndeliveredReason } from "./interviewer-turn";
import type { Env } from "./env";
import { badRequest, boolean, forbidden, json, nonnegativeSafeInteger, notFound, requestBody, serverUnavailable, string } from "./http";
import type { SessionResolver } from "./request-handler";
import { openTimeline, withTimeline, type TimelineResult } from "./attempt-timeline";

const DISCLOSURE_VERSION = "pending-owner-data-policy";

export type AttemptRow = {
  id: string;
  user_id: string;
  problem_id: string;
  mode: "mock" | "coach";
  input_mode: "text" | "voice";
  status: "setup" | "active" | "interrupted" | "completed";
  draft_source: string;
  draft_revision: number;
  source_attempt_id: string | null;
  source_checkpoint_id: string | null;
  save_audio: boolean;
  setup_context: unknown;
  familiarity: string;
  practice_goal: string;
  created_at: string;
  updated_at: string;
};

function id(): string {
  return crypto.randomUUID();
}

function isMode(value: string | null): value is "mock" | "coach" {
  return value === "mock" || value === "coach";
}

function isInputMode(value: string | null): value is "text" | "voice" {
  return value === "text" || value === "voice";
}

function isFamiliarity(value: string | null): value is "unanswered" | "familiar" | "not_recalled" {
  return value === "unanswered" || value === "familiar" || value === "not_recalled";
}

async function ownedAttempt(pool: Pool, attemptId: string, userId: string): Promise<AttemptRow | null> {
  const result = await pool.query<AttemptRow>("SELECT * FROM attempts WHERE id = $1 AND user_id = $2", [attemptId, userId]);
  return result.rows[0] ?? null;
}

// Maps a timeline write that was not recorded to the route response.
function notRecorded(result: Exclude<TimelineResult, { status: "recorded" }>, invalidMessage: string): Response {
  if (result.status === "invalid") return badRequest(invalidMessage);
  if (result.status === "closed") return json({ error: "This attempt is finished. Nothing new was recorded." }, { status: 409 });
  return json({ error: "This attempt reached its evidence limit. Nothing new was recorded." }, { status: 409 });
}

// Records the first Event of a new Attempt, in the transaction that inserted the Attempt.
async function recordStart(client: PoolClient, attemptId: string, eventType: "attempt_started" | "retry_started", payload: unknown): Promise<void> {
  const opened = await openTimeline(client, attemptId);
  const recorded = opened.status === "open" ? await opened.timeline.record(eventType, { sourceId: `server:${eventType === "attempt_started" ? "start" : "retry"}:${attemptId}`, sourceOrder: 0, occurrenceOffsetMs: 0 }, payload) : opened;
  if (recorded.status !== "recorded") throw new Error(`The ${eventType} Event was not recorded.`);
}

export async function catalog(pool: Pool): Promise<Response> {
  const result = await pool.query(
    `SELECT id, title, topic, difficulty, prompt, starter_code, entry_point, test_contract
       FROM problems
      WHERE is_active = true AND is_sample = false
      ORDER BY topic, title`,
  );
  return json({ problems: result.rows });
}

async function listAttempts(pool: Pool, userId: string, page: number): Promise<Response> {
  const result = await pool.query(
    `SELECT a.id, a.mode, a.input_mode, a.status, a.draft_revision, a.source_attempt_id, a.source_checkpoint_id,
            a.practice_goal, a.familiarity, a.created_at, a.updated_at, p.id AS problem_id, p.title, p.topic,
            r.status AS review_status
       FROM attempts a
       JOIN problems p ON p.id = a.problem_id
       LEFT JOIN reviews r ON r.attempt_id = a.id
      WHERE a.user_id = $1
      ORDER BY a.updated_at DESC, a.id DESC LIMIT $2 OFFSET $3`,
    [userId, limits.pageSize, page * limits.pageSize],
  );
  return json({ attempts: result.rows, page, hasMore: result.rows.length === limits.pageSize });
}

async function createAttempt(pool: Pool, env: Env, userId: string, body: Record<string, unknown>): Promise<Response> {
  const problemId = string(body.problemId);
  const mode = string(body.mode);
  const inputMode = string(body.inputMode);
  const practiceGoal = string(body.practiceGoal);
  const consent = boolean(body.consent);
  const saveAudio = boolean(body.saveAudio);
  const familiarity = string(body.familiarity) ?? "unanswered";
  const setupContext = body.setupContext ?? {};
  if (typeof setupContext !== "object" || setupContext === null || Array.isArray(setupContext)
    || Object.entries(setupContext).some(([key, value]) => !["studiedTopics", "concern"].includes(key) || typeof value !== "string")) return badRequest("Invalid setup context.");
  if (!problemId || !isMode(mode) || !isInputMode(inputMode) || !practiceGoal || consent !== true || saveAudio === null || !isFamiliarity(familiarity)) {
    return badRequest("A problem, mode, input mode, practice goal, familiarity, and session-record consent are required.");
  }
  if (saveAudio) return badRequest("Saved audio is unavailable until the owner approves the retention and provider policy.");
  if (inputMode === "voice" && !deepgramVoiceEnabled(env)) return serverUnavailable("Voice interviewing is not configured. No attempt was created.");

  const problem = await pool.query<{ id: string; starter_code: string }>("SELECT id, starter_code FROM problems WHERE id = $1 AND is_active = true AND is_sample = false", [problemId]);
  if (!problem.rows[0]) return badRequest("That practice problem is unavailable.");
  const attemptId = id();
  await withTransaction(pool, async (client) => {
    await client.query(
      `INSERT INTO attempts (id, user_id, problem_id, mode, input_mode, status, draft_source, setup_context, familiarity, consent_at, disclosure_version, practice_goal, save_audio)
       VALUES ($1, $2, $3, $4, $5, 'active', $6, $7::jsonb, $8, now(), $9, $10, false)`,
      [attemptId, userId, problemId, mode, inputMode, problem.rows[0].starter_code, JSON.stringify(setupContext), familiarity, DISCLOSURE_VERSION, practiceGoal],
    );
    await recordStart(client, attemptId, "attempt_started", { mode, inputMode, consented: true });
  });
  return json({ attemptId }, { status: 201 });
}

async function attemptDetail(pool: Pool, attempt: AttemptRow, page: number): Promise<Response> {
  const [problem, visibleTests, events, transcripts, checkpoints, runs, review] = await Promise.all([
    pool.query("SELECT id, title, topic, difficulty, prompt, starter_code, entry_point, test_contract FROM problems WHERE id = $1", [attempt.problem_id]),
    // Visible tests are shown to the candidate; hidden tests never leave the server.
    pool.query("SELECT id, input_data, expected_output FROM test_cases WHERE problem_id = $1 AND visibility = 'visible' ORDER BY id", [attempt.problem_id]),
    pool.query("SELECT id, event_type, source_id, source_order, occurrence_offset_ms, server_received_at, payload, created_at FROM attempt_events WHERE attempt_id = $1 ORDER BY occurrence_offset_ms, source_id, source_order, id LIMIT $2 OFFSET $3", [attempt.id, limits.pageSize, page * limits.pageSize]),
    pool.query("SELECT id, event_id, speaker, text, end_offset_ms, created_at FROM transcript_segments WHERE attempt_id = $1 ORDER BY end_offset_ms, id LIMIT $2 OFFSET $3", [attempt.id, limits.pageSize, page * limits.pageSize]),
    pool.query("SELECT id, event_id, source_code, checkpoint_type, created_at FROM code_checkpoints WHERE attempt_id = $1 ORDER BY created_at, id LIMIT $2 OFFSET $3", [attempt.id, limits.pageSize, page * limits.pageSize]),
    pool.query("SELECT id, checkpoint_id, event_id, status, tests_passed, tests_failed, stdout, stderr, execution_time_ms, runner_error, test_results, run_kind, runner_version, harness_version, created_at FROM code_runs WHERE attempt_id = $1 ORDER BY created_at, id LIMIT $2 OFFSET $3", [attempt.id, limits.pageSize, page * limits.pageSize]),
    pool.query("SELECT id, status, failure_reason, evidence_manifest, created_at, updated_at FROM reviews WHERE attempt_id = $1", [attempt.id]),
  ]);
  return json({ page, hasMore: [events, transcripts, checkpoints, runs].some(result => result.rows.length === limits.pageSize), attempt, problem: problem.rows[0], visibleTests: visibleTests.rows, events: events.rows, transcripts: transcripts.rows, checkpoints: checkpoints.rows, runs: runs.rows, review: review.rows[0] ?? null });
}

// The candidate-facing message for each reason a text Interviewer turn gives no reply.
const replyErrors: Record<Exclude<UndeliveredReason, "voice ready" | "voice not configured">, string> = {
  "not configured": "The text interviewer is not configured, so no reply was generated.",
  "attempt limit": "This attempt reached its interviewer reply limit, so no reply was generated.",
  "hourly limit": "Too many interviewer replies this hour, so no reply was generated.",
  "nothing to answer": "There was no message to answer, so no reply was generated.",
  "model failed": "The interviewer could not respond, so no reply was generated.",
  "closed": "The attempt closed before the reply was saved, so no reply was recorded.",
  "not saved": "The reply could not be saved, so no reply was recorded.",
};

async function appendCandidateMessage(pool: Pool, env: Env, attempt: AttemptRow, body: Record<string, unknown>): Promise<Response> {
  const invalid = "A message and stable event metadata are required.";
  const text = string(body.text);
  if (text === null) return badRequest(invalid);
  const recorded = await withTimeline(pool, attempt.id, (timeline) => timeline.record("candidate_text", body, { inputMode: "text" }, { transcript: { speaker: "candidate", text } }));
  if (recorded.status !== "recorded") return notRecorded(recorded, invalid);
  const { eventId } = recorded;
  const turn = await answerInterviewerTurn(pool, env, attempt, { eventId, occurrenceOffsetMs: body.occurrenceOffsetMs as number });
  if (turn.status === "replied") return json({ eventId, reply: turn.reply }, { status: 201 });
  if (turn.reason === "voice ready" || turn.reason === "voice not configured") return json({ eventId }, { status: 201 });
  return json({ eventId, reply: null, replyError: replyErrors[turn.reason] }, { status: 201 });
}

async function requestHelp(pool: Pool, env: Env, attempt: AttemptRow, body: Record<string, unknown>): Promise<Response> {
  const invalid = "A help category and stable event metadata are required.";
  const category = string(body.category);
  if (category !== "clarification" && category !== "hint" && category !== "explanation") return badRequest(invalid);
  const recorded = await withTimeline(pool, attempt.id, (timeline) => timeline.record("help_requested", body, { category }, { helpRequest: { category } }));
  if (recorded.status !== "recorded") return notRecorded(recorded, invalid);
  const { eventId } = recorded;
  const turn = await answerInterviewerTurn(pool, env, attempt, { eventId, occurrenceOffsetMs: body.occurrenceOffsetMs as number, helpCategory: category });
  if (turn.status === "replied") {
    return json({ eventId, delivered: true, voiceReady: false, reply: turn.reply, message: `Your ${category} request was answered in the conversation.` }, { status: 201 });
  }
  if (turn.reason === "voice ready") {
    return json({ eventId, delivered: false, voiceReady: true, message: `Your ${category} request was recorded and is ready for the live interviewer.` }, { status: 202 });
  }
  if (turn.reason === "voice not configured") {
    return json({ eventId, delivered: false, voiceReady: false, message: `Your ${category} request was recorded, but no guidance was delivered because the live conversation provider is not configured.` }, { status: 202 });
  }
  return json({ eventId, delivered: false, voiceReady: false, reply: null, message: `Your ${category} request was recorded, but no guidance was delivered. ${replyErrors[turn.reason]}` }, { status: 202 });
}

async function saveDraft(pool: Pool, attempt: AttemptRow, body: Record<string, unknown>): Promise<Response> {
  const invalid = "A draft, expected revision, and stable event metadata are required.";
  const source = string(body.source);
  const expectedRevision = body.expectedRevision;
  if (source === null || !nonnegativeSafeInteger(expectedRevision)) return badRequest(invalid);
  const saved = await withTimeline(pool, attempt.id, async (timeline, client) => {
    // The timeline holds the Attempt lock, so the revision cannot change before the update.
    if (timeline.attempt.draft_revision !== expectedRevision) return { status: "conflict" } as const;
    const recorded = await timeline.record("draft_saved", body, { draftRevision: expectedRevision + 1 });
    if (recorded.status !== "recorded") return recorded;
    const result = await client.query<AttemptRow>(
      `UPDATE attempts SET draft_source = $1, draft_revision = draft_revision + 1, updated_at = now(), status = CASE WHEN status = 'setup' THEN 'active' ELSE status END
        WHERE id = $2 RETURNING *`,
      [source, attempt.id],
    );
    return { status: "saved", attempt: result.rows[0] } as const;
  });
  if (saved.status === "conflict") return json({ error: "The draft changed elsewhere. Reload before saving again." }, { status: 409 });
  if (saved.status !== "saved") return notRecorded(saved, invalid);
  return json({ draftRevision: saved.attempt.draft_revision, updatedAt: saved.attempt.updated_at });
}

// The candidate-facing message for each reason the Runner gives no result.
const runnerUnavailable: Record<Extract<RunOutcome, { status: "unavailable" }>["reason"], string> = {
  "unreachable": "The isolated Python runner could not be reached. Your saved checkpoint is intact and this is not a code result.",
  "http failure": "The isolated Python runner reported an infrastructure failure. Your saved checkpoint is intact and this is not a code result.",
  "too large": "The runner result exceeded the response limit.",
  "invalid result": "The isolated Python runner returned an invalid result. No test verdict was recorded.",
};

async function runCode(pool: Pool, env: Env, attempt: AttemptRow, body: Record<string, unknown>): Promise<Response> {
  const invalid = "Stable run event metadata is required.";
  const runner = runnerFor(env);
  if (!runner) return serverUnavailable("The isolated Python runner is not configured. Your draft remains available and this is not a code result.");
  const checkpoint = await withTimeline(pool, attempt.id, async (timeline) => ({
    ...await timeline.record("code_checkpoint", body, { checkpointType: "run", draftRevision: timeline.attempt.draft_revision }, { checkpoint: { type: "run" } }),
    sourceCode: timeline.attempt.draft_source,
  }));
  if (checkpoint.status !== "recorded") return notRecorded(checkpoint, invalid);
  // A recorded Checkpoint Event always has its Checkpoint row.
  const checkpointId = checkpoint.detailId!;
  const content = await pool.query<{ id: string; entry_point: string; test_contract: unknown; input_data: unknown; expected_output: unknown }>(
    `SELECT p.entry_point, p.test_contract, tc.id, tc.input_data, tc.expected_output
       FROM problems p JOIN test_cases tc ON tc.problem_id = p.id
      WHERE p.id = $1 AND tc.visibility = 'visible'`,
    [attempt.problem_id],
  );
  const outcome = await runner.run({ attemptId: attempt.id, checkpointId, sourceCode: checkpoint.sourceCode, entryPoint: content.rows[0]?.entry_point, testContract: content.rows[0]?.test_contract, tests: content.rows.map(({ id: testId, input_data: inputData, expected_output: expectedOutput }) => ({ testId, inputData, expectedOutput })) });
  if (outcome.status === "unavailable") return serverUnavailable(runnerUnavailable[outcome.reason]);
  const { result } = outcome;
  const passed = result.testResults.filter((test) => test.outcome === "passed").length;
  const failed = result.testResults.filter((test) => test.outcome === "failed").length;
  const envelope = { sourceId: `${body.sourceId}:result`, sourceOrder: body.sourceOrder, occurrenceOffsetMs: body.occurrenceOffsetMs };
  const run = await withTimeline(pool, attempt.id, (timeline) => timeline.record("code_run", envelope, { checkpointId, runnerVersion: result.runnerVersion, harnessVersion: result.harnessVersion }, { run: { checkpointId, result } }));
  if (run.status !== "recorded") return notRecorded(run, invalid);
  return json({ runId: run.detailId, checkpointId, status: result.status, testsPassed: passed, testsFailed: failed, testResults: result.testResults });
}

async function finishAttempt(pool: Pool, env: Env, attempt: AttemptRow, body: Record<string, unknown>): Promise<Response> {
  if (!reviewProviderConfigured(env) || !env.REVIEW_QUEUE?.send) return serverUnavailable("Evidence review is not configured. The attempt remains active.");
  // One transaction: the Submission, the Attempt completion, and the Review.
  const finished = await withTimeline(pool, attempt.id, async (timeline, client) => {
    const submission = await timeline.record("code_checkpoint", body, { checkpointType: "submission", draftRevision: timeline.attempt.draft_revision }, { checkpoint: { type: "submission" } });
    if (submission.status !== "recorded") return submission;
    await client.query("UPDATE attempts SET status = 'completed', completed_at = now(), updated_at = now() WHERE id = $1", [attempt.id]);
    const reviewId = id();
    const manifest = { attemptId: attempt.id, finalCheckpointId: submission.detailId, frozenAt: new Date().toISOString() };
    await client.query("INSERT INTO reviews (id, attempt_id, status, evidence_manifest) VALUES ($1, $2, 'pending', $3::jsonb)", [reviewId, attempt.id, JSON.stringify(manifest)]);
    return { status: "finished", reviewId } as const;
  });
  let reviewId: string;
  if (finished.status === "closed") {
    // A finished Attempt: dispatch its Review again if the first dispatch was lost.
    const review = await pool.query<{ id: string }>("SELECT id FROM reviews WHERE attempt_id = $1", [attempt.id]);
    if (!review.rows[0]) return notFound();
    reviewId = review.rows[0].id;
  } else if (finished.status === "finished") {
    reviewId = finished.reviewId;
  } else {
    return notRecorded(finished, "Stable finish event metadata is required.");
  }
  const claim = await pool.query("UPDATE reviews SET dispatch_claimed_at = now() WHERE id = $1 AND status = 'pending' AND (dispatch_claimed_at IS NULL OR dispatch_claimed_at < now() - interval '60 seconds') RETURNING id", [reviewId]);
  const dispatch = claim.rows.length ? "queued" : "already dispatched";
  if (claim.rows.length) {
    try { await env.REVIEW_QUEUE.send({ reviewId }); }
    catch { logOperationalEvent("warn", "review_dispatch_failed"); await pool.query("UPDATE reviews SET dispatch_claimed_at = NULL WHERE id = $1 AND status = 'pending'", [reviewId]); return serverUnavailable("Review dispatch failed. Retry finishing this attempt."); }
  }
  return json({ reviewId, dispatch, recoveryDispatch: finished.status === "closed" });
}

async function retryFromCheckpoint(pool: Pool, userId: string, attempt: AttemptRow, body: Record<string, unknown>): Promise<Response> {
  const checkpointId = string(body.checkpointId);
  const practiceGoal = string(body.practiceGoal);
  if (!checkpointId || !practiceGoal) return badRequest("A supported checkpoint and practice goal are required.");
  const source = await pool.query<AttemptRow & { checkpoint_code: string; occurrence_offset_ms: number }>(
    `SELECT a.*, c.source_code AS checkpoint_code, e.occurrence_offset_ms
       FROM code_checkpoints c
       JOIN attempts a ON a.id = c.attempt_id
       JOIN attempt_events e ON e.id = c.event_id
      WHERE c.id = $1 AND a.user_id = $2 AND a.id = $3 AND a.source_attempt_id IS NULL AND c.checkpoint_type IN ('run', 'submission')`,
    [checkpointId, userId, attempt.id],
  );
  const original = source.rows[0];
  if (!original) return forbidden();
  const attemptId = id();
  await withTransaction(pool, async (client) => {
    await client.query(
      `INSERT INTO attempts (id, user_id, problem_id, mode, input_mode, status, source_attempt_id, source_checkpoint_id, draft_source, setup_context, familiarity, consent_at, disclosure_version, practice_goal, save_audio)
       VALUES ($1, $2, $3, 'coach', $4, 'active', $5, $6, $7, $8::jsonb, 'unanswered', now(), $9, $10, false)`,
      [attemptId, userId, original.problem_id, original.input_mode, original.id, checkpointId, original.checkpoint_code, JSON.stringify({ sourceCheckpointId: checkpointId, sourceAttemptId: original.id, throughOffsetMs: original.occurrence_offset_ms }), DISCLOSURE_VERSION, practiceGoal],
    );
    await recordStart(client, attemptId, "retry_started", { sourceAttemptId: original.id, sourceCheckpointId: checkpointId });
  });
  return json({ attemptId }, { status: 201 });
}

async function reviewDetail(pool: Pool, attempt: AttemptRow): Promise<Response> {
  const review = await pool.query("SELECT id, status, failure_reason, evidence_manifest, created_at, updated_at FROM reviews WHERE attempt_id = $1", [attempt.id]);
  if (!review.rows[0]) return notFound();
  const findings = await pool.query(
    `SELECT f.*, EXISTS (SELECT 1 FROM finding_corrections c WHERE c.finding_id = f.id) AS is_disputed,
            COALESCE(json_agg(json_build_object('eventId', fe.event_id, 'locator', fe.locator)) FILTER (WHERE fe.id IS NOT NULL), '[]'::json) AS evidence
       FROM review_findings f
       LEFT JOIN finding_evidence fe ON fe.finding_id = f.id
      WHERE f.review_id = $1
      GROUP BY f.id
      ORDER BY f.created_at`,
    [review.rows[0].id],
  );
  return json({ review: review.rows[0], findings: findings.rows });
}

async function correctFinding(pool: Pool, userId: string, attempt: AttemptRow, findingId: string, body: Record<string, unknown>): Promise<Response> {
  const reason = string(body.reason);
  if (!reason) return badRequest("Explain what should be corrected.");
  const finding = await pool.query<{ id: string }>(
    `SELECT f.id FROM review_findings f JOIN reviews r ON r.id = f.review_id WHERE f.id = $1 AND r.attempt_id = $2`,
    [findingId, attempt.id],
  );
  if (!finding.rows[0]) return notFound();
  await pool.query("INSERT INTO finding_corrections (id, finding_id, user_id, reason) VALUES ($1, $2, $3, $4)", [id(), findingId, userId, reason]);
  return json({ corrected: true }, { status: 201 });
}

async function relatedProblems(pool: Pool, userId: string, attempt: AttemptRow): Promise<Response> {
  const result = await pool.query(
    `SELECT p.id, p.title, p.topic, rp.relationship_reason,
            EXISTS (SELECT 1 FROM attempts prior WHERE prior.user_id = $1 AND prior.problem_id = p.id) AS attempted_before
       FROM related_problems rp
       JOIN problems p ON p.id = rp.related_problem_id
      WHERE rp.source_problem_id = $2 AND p.is_active = true AND p.is_sample = false`,
    [userId, attempt.problem_id],
  );
  return json({ relatedProblems: result.rows });
}

// Routing only. The request pipeline (request-handler.ts) has already applied the
// collection gate, origin check, body size limit, session, and rate limit.
export async function routeApi(request: Request, env: Env, _ctx: ExecutionContext, { pool, userId, sessions }: { pool: Pool; userId: string; sessions: SessionResolver }): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;
  const page = Number(url.searchParams.get("page") ?? 0);
  if (!Number.isSafeInteger(page) || page < 0 || !Number.isSafeInteger(page * limits.pageSize)) return badRequest("Invalid page.");
  if (path === "/api/me" && request.method === "GET") return json({ userId });
  if (path === "/api/me" && request.method === "DELETE") return deleteAccount(request, sessions, pool, userId);
  if (path === "/api/me/export" && request.method === "GET") return exportAccount(pool, userId);
  if (path === "/api/attempts" && request.method === "GET") return listAttempts(pool, userId, page);
  if (path === "/api/attempts" && request.method === "POST") {
    const body = await requestBody(request);
    return body ? createAttempt(pool, env, userId, body) : badRequest("Expected a JSON request body.");
  }
  const attemptMatch = /^\/api\/attempts\/([^/]+)(?:\/(draft|run|finish|retry|review|related|messages|help|voice))?(?:\/findings\/([^/]+)\/corrections)?$/.exec(path);
  if (!attemptMatch) return notFound();
  const attempt = await ownedAttempt(pool, decodeURIComponent(attemptMatch[1]), userId);
  if (!attempt) return forbidden();
  const action = attemptMatch[2];
  if (!action && request.method === "GET") return attemptDetail(pool, attempt, page);
  if (action === "draft" && request.method === "PATCH") {
    const body = await requestBody(request);
    return body ? saveDraft(pool, attempt, body) : badRequest("Expected a JSON request body.");
  }
  if (action === "run" && request.method === "POST") {
    const body = await requestBody(request);
    return body ? runCode(pool, env, attempt, body) : badRequest("Expected a JSON request body.");
  }
  if (action === "messages" && request.method === "POST") {
    const body = await requestBody(request);
    return body ? appendCandidateMessage(pool, env, attempt, body) : badRequest("Expected a JSON request body.");
  }
  if (action === "voice" && request.method === "GET") {
    if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") return badRequest("WebSocket required.");
    if (attempt.input_mode !== "voice" || attempt.status === "completed") return badRequest("This attempt is not accepting voice input.");
    const headers = new Headers(request.headers);
    headers.set("x-attempt-id", attempt.id);
    headers.set("x-user-id", userId);
    return env.VOICE_SESSIONS.get(env.VOICE_SESSIONS.idFromName(attempt.id)).fetch(new Request(request, { headers }));
  }
  if (action === "help" && request.method === "POST") {
    const body = await requestBody(request);
    return body ? requestHelp(pool, env, attempt, body) : badRequest("Expected a JSON request body.");
  }
  if (action === "finish" && request.method === "POST") {
    const body = await requestBody(request);
    return body ? finishAttempt(pool, env, attempt, body) : badRequest("Expected a JSON request body.");
  }
  if (action === "retry" && request.method === "POST") {
    const body = await requestBody(request);
    return body ? retryFromCheckpoint(pool, userId, attempt, body) : badRequest("Expected a JSON request body.");
  }
  if (action === "review" && request.method === "GET") return reviewDetail(pool, attempt);
  if (action === "related" && request.method === "GET") return relatedProblems(pool, userId, attempt);
  if (action === "review" && attemptMatch[3] && request.method === "POST") {
    const body = await requestBody(request);
    return body ? correctFinding(pool, userId, attempt, decodeURIComponent(attemptMatch[3]), body) : badRequest("Expected a JSON request body.");
  }
  return notFound();
}

export { processReview } from "./reviews";
