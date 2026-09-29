import type { Pool, PoolClient } from "pg";
import type { Env } from "./env";
import { isRecord } from "./http";
import { personalCollectionEnabled } from "./data-policy";
import { PermanentReviewError, reviewLimits, reviewProviderFor, reviewTransactionIdleTimeoutMs, TransientReviewError, validateFindings, type ReviewProvider } from "./review-provider";
import { logOperationalEvent } from "./observability";
import { limits, takeRate, userRateLimitKey } from "./security";

type Evidence = {
  id: string; type: string; occurrenceOffsetMs: number;
  transcript: { id: string; speaker: string; text: string } | null;
  checkpoint: { id: string; type: string; source: string } | null;
  run: { id: string; checkpointId: string; status: string; testResults: unknown } | null;
  assistance: { id: string; category: string; offered: boolean; accepted: boolean; delivered: boolean; content: string } | null;
};
type Review = { id: string; attempt_id: string; status: string; evidence_manifest: unknown };

async function loadEvidence(client: PoolClient, review: Review) {
  const manifest = review.evidence_manifest;
  if (!isRecord(manifest) || manifest.attemptId !== review.attempt_id || typeof manifest.finalCheckpointId !== "string" || typeof manifest.frozenAt !== "string" || !Number.isFinite(Date.parse(manifest.frozenAt))) {
    throw new PermanentReviewError("Review evidence manifest is invalid.");
  }
  const context = await client.query(
    `SELECT a.status, a.source_attempt_id,
            CASE WHEN octet_length(p.prompt) <= $2 THEN p.prompt END AS prompt,
            a.mode, a.input_mode
       FROM attempts a JOIN problems p ON p.id = a.problem_id WHERE a.id = $1`,
    [review.attempt_id, reviewLimits.evidenceBytes],
  );
  const attempt = context.rows[0];
  if (!attempt || attempt.status !== "completed") throw new PermanentReviewError("Review requires a completed attempt.");
  if (attempt.prompt === null) throw new PermanentReviewError("Review context exceeds the evidence limit.");
  // Completion triggers freeze these rows. Every join is scoped to this attempt;
  // retry ancestry is deliberately not followed. Never select raw event payloads,
  // account fields, hidden test definitions, or reference solutions.
  const result = await client.query<{ evidence: Evidence | null }>(
    `WITH selected AS (
       SELECT e.id, e.occurrence_offset_ms, e.source_id, e.source_order,
         jsonb_build_object('id', e.id, 'type', e.event_type, 'occurrenceOffsetMs', e.occurrence_offset_ms,
           'transcript', CASE WHEN t.id IS NOT NULL THEN jsonb_build_object('id', t.id, 'speaker', t.speaker, 'text', t.text) END,
           'checkpoint', CASE WHEN c.id IS NOT NULL THEN jsonb_build_object('id', c.id, 'type', c.checkpoint_type, 'source', c.source_code) END,
           'run', CASE WHEN r.id IS NOT NULL THEN jsonb_build_object('id', r.id, 'checkpointId', r.checkpoint_id, 'status', r.status,
             'testsPassed', r.tests_passed, 'testsFailed', r.tests_failed, 'testResults', r.test_results,
             'stdout', r.stdout, 'stderr', r.stderr, 'executionTimeMs', r.execution_time_ms) END,
           'assistance', CASE WHEN h.id IS NOT NULL THEN jsonb_build_object('id', h.id, 'category', h.category,
             'offered', h.offered, 'accepted', h.accepted, 'delivered', h.delivered, 'content', h.content) END) AS evidence
       FROM attempt_events e
       LEFT JOIN transcript_segments t ON t.event_id = e.id AND t.attempt_id = e.attempt_id
       LEFT JOIN code_checkpoints c ON c.event_id = e.id AND c.attempt_id = e.attempt_id
       LEFT JOIN code_runs r ON r.event_id = e.id AND r.attempt_id = e.attempt_id AND r.run_kind = 'visible'
       LEFT JOIN assistance_events h ON h.event_id = e.id AND h.attempt_id = e.attempt_id
       WHERE e.attempt_id = $1
         AND (e.event_type NOT IN ('candidate_voice', 'interviewer_voice') OR e.payload->'verified' = 'true'::jsonb)
         AND (t.id IS NULL OR e.event_type = 'candidate_text' OR (e.event_type IN ('candidate_voice', 'interviewer_voice') AND e.payload->'verified' = 'true'::jsonb))
         AND (e.event_type <> 'code_run' OR r.id IS NOT NULL)
       ORDER BY e.occurrence_offset_ms, e.source_id, e.source_order, e.id LIMIT $2
     ) SELECT CASE WHEN sum(octet_length(evidence::text)) OVER () <= $3 THEN evidence END AS evidence
         FROM selected ORDER BY occurrence_offset_ms, source_id, source_order, id`,
    [review.attempt_id, reviewLimits.events + 1, reviewLimits.evidenceBytes],
  );
  if (result.rows.length > reviewLimits.events || result.rows.some(row => row.evidence === null)) throw new PermanentReviewError("Frozen evidence exceeds review processing limits; no evidence was silently truncated.");
  const evidence = result.rows.map(row => row.evidence!);
  const byId = new Map(evidence.map(item => [item.id, item]));
  const final = evidence.find(item => item.checkpoint?.id === manifest.finalCheckpointId && item.checkpoint?.type === "submission");
  if (!final || byId.size !== evidence.length || evidence.some(item => item.run && !evidence.some(other => other.checkpoint?.id === item.run!.checkpointId))) {
    throw new PermanentReviewError("Frozen evidence is missing its submission or linked checkpoint.");
  }
  const payload = JSON.stringify({ attempt: { mode: attempt.mode, inputMode: attempt.input_mode, problemPrompt: attempt.prompt, finalCheckpointId: manifest.finalCheckpointId }, allowedEvidenceIds: [...byId.keys()], evidence });
  if (new TextEncoder().encode(payload).byteLength > reviewLimits.evidenceBytes) throw new PermanentReviewError("Frozen evidence exceeds review processing limits; no evidence was silently truncated.");
  return { payload, byId, canRetry: attempt.source_attempt_id === null };
}

