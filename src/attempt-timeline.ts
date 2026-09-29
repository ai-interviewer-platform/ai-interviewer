import type { Pool, PoolClient } from "pg";
import type { AttemptRow } from "./api";
import type { RunnerResult } from "./runner";
import { nonnegativeSafeInteger } from "./http";
import { limits } from "./security";
import { withTransaction } from "./transaction";

// The stable identity of an Event, sent by its writer. Unchecked: record() checks it.
export type EventEnvelope = { sourceId?: unknown; sourceOrder?: unknown; occurrenceOffsetMs?: unknown };

// The child row of an Event. The "interviewer" speaker becomes interviewer or
// coach from the Attempt Mode, so no caller picks it.
export type EventDetail =
  | { transcript: { speaker: "candidate" | "interviewer"; text: string } }
  | { helpRequest: { category: "clarification" | "hint" | "explanation" } }
  // A Checkpoint freezes the Draft of the locked Attempt.
  | { checkpoint: { type: "run" | "save" | "submission" | "retry_source" } }
  | { run: { checkpointId: string; result: RunnerResult } };

const detailTables = { transcript: "transcript_segments", helpRequest: "assistance_events", checkpoint: "code_checkpoints", run: "code_runs" } as const;

export type RecordResult =
  | { status: "recorded"; eventId: string; detailId: string | null }
  | { status: "limit reached" }
  | { status: "invalid" };

// What a write to the timeline gives its route: a record result, or `closed` from opening.
export type TimelineResult = RecordResult | { status: "closed" };

export interface AttemptTimeline {
  // The Attempt row, locked for the rest of the caller's transaction.
  readonly attempt: AttemptRow;
  record(eventType: string, envelope: EventEnvelope, payload: unknown, detail?: EventDetail): Promise<RecordResult>;
}

async function existingDetail(client: PoolClient, eventId: string, detail: EventDetail | undefined): Promise<string | null> {
  if (!detail) return null;
  const table = detailTables[Object.keys(detail)[0] as keyof typeof detailTables];
  const result = await client.query<{ id: string }>(`SELECT id FROM ${table} WHERE event_id = $1`, [eventId]);
  return result.rows[0]?.id ?? null;
}

// Every Event append goes through here. Opening locks the Attempt once inside the
// caller's transaction; the caller owns the transaction and any non-Event writes.
export async function openTimeline(client: PoolClient, attemptId: string): Promise<{ status: "closed" } | { status: "open"; timeline: AttemptTimeline }> {
  const locked = await client.query<AttemptRow>("SELECT * FROM attempts WHERE id = $1 FOR UPDATE", [attemptId]);
  const attempt = locked.rows[0];
  if (!attempt || attempt.status === "completed") return { status: "closed" };

  async function record(eventType: string, envelope: EventEnvelope, payload: unknown, detail?: EventDetail): Promise<RecordResult> {
    const { sourceId, sourceOrder, occurrenceOffsetMs } = envelope;
    if (typeof sourceId !== "string" || !sourceId || !nonnegativeSafeInteger(sourceOrder) || !nonnegativeSafeInteger(occurrenceOffsetMs)) return { status: "invalid" };
    if (detail && "transcript" in detail && !detail.transcript.text.trim()) return { status: "invalid" };

    // The Attempt lock serializes writers, so a repeated sourceId finds the first Event.
    const existing = await client.query<{ id: string }>("SELECT id FROM attempt_events WHERE attempt_id = $1 AND source_id = $2", [attempt.id, sourceId]);
    if (existing.rows[0]) return { status: "recorded", eventId: existing.rows[0].id, detailId: await existingDetail(client, existing.rows[0].id, detail) };
    const count = await client.query<{ count: string }>("SELECT count(*) FROM attempt_events WHERE attempt_id = $1", [attempt.id]);
    if (Number(count.rows[0].count) >= limits.eventsPerAttempt) return { status: "limit reached" };

    const eventId = crypto.randomUUID();
    await client.query(
      `INSERT INTO attempt_events (id, attempt_id, event_type, source_id, source_order, occurrence_offset_ms, payload)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
      [eventId, attempt.id, eventType, sourceId, sourceOrder, occurrenceOffsetMs, JSON.stringify(payload)],
    );
    if (!detail) return { status: "recorded", eventId, detailId: null };
    const detailId = crypto.randomUUID();
    if ("transcript" in detail) {
      const speaker = detail.transcript.speaker === "candidate" ? "candidate" : attempt.mode === "coach" ? "coach" : "interviewer";
      await client.query(
        "INSERT INTO transcript_segments (id, attempt_id, event_id, speaker, text, end_offset_ms) VALUES ($1, $2, $3, $4, $5, $6)",
        [detailId, attempt.id, eventId, speaker, detail.transcript.text.trim(), occurrenceOffsetMs],
      );
    } else if ("helpRequest" in detail) {
      await client.query(
        "INSERT INTO assistance_events (id, attempt_id, event_id, category, offered, accepted, delivered, content) VALUES ($1, $2, $3, $4, true, true, false, '')",
        [detailId, attempt.id, eventId, detail.helpRequest.category],
      );
    } else if ("checkpoint" in detail) {
      await client.query(
        "INSERT INTO code_checkpoints (id, attempt_id, event_id, source_code, checkpoint_type) VALUES ($1, $2, $3, $4, $5)",
        [detailId, attempt.id, eventId, attempt.draft_source, detail.checkpoint.type],
      );
    } else {
      const { checkpointId, result } = detail.run;
      await client.query(
        `INSERT INTO code_runs (id, attempt_id, checkpoint_id, event_id, status, tests_passed, tests_failed, stdout, stderr, execution_time_ms, runner_error, test_results, run_kind, runner_version, harness_version)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, 'visible', $13, $14)`,
        [detailId, attempt.id, checkpointId, eventId, result.status, result.testResults.filter((test) => test.outcome === "passed").length, result.testResults.filter((test) => test.outcome === "failed").length,
          result.stdout, result.stderr, result.executionTimeMs ?? null, result.runnerError ?? null, JSON.stringify(result.testResults), result.runnerVersion, result.harnessVersion],
      );
    }
    return { status: "recorded", eventId, detailId };
  }

  return { status: "open", timeline: { attempt, record } };
}

// Opens the Attempt timeline in a new transaction; a thrown error rolls back every write.
export async function withTimeline<T>(pool: Pool, attemptId: string, write: (timeline: AttemptTimeline, client: PoolClient) => Promise<T>): Promise<T | { status: "closed" }> {
  return withTransaction(pool, async (client) => {
    const opened = await openTimeline(client, attemptId);
    return opened.status === "closed" ? opened : write(opened.timeline, client);
  });
}
