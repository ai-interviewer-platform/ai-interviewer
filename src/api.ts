import type { Pool, PoolClient } from "pg";
import { authenticatedUserId } from "./auth";
import { personalCollectionEnabled, personalCollectionUnavailable } from "./data-policy";
import { DEEPGRAM_THINKING_MODEL, DEEPGRAM_VOICE_PROVIDER, deepgramVoiceEnabled } from "./deepgram";
import { consumeRate, limits } from "./security";
import type { Env } from "./env";
import { badRequest, boolean, boundedRequest, checkOrigin, forbidden, json, nonnegativeSafeInteger, notFound, requestBody, serverUnavailable, string, unauthorized } from "./http";

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

type RunnerResult = {
  status: "passed" | "failed" | "runner_error";
  testResults: Array<{ testId: string; outcome: "passed" | "failed" | "skipped"; actualOutput?: unknown; error?: string }>;
  stdout?: string;
  stderr?: string;
  executionTimeMs?: number;
  runnerVersion: string;
  harnessVersion: string;
  runnerError?: string;
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

function isVoiceRole(value: string | null): value is "user" | "assistant" {
  return value === "user" || value === "assistant";
}

async function withTransaction<T>(pool: Pool, operation: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await operation(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function ownedAttempt(pool: Pool, attemptId: string, userId: string): Promise<AttemptRow | null> {
  const result = await pool.query<AttemptRow>("SELECT * FROM attempts WHERE id = $1 AND user_id = $2", [attemptId, userId]);
  return result.rows[0] ?? null;
}

async function addEvent(client: PoolClient, values: {
  attemptId: string;
  eventType: string;
  sourceId: string;
  sourceOrder: number;
  occurrenceOffsetMs: number;
  payload: unknown;
}): Promise<string> {
  const locked = await client.query("SELECT status FROM attempts WHERE id = $1 FOR UPDATE", [values.attemptId]);
  if (!locked.rows[0] || locked.rows[0].status === "completed") throw new Error("Attempt is closed.");
  const existingEvent = await client.query<{ id: string }>("SELECT id FROM attempt_events WHERE attempt_id = $1 AND source_id = $2", [values.attemptId, values.sourceId]);
  if (existingEvent.rows[0]) return existingEvent.rows[0].id;
  const count = await client.query<{ count: string }>("SELECT count(*) FROM attempt_events WHERE attempt_id = $1", [values.attemptId]);
  if (Number(count.rows[0].count) >= limits.eventsPerAttempt) throw new Error("Attempt evidence limit reached.");
  const eventId = id();
  const inserted = await client.query<{ id: string }>(
    `INSERT INTO attempt_events (id, attempt_id, event_type, source_id, source_order, occurrence_offset_ms, payload)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
     ON CONFLICT (attempt_id, source_id) DO NOTHING
     RETURNING id`,
    [eventId, values.attemptId, values.eventType, values.sourceId, values.sourceOrder, values.occurrenceOffsetMs, JSON.stringify(values.payload)],
  );
  if (inserted.rows[0]) return inserted.rows[0].id;
  const existing = await client.query<{ id: string }>("SELECT id FROM attempt_events WHERE attempt_id = $1 AND source_id = $2", [values.attemptId, values.sourceId]);
  if (!existing.rows[0]) throw new Error("The event could not be persisted.");
  return existing.rows[0].id;
}

async function createCheckpoint(client: PoolClient, attempt: AttemptRow, type: "run" | "save" | "submission" | "retry_source", sourceId: string, sourceOrder: number, occurrenceOffsetMs: number): Promise<{ checkpointId: string; eventId: string }> {
  const eventId = await addEvent(client, {
    attemptId: attempt.id,
    eventType: "code_checkpoint",
    sourceId,
    sourceOrder,
    occurrenceOffsetMs,
    payload: { checkpointType: type, draftRevision: attempt.draft_revision },
  });
  const existing = await client.query<{ id: string }>("SELECT id FROM code_checkpoints WHERE event_id = $1", [eventId]);
  if (existing.rows[0]) return { checkpointId: existing.rows[0].id, eventId };
  const checkpointId = id();
  await client.query(
    "INSERT INTO code_checkpoints (id, attempt_id, event_id, source_code, checkpoint_type) VALUES ($1, $2, $3, $4, $5)",
    [checkpointId, attempt.id, eventId, attempt.draft_source, type],
  );
  return { checkpointId, eventId };
}

function parseRunnerResult(value: unknown, permittedTestIds: Set<string>): RunnerResult | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  const status = string(candidate.status);
  const runnerVersion = string(candidate.runnerVersion);
  const harnessVersion = string(candidate.harnessVersion);
  if ((status !== "passed" && status !== "failed" && status !== "runner_error") || !runnerVersion || !harnessVersion || !Array.isArray(candidate.testResults)) return null;
  const testResults: RunnerResult["testResults"] = [];
  const receivedTestIds = new Set<string>();
  for (const item of candidate.testResults) {
    if (typeof item !== "object" || item === null || Array.isArray(item)) return null;
    const result = item as Record<string, unknown>;
    const testId = string(result.testId);
    const outcome = string(result.outcome);
    if (!testId || !permittedTestIds.has(testId) || receivedTestIds.has(testId) || (outcome !== "passed" && outcome !== "failed" && outcome !== "skipped")) return null;
    receivedTestIds.add(testId);
    testResults.push({ testId, outcome, actualOutput: result.actualOutput, error: string(result.error) ?? undefined });
  }
  if (receivedTestIds.size !== permittedTestIds.size) return null;
  const executionTimeMs = typeof candidate.executionTimeMs === "number" && Number.isSafeInteger(candidate.executionTimeMs) && candidate.executionTimeMs >= 0 ? candidate.executionTimeMs : undefined;
  return {
    status,
    testResults,
    stdout: string(candidate.stdout) ?? "",
    stderr: string(candidate.stderr) ?? "",
    executionTimeMs,
    runnerVersion,
    harnessVersion,
    runnerError: string(candidate.runnerError) ?? undefined,
  };
}

async function catalog(pool: Pool): Promise<Response> {
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

async function createAttempt(pool: Pool, userId: string, body: Record<string, unknown>): Promise<Response> {
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

  const problem = await pool.query<{ id: string; starter_code: string }>("SELECT id, starter_code FROM problems WHERE id = $1 AND is_active = true AND is_sample = false", [problemId]);
  if (!problem.rows[0]) return badRequest("That practice problem is unavailable.");
  const attemptId = id();
  await withTransaction(pool, async (client) => {
    await client.query(
      `INSERT INTO attempts (id, user_id, problem_id, mode, input_mode, status, draft_source, setup_context, familiarity, consent_at, disclosure_version, practice_goal, save_audio)
       VALUES ($1, $2, $3, $4, $5, 'active', $6, $7::jsonb, $8, now(), $9, $10, false)`,
      [attemptId, userId, problemId, mode, inputMode, problem.rows[0].starter_code, JSON.stringify(setupContext), familiarity, DISCLOSURE_VERSION, practiceGoal],
    );
    await addEvent(client, { attemptId, eventType: "attempt_started", sourceId: `server:start:${attemptId}`, sourceOrder: 0, occurrenceOffsetMs: 0, payload: { mode, inputMode, consented: true } });
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

async function appendCandidateMessage(pool: Pool, attempt: AttemptRow, body: Record<string, unknown>): Promise<Response> {
  const text = string(body.text);
  const sourceId = string(body.sourceId);
  const sourceOrder = body.sourceOrder;
  const occurrenceOffsetMs = body.occurrenceOffsetMs;
  if (!text?.trim() || !sourceId || !nonnegativeSafeInteger(sourceOrder) || !nonnegativeSafeInteger(occurrenceOffsetMs)) return badRequest("A message and stable event metadata are required.");
  const eventId = await withTransaction(pool, async (client) => {
    const eventId = await addEvent(client, { attemptId: attempt.id, eventType: "candidate_text", sourceId, sourceOrder, occurrenceOffsetMs, payload: { inputMode: "text" } });
    const existing = await client.query<{ id: string }>("SELECT id FROM transcript_segments WHERE event_id = $1", [eventId]);
    if (!existing.rows[0]) {
      await client.query("INSERT INTO transcript_segments (id, attempt_id, event_id, speaker, text, end_offset_ms) VALUES ($1, $2, $3, 'candidate', $4, $5)", [id(), attempt.id, eventId, text.trim(), occurrenceOffsetMs]);
    }
    return eventId;
  });
  return json({ eventId }, { status: 201 });
}

export async function appendVoiceTranscript(pool: Pool, attempt: AttemptRow, body: Record<string, unknown>): Promise<Response> {
  const text = string(body.text);
  const role = string(body.role);
  const providerSessionId = string(body.providerSessionId);
  const sourceId = string(body.sourceId);
  const sourceOrder = body.sourceOrder;
  const occurrenceOffsetMs = body.occurrenceOffsetMs;
  if (attempt.input_mode !== "voice" || attempt.status === "completed") return badRequest("This attempt is not accepting voice evidence.");
  if (!text?.trim() || !isVoiceRole(role) || !providerSessionId || !sourceId || !nonnegativeSafeInteger(sourceOrder) || !nonnegativeSafeInteger(occurrenceOffsetMs)) {
    return badRequest("A Deepgram transcript and stable event metadata are required.");
  }

  const speaker = role === "user" ? "candidate" : attempt.mode === "coach" ? "coach" : "interviewer";
  const eventId = await withTransaction(pool, async (client) => {
    const eventId = await addEvent(client, {
      attemptId: attempt.id,
      eventType: role === "user" ? "candidate_voice" : "interviewer_voice",
      sourceId,
      sourceOrder,
      occurrenceOffsetMs,
      payload: { verified: true, inputMode: "voice", provider: DEEPGRAM_VOICE_PROVIDER, providerSessionId, role },
    });
    const existing = await client.query<{ id: string }>("SELECT id FROM transcript_segments WHERE event_id = $1", [eventId]);
    if (!existing.rows[0]) {
      await client.query(
        "INSERT INTO transcript_segments (id, attempt_id, event_id, speaker, text, end_offset_ms) VALUES ($1, $2, $3, $4, $5, $6)",
        [id(), attempt.id, eventId, speaker, text.trim(), occurrenceOffsetMs],
      );

    }
    return eventId;
  });
  return json({ eventId }, { status: 201 });
}

async function requestHelp(pool: Pool, env: Env, attempt: AttemptRow, body: Record<string, unknown>): Promise<Response> {
  const category = string(body.category);
  const sourceId = string(body.sourceId);
  const sourceOrder = body.sourceOrder;
  const occurrenceOffsetMs = body.occurrenceOffsetMs;
  if ((category !== "clarification" && category !== "hint" && category !== "explanation") || !sourceId || !nonnegativeSafeInteger(sourceOrder) || !nonnegativeSafeInteger(occurrenceOffsetMs)) return badRequest("A help category and stable event metadata are required.");
  const eventId = await withTransaction(pool, async (client) => {
    const eventId = await addEvent(client, { attemptId: attempt.id, eventType: "help_requested", sourceId, sourceOrder, occurrenceOffsetMs, payload: { category } });
    const existing = await client.query<{ id: string }>("SELECT id FROM assistance_events WHERE event_id = $1", [eventId]);
    if (!existing.rows[0]) {
      await client.query("INSERT INTO assistance_events (id, attempt_id, event_id, category, offered, accepted, delivered, content) VALUES ($1, $2, $3, $4, true, true, false, '')", [id(), attempt.id, eventId, category]);
    }
    return eventId;
  });
  const voiceReady = attempt.input_mode === "voice" && deepgramVoiceEnabled(env);
  return json({
    eventId,
    delivered: false,
    voiceReady,
    message: voiceReady
      ? `Your ${category} request was recorded and is ready for the live interviewer.`
      : `Your ${category} request was recorded, but no guidance was delivered because the live conversation provider is not configured.`,
  }, { status: 202 });
}

async function saveDraft(pool: Pool, attempt: AttemptRow, body: Record<string, unknown>): Promise<Response> {
  const source = string(body.source);
  const expectedRevision = body.expectedRevision;
  const sourceId = string(body.sourceId);
  const sourceOrder = body.sourceOrder;
  const occurrenceOffsetMs = body.occurrenceOffsetMs;
  if (source === null || !nonnegativeSafeInteger(expectedRevision) || !sourceId || !nonnegativeSafeInteger(sourceOrder) || !nonnegativeSafeInteger(occurrenceOffsetMs)) return badRequest("A draft, expected revision, and stable event metadata are required.");
  const updated = await withTransaction(pool, async (client) => {
    const result = await client.query<AttemptRow>(
      `UPDATE attempts SET draft_source = $1, draft_revision = draft_revision + 1, updated_at = now(), status = CASE WHEN status = 'setup' THEN 'active' ELSE status END
        WHERE id = $2 AND user_id = $3 AND status <> 'completed' AND draft_revision = $4
        RETURNING *`,
      [source, attempt.id, attempt.user_id, expectedRevision],
    );
    const next = result.rows[0];
    if (!next) return null;
    await addEvent(client, { attemptId: attempt.id, eventType: "draft_saved", sourceId, sourceOrder, occurrenceOffsetMs, payload: { draftRevision: next.draft_revision } });
    return next;
  });
  if (!updated) return json({ error: "The draft changed elsewhere. Reload before saving again." }, { status: 409 });
  return json({ draftRevision: updated.draft_revision, updatedAt: updated.updated_at });
}

async function runCode(pool: Pool, env: Env, attempt: AttemptRow, body: Record<string, unknown>): Promise<Response> {
  const sourceId = string(body.sourceId);
  const sourceOrder = body.sourceOrder;
  const occurrenceOffsetMs = body.occurrenceOffsetMs;
  if (!sourceId || !nonnegativeSafeInteger(sourceOrder) || !nonnegativeSafeInteger(occurrenceOffsetMs)) return badRequest("Stable run event metadata is required.");
  if (!env.PYTHON_RUNNER) return serverUnavailable("The isolated Python runner is not configured. Your draft remains available and this is not a code result.");
  const checkpoint = await withTransaction(pool, (client) => createCheckpoint(client, attempt, "run", sourceId, sourceOrder, occurrenceOffsetMs));
  const content = await pool.query<{ id: string; entry_point: string; test_contract: unknown; input_data: unknown; expected_output: unknown }>(
    `SELECT p.entry_point, p.test_contract, tc.id, tc.input_data, tc.expected_output
       FROM problems p JOIN test_cases tc ON tc.problem_id = p.id
      WHERE p.id = $1 AND tc.visibility = 'visible'`,
    [attempt.problem_id],
  );
  let response: Response;
  try {
    response = await env.PYTHON_RUNNER.fetch(new Request("https://python-runner/run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ attemptId: attempt.id, checkpointId: checkpoint.checkpointId, sourceCode: attempt.draft_source, entryPoint: content.rows[0]?.entry_point, testContract: content.rows[0]?.test_contract, tests: content.rows.map(({ id: testId, input_data: inputData, expected_output: expectedOutput }) => ({ testId, inputData, expectedOutput })) }),
      signal: AbortSignal.timeout(95_000),
    }));
  } catch {
    return serverUnavailable("The isolated Python runner could not be reached. Your saved checkpoint is intact and this is not a code result.");
  }
  if (!response.ok) return serverUnavailable("The isolated Python runner reported an infrastructure failure. Your saved checkpoint is intact and this is not a code result.");
  let result: RunnerResult | null;
  try {
    const bounded = await boundedRequest(new Request("https://python-runner/result", { method: "POST", body: response.body }));
    if (bounded instanceof Response) return serverUnavailable("The runner result exceeded the response limit.");
    result = parseRunnerResult(await bounded.json(), new Set(content.rows.map((item) => item.id)));
  } catch {
    return serverUnavailable("The isolated Python runner returned an invalid result. No test verdict was recorded.");
  }
  if (!result) return serverUnavailable("The isolated Python runner returned an invalid result. No test verdict was recorded.");
  const passed = result.testResults.filter((test) => test.outcome === "passed").length;
  const failed = result.testResults.filter((test) => test.outcome === "failed").length;
  const run = await withTransaction(pool, async (client) => {
    const runEventId = await addEvent(client, { attemptId: attempt.id, eventType: "code_run", sourceId: `${sourceId}:result`, sourceOrder, occurrenceOffsetMs, payload: { checkpointId: checkpoint.checkpointId, runnerVersion: result.runnerVersion, harnessVersion: result.harnessVersion } });
    const existing = await client.query<{ id: string }>("SELECT id FROM code_runs WHERE event_id = $1", [runEventId]);
    if (existing.rows[0]) return existing.rows[0].id;
    const runId = id();
    await client.query(
      `INSERT INTO code_runs (id, attempt_id, checkpoint_id, event_id, status, tests_passed, tests_failed, stdout, stderr, execution_time_ms, runner_error, test_results, run_kind, runner_version, harness_version)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, 'visible', $13, $14)`,
      [runId, attempt.id, checkpoint.checkpointId, runEventId, result.status, passed, failed, result.stdout, result.stderr, result.executionTimeMs ?? null, result.runnerError ?? null, JSON.stringify(result.testResults), result.runnerVersion, result.harnessVersion],
    );
    return runId;
  });
  return json({ runId: run, checkpointId: checkpoint.checkpointId, status: result.status, testsPassed: passed, testsFailed: failed, testResults: result.testResults });
}

async function finishAttempt(pool: Pool, env: Env, attempt: AttemptRow, body: Record<string, unknown>): Promise<Response> {
  const sourceId = string(body.sourceId);
  const sourceOrder = body.sourceOrder;
  const occurrenceOffsetMs = body.occurrenceOffsetMs;
  if (!sourceId || !nonnegativeSafeInteger(sourceOrder) || !nonnegativeSafeInteger(occurrenceOffsetMs)) return badRequest("Stable finish event metadata is required.");
  const finished = await withTransaction(pool, async (client) => {
    const current = await client.query<AttemptRow>("SELECT * FROM attempts WHERE id = $1 AND user_id = $2 FOR UPDATE", [attempt.id, attempt.user_id]);
    const locked = current.rows[0];
    if (!locked) return null;
    if (locked.status === "completed") {
      const review = await client.query<{ id: string }>("SELECT id FROM reviews WHERE attempt_id = $1", [locked.id]);
      return review.rows[0] ? { reviewId: review.rows[0].id, completed: true } : null;
    }
    const checkpoint = await createCheckpoint(client, locked, "submission", sourceId, sourceOrder, occurrenceOffsetMs);
    await client.query("UPDATE attempts SET status = 'completed', completed_at = now(), updated_at = now() WHERE id = $1", [locked.id]);
    const reviewId = id();
    const manifest = { attemptId: locked.id, finalCheckpointId: checkpoint.checkpointId, frozenAt: new Date().toISOString() };
    await client.query("INSERT INTO reviews (id, attempt_id, status, evidence_manifest) VALUES ($1, $2, 'pending', $3::jsonb)", [reviewId, locked.id, JSON.stringify(manifest)]);
    return { reviewId, completed: false };
  });
  if (!finished) return notFound();
  const claim = await pool.query("UPDATE reviews SET dispatch_claimed_at = now() WHERE id = $1 AND status = 'pending' AND (dispatch_claimed_at IS NULL OR dispatch_claimed_at < now() - interval '60 seconds') RETURNING id", [finished.reviewId]);
  const dispatch = claim.rows.length ? "queued" : "already dispatched";
  if (claim.rows.length) {
    try { await env.REVIEW_QUEUE.send({ reviewId: finished.reviewId }); }
    catch { await pool.query("UPDATE reviews SET dispatch_claimed_at = NULL WHERE id = $1 AND status = 'pending'", [finished.reviewId]); return serverUnavailable("Review dispatch failed. Retry finishing this attempt."); }
  }
  return json({ reviewId: finished.reviewId, dispatch, recoveryDispatch: finished.completed });
}

async function retryFromCheckpoint(pool: Pool, userId: string, body: Record<string, unknown>): Promise<Response> {
  const checkpointId = string(body.checkpointId);
  const practiceGoal = string(body.practiceGoal);
  if (!checkpointId || !practiceGoal) return badRequest("A supported checkpoint and practice goal are required.");
  const source = await pool.query<AttemptRow & { checkpoint_code: string; occurrence_offset_ms: number }>(
    `SELECT a.*, c.source_code AS checkpoint_code, e.occurrence_offset_ms
       FROM code_checkpoints c
       JOIN attempts a ON a.id = c.attempt_id
       JOIN attempt_events e ON e.id = c.event_id
      WHERE c.id = $1 AND a.user_id = $2 AND a.source_attempt_id IS NULL AND c.checkpoint_type IN ('run', 'submission')`,
    [checkpointId, userId],
  );
  const original = source.rows[0];
  if (!original) return forbidden();
  const attemptId = id();
  await withTransaction(pool, async (client) => {
    await client.query(
      `INSERT INTO attempts (id, user_id, problem_id, mode, input_mode, status, source_attempt_id, source_checkpoint_id, draft_source, setup_context, familiarity, consent_at, disclosure_version, practice_goal, save_audio)
       VALUES ($1, $2, $3, 'coach', 'text', 'active', $4, $5, $6, $7::jsonb, 'unanswered', now(), $8, $9, false)`,
      [attemptId, userId, original.problem_id, original.id, checkpointId, original.checkpoint_code, JSON.stringify({ sourceCheckpointId: checkpointId, sourceAttemptId: original.id, throughOffsetMs: original.occurrence_offset_ms }), DISCLOSURE_VERSION, practiceGoal],
    );
    await addEvent(client, { attemptId, eventType: "retry_started", sourceId: `server:retry:${attemptId}`, sourceOrder: 0, occurrenceOffsetMs: 0, payload: { sourceAttemptId: original.id, sourceCheckpointId: checkpointId } });
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

export async function handleApi(request: Request, env: Env, _ctx: ExecutionContext, pool: Pool): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;
  const page = Number(url.searchParams.get("page") ?? 0);
  if (!Number.isSafeInteger(page) || page < 0 || !Number.isSafeInteger(page * limits.pageSize)) return badRequest("Invalid page.");
  if (path === "/api/health" && request.method === "GET") return json({ status: "ok" });
  if (path === "/api/personal-availability" && request.method === "GET") return json({
    collectionEnabled: personalCollectionEnabled(env),
    voiceEnabled: deepgramVoiceEnabled(env),
    voiceProvider: DEEPGRAM_VOICE_PROVIDER,
    thinkingModel: DEEPGRAM_THINKING_MODEL,
  });
  if (!personalCollectionEnabled(env)) return serverUnavailable(personalCollectionUnavailable);
  const originError = checkOrigin(request, env.BETTER_AUTH_URL);
  if (originError) return originError;
  if (path === "/api/catalog" && request.method === "GET") return catalog(pool);
  const userId = await authenticatedUserId(request, env, pool);
  if (!userId) return unauthorized();
  if (!(await consumeRate(pool, `api:${userId}`, 60, 120)).allowed) return json({ error: "Too many requests." }, { status: 429 });
  if (path === "/api/me" && request.method === "GET") return json({ userId });
  if (path === "/api/attempts" && request.method === "GET") return listAttempts(pool, userId, page);
  if (path === "/api/attempts" && request.method === "POST") {
    const body = await requestBody(request);
    return body ? createAttempt(pool, userId, body) : badRequest("Expected a JSON request body.");
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
    return body ? appendCandidateMessage(pool, attempt, body) : badRequest("Expected a JSON request body.");
  }
  if (action === "voice" && request.method === "GET") {
    if (request.headers.get("origin") !== new URL(env.BETTER_AUTH_URL).origin) return forbidden();
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
    return body ? retryFromCheckpoint(pool, userId, body) : badRequest("Expected a JSON request body.");
  }
  if (action === "review" && request.method === "GET") return reviewDetail(pool, attempt);
  if (action === "related" && request.method === "GET") return relatedProblems(pool, userId, attempt);
  if (action === "review" && attemptMatch[3] && request.method === "POST") {
    const body = await requestBody(request);
    return body ? correctFinding(pool, userId, attempt, decodeURIComponent(attemptMatch[3]), body) : badRequest("Expected a JSON request body.");
  }
  return notFound();
}

export async function processReview(reviewId: string, env: Env, pool: Pool): Promise<void> {
  if (!env.REVIEW_PROVIDER_API_KEY || !env.REVIEW_PROVIDER_MODEL) {
    await pool.query("UPDATE reviews SET status = 'failed', failure_reason = $1, updated_at = now() WHERE id = $2 AND status = 'pending'", ["Review provider is not configured; no findings were generated.", reviewId]);
    return;
  }
  // A configured model must be proven to support the recorded-evidence contract
  // before this worker publishes findings. Never create prepared fallback feedback.
  await pool.query("UPDATE reviews SET status = 'failed', failure_reason = $1, updated_at = now() WHERE id = $2 AND status = 'pending'", ["The configured review transport has not passed evidence-reference validation; no findings were published.", reviewId]);
}