export async function processReview(reviewId: string, env: Env, pool: Pool, configuredProvider?: ReviewProvider): Promise<void> {
  // Queue invocations must honor the same collection gate as API invocations.
  if (!personalCollectionEnabled(env)) throw new TransientReviewError("Personal collection is disabled.");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL lock_timeout = '2s'");
    await client.query("SET LOCAL statement_timeout = '10s'");
    await client.query(`SET LOCAL idle_in_transaction_session_timeout = '${reviewTransactionIdleTimeoutMs}ms'`);
    const review = (await client.query<Review>("SELECT id, attempt_id, status, evidence_manifest FROM reviews WHERE id = $1 FOR UPDATE", [reviewId])).rows[0];
    if (!review || review.status !== "pending") { await client.query("COMMIT"); return; }
    // Keep the row lock through the bounded request and publication. Concurrent
    // delivery waits or retries; a crash rolls back and releases the lock.
    try {
      // Each review is a paid model call; cap them per account per day. The token
      // is spent on this transaction, so a transient failure and queue retry refund it.
      const owner = (await client.query<{ user_id: string }>("SELECT user_id FROM attempts WHERE id = $1", [review.attempt_id])).rows[0];
      if (owner && !(await takeRate(client, userRateLimitKey("review", owner.user_id), 24 * 60 * 60, limits.accountReviewsPerDay)).allowed) {
        throw new PermanentReviewError("The daily review limit for this account was reached; no findings were generated.");
      }
      const provider = configuredProvider ?? reviewProviderFor(env);
      const { payload, byId, canRetry } = await loadEvidence(client, review);
      await client.query("UPDATE reviews SET started_at = now(), evaluator_version = $2, updated_at = now() WHERE id = $1", [reviewId, provider.evaluatorVersion]);
      const allowedEvidenceIds = new Set(byId.keys());
      // Provider adapters normalize transport envelopes only. The Finding checks run
      // here, once, on the output of every adapter immediately before writes.
      const findings = validateFindings(await provider.generate({ payload, allowedEvidenceIds }), allowedEvidenceIds);
      for (const finding of findings) {
        const findingId = crypto.randomUUID();
        const cited = finding.evidenceIds.map(id => byId.get(id)!);
        const checkpoint = canRetry && finding.suggested_action && finding.evidence_status !== "insufficient_evidence"
          ? cited.find(item => item.checkpoint && ["run", "submission"].includes(item.checkpoint.type))?.checkpoint?.id ?? null : null;
        await client.query(
          `INSERT INTO review_findings (id, review_id, observation, interpretation, limitations, suggested_action, criterion, evidence_status, retry_checkpoint_id, practice_goal, assistance_context)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb)`,
          [findingId, reviewId, finding.observation, finding.interpretation, finding.limitations, finding.suggested_action, finding.criterion, finding.evidence_status, checkpoint, checkpoint ? finding.suggested_action : null,
            JSON.stringify({ events: cited.filter(item => item.assistance).map(item => ({ eventId: item.id, ...item.assistance })) })],
        );
        for (const item of cited) {
          const locator = { occurrenceOffsetMs: item.occurrenceOffsetMs, ...(item.transcript ? { transcriptId: item.transcript.id } : {}), ...(item.checkpoint ? { checkpointId: item.checkpoint.id } : {}), ...(item.run ? { runId: item.run.id, checkpointId: item.run.checkpointId } : {}), ...(item.assistance ? { assistanceId: item.assistance.id } : {}) };
          await client.query("INSERT INTO finding_evidence (id, finding_id, event_id, locator) VALUES ($1,$2,$3,$4::jsonb)", [crypto.randomUUID(), findingId, item.id, JSON.stringify(locator)]);
        }
      }
      await client.query("UPDATE reviews SET status = 'ready', failure_reason = NULL, completed_at = now(), updated_at = now() WHERE id = $1", [reviewId]);
    } catch (error) {
      if (!(error instanceof PermanentReviewError)) throw error;
      logOperationalEvent("warn", "review_permanent_failure");
      await client.query("UPDATE reviews SET status = 'failed', failure_reason = $2, completed_at = now(), updated_at = now() WHERE id = $1", [reviewId, error.message]);
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}
