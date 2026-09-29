import type { PoolClient } from "pg";
import type { AttemptRow } from "./api";
import { nonnegativeSafeInteger } from "./http";
import { limits } from "./security";

// The stable identity of an Event, sent by its writer. Unchecked: record() checks it.
export type EventEnvelope = { sourceId?: unknown; sourceOrder?: unknown; occurrenceOffsetMs?: unknown };

// The child row of an Event. The "interviewer" speaker becomes interviewer or
// coach from the Attempt Mode, so no caller picks it.
export type EventDetail =
  | { transcript: { speaker: "candidate" | "interviewer"; text: string } }
  | { helpRequest: { category: "clarification" | "hint" | "explanation" } };

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
  const table = "transcript" in detail ? "transcript_segments" : "assistance_events";
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
    } else {
      await client.query(
        "INSERT INTO assistance_events (id, attempt_id, event_id, category, offered, accepted, delivered, content) VALUES ($1, $2, $3, $4, true, true, false, '')",
        [detailId, attempt.id, eventId, detail.helpRequest.category],
      );
    }
    return { status: "recorded", eventId, detailId };
  }

  return { status: "open", timeline: { attempt, record } };
}
