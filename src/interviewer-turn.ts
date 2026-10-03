import type { Pool } from "pg";
import { limits } from "./security";

type AttemptContextRow = { draft_source: string; draft_revision: number; status: string };
type CheckpointRow = { id: string; checkpoint_type: string; created_at: string };
type RunRow = { id: string; checkpoint_id: string; status: string; tests_passed: number; tests_failed: number; test_results: unknown; stderr: string; runner_error: string | null; created_at: string };
type HelpRequestRow = { category: string; delivered: boolean; created_at: string };

const jsonBytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).byteLength;

// The longest prefix of a string whose JSON form fits in `budget` bytes, so escaping
// cannot push the Coding context over its limits.
function clipJson(value: string, budget: number): { value: string; truncated: boolean } {
  if (jsonBytes(value) <= budget) return { value, truncated: false };
  let low = 0;
  let high = value.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (jsonBytes(value.slice(0, middle)) <= budget) low = middle;
    else high = middle - 1;
  }
  // Never end on the first half of a surrogate pair.
  if (/[\uD800-\uDBFF]/.test(value.charAt(low - 1))) low--;
  return { value: value.slice(0, low), truncated: true };
}

function visibleOutcomes(value: unknown): Array<{ testId: string; outcome: string }> {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 16).flatMap(item => {
    if (typeof item !== "object" || item === null || Array.isArray(item)) return [];
    const candidate = item as Record<string, unknown>;
    if (typeof candidate.testId !== "string" || typeof candidate.outcome !== "string") return [];
    return [{ testId: clipJson(candidate.testId, 256).value, outcome: clipJson(candidate.outcome, 32).value }];
  });
}

// The Coding context of an Attempt, as JSON for both Interviewer adapters: only saved
// state and the latest visible Run (ADR 0001). Null when the user does not own the Attempt.
export async function loadCodingContext(pool: Pool, attemptId: string, userId: string): Promise<string | null> {
  const attempt = (await pool.query<AttemptContextRow>(
    "SELECT draft_source, draft_revision, status FROM attempts WHERE id = $1 AND user_id = $2",
    [attemptId, userId],
  )).rows[0];
  if (!attempt) return null;
  if (attempt.status === "completed") {
    return JSON.stringify({ status: "unavailable", reason: "attempt_not_active" });
  }
  const [checkpointResult, runResult, helpRequestResult] = await Promise.all([
    pool.query<CheckpointRow>(
      "SELECT id, checkpoint_type, created_at FROM code_checkpoints WHERE attempt_id = $1 ORDER BY created_at DESC, id DESC LIMIT 1",
      [attemptId],
    ),
    pool.query<RunRow>(
      "SELECT id, checkpoint_id, status, tests_passed, tests_failed, test_results, stderr, runner_error, created_at FROM code_runs WHERE attempt_id = $1 AND run_kind = 'visible' ORDER BY created_at DESC, id DESC LIMIT 1",
      [attemptId],
    ),
    pool.query<HelpRequestRow>(
      "SELECT category, delivered, created_at FROM assistance_events WHERE attempt_id = $1 ORDER BY created_at DESC, id DESC LIMIT 1",
      [attemptId],
    ),
  ]);
  const source = clipJson(attempt.draft_source, limits.codingContextDraftBytes);
  const checkpoint = checkpointResult.rows[0];
  const run = runResult.rows[0];
  const helpRequest = helpRequestResult.rows[0];
  const context = {
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
      errorOutput: "",
      errorOutputTruncated: false,
      createdAt: run.created_at,
    } : null,
    latestHelpRequest: helpRequest ? { category: helpRequest.category, delivered: helpRequest.delivered, createdAt: helpRequest.created_at } : null,
    limitations: "Saved server state only. Unsaved editor changes and hidden tests are unavailable.",
  };
  // The error output takes the space that is left of the whole budget. The other fields
  // are bounded (16 outcomes of at most 288 bytes, a 10 KiB Draft), so it always fits.
  if (run && context.latestVisibleRun) {
    const budget = limits.codingContextBytes - jsonBytes(context) + jsonBytes("") + jsonBytes(false) - jsonBytes(true);
    const errorOutput = clipJson([run.runner_error, run.stderr].filter(Boolean).join("\n"), budget);
    context.latestVisibleRun.errorOutput = errorOutput.value;
    context.latestVisibleRun.errorOutputTruncated = errorOutput.truncated;
  }
  const payload = JSON.stringify(context);
  if (new TextEncoder().encode(payload).byteLength > limits.codingContextBytes) throw new Error("The Coding context exceeded its configured bound.");
  return payload;
}
