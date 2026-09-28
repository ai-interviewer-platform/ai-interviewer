import type { Pool } from "pg";
import { limits } from "./security";

type AttemptContextRow = { draft_source: string; draft_revision: number; status: string; input_mode: string };
type CheckpointRow = { id: string; checkpoint_type: string; created_at: string };
type RunRow = { id: string; checkpoint_id: string; status: string; tests_passed: number; tests_failed: number; test_results: unknown; created_at: string };
type AssistanceRow = { category: string; delivered: boolean; created_at: string };

function truncateUtf8(value: string, byteLimit: number): { value: string; truncated: boolean } {
  const encoded = new TextEncoder().encode(value);
  if (encoded.byteLength <= byteLimit) return { value, truncated: false };
  return { value: new TextDecoder().decode(encoded.subarray(0, byteLimit)), truncated: true };
}

function visibleOutcomes(value: unknown): Array<{ testId: string; outcome: string }> {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 16).flatMap(item => {
    if (typeof item !== "object" || item === null || Array.isArray(item)) return [];
    const candidate = item as Record<string, unknown>;
    if (typeof candidate.testId !== "string" || typeof candidate.outcome !== "string") return [];
    return [{ testId: candidate.testId.slice(0, 256), outcome: candidate.outcome }];
  });
}

export async function loadVoiceCodingContext(pool: Pool, attemptId: string, userId: string): Promise<string | null> {
  const attempt = (await pool.query<AttemptContextRow>(
    "SELECT draft_source, draft_revision, status, input_mode FROM attempts WHERE id = $1 AND user_id = $2",
    [attemptId, userId],
  )).rows[0];
  if (!attempt) return null;
  if (attempt.status === "completed" || attempt.input_mode !== "voice") {
    return JSON.stringify({ status: "unavailable", reason: "attempt_not_active" });
  }
  const [checkpointResult, runResult, assistanceResult] = await Promise.all([
    pool.query<CheckpointRow>(
      "SELECT id, checkpoint_type, created_at FROM code_checkpoints WHERE attempt_id = $1 ORDER BY created_at DESC, id DESC LIMIT 1",
      [attemptId],
    ),
    pool.query<RunRow>(
      "SELECT id, checkpoint_id, status, tests_passed, tests_failed, test_results, created_at FROM code_runs WHERE attempt_id = $1 AND run_kind = 'visible' ORDER BY created_at DESC, id DESC LIMIT 1",
      [attemptId],
    ),
    pool.query<AssistanceRow>(
      "SELECT category, delivered, created_at FROM assistance_events WHERE attempt_id = $1 ORDER BY created_at DESC, id DESC LIMIT 1",
      [attemptId],
    ),
  ]);
  const source = truncateUtf8(attempt.draft_source, limits.voiceContextSourceBytes);
  const checkpoint = checkpointResult.rows[0];
  const run = runResult.rows[0];
  const assistance = assistanceResult.rows[0];
  const payload = JSON.stringify({
    status: "available",
    savedDraft: { revision: attempt.draft_revision, source: source.value, truncated: source.truncated },
    latestCheckpoint: checkpoint ? { id: checkpoint.id, type: checkpoint.checkpoint_type, createdAt: checkpoint.created_at } : null,
    latestVisibleRun: run ? {
      id: run.id,
      checkpointId: run.checkpoint_id,
      status: run.status,
      testsPassed: run.tests_passed,
      testsFailed: run.tests_failed,
      outcomes: visibleOutcomes(run.test_results),
      createdAt: run.created_at,
    } : null,
    latestHelpRequest: assistance ? { category: assistance.category, delivered: assistance.delivered, createdAt: assistance.created_at } : null,
    limitations: "Saved server state only. Unsaved editor changes and hidden tests are unavailable.",
  });
  if (new TextEncoder().encode(payload).byteLength > limits.voiceContextBytes) throw new Error("Voice coding context exceeded its configured bound.");
  return payload;
}
