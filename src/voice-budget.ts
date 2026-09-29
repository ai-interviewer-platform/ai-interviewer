// The Voice reservation budget: voice seconds held for voice connections, within the
// account limit, the project limit, and one active voice connection for each user.
import type { Pool, PoolClient } from "pg";
import type { AttemptRow } from "./api";
import { limits } from "./security";
import { withTransaction } from "./transaction";

export type VoiceReservation = { id: string; expiresAt: Date };

// Reservations count for the UTC day they start in, and while they are active.
async function usage(client: PoolClient, userId: string) {
  // ponytail: project budget serializes reservations; shard only when contention requires it.
  await client.query("SELECT pg_advisory_xact_lock(hashtext('voice-project-budget'))");
  await client.query("DELETE FROM voice_reservations WHERE expires_at <= now() AND started_at < date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'");
  const result = await client.query<{ account_seconds: number; project_seconds: number; active: boolean }>(
    `SELECT COALESCE(sum(reserved_seconds) FILTER (WHERE user_id = $1), 0)::int AS account_seconds,
       COALESCE(sum(reserved_seconds), 0)::int AS project_seconds,
       COALESCE(bool_or(user_id = $1 AND expires_at > now()), false) AS active
      FROM voice_reservations WHERE started_at >= date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'
        OR expires_at > now()`, [userId]);
  return result.rows[0];
}

const withinLimits = (budget: { account_seconds: number; project_seconds: number }, seconds: number) =>
  budget.account_seconds + seconds <= limits.accountVoiceSeconds && budget.project_seconds + seconds <= limits.projectVoiceSeconds;

// Reserves one voice connection of limits.voiceSeconds for an open voice Attempt of the user.
export async function reserveVoice(pool: Pool, attemptId: string | null, userId: string | null): Promise<
  | { status: "reserved"; reservation: VoiceReservation; attempt: AttemptRow }
  | { status: "attempt unavailable" }
  | { status: "exhausted" }
> {
  return withTransaction(pool, async (client) => {
    const owned = await client.query<AttemptRow>("SELECT * FROM attempts WHERE id = $1 AND user_id = $2 AND input_mode = 'voice' AND status <> 'completed' FOR UPDATE", [attemptId, userId]);
    const attempt = owned.rows[0];
    if (!attempt) return { status: "attempt unavailable" } as const;
    const budget = await usage(client, attempt.user_id);
    if (budget.active || !withinLimits(budget, limits.voiceSeconds)) return { status: "exhausted" } as const;
    const inserted = await client.query<{ id: string; expires_at: Date }>(
      "INSERT INTO voice_reservations (id, user_id, attempt_id, expires_at, reserved_seconds) VALUES ($1, $2, $3, now() + $4 * interval '1 second', $4) RETURNING id, expires_at",
      [crypto.randomUUID(), attempt.user_id, attempt.id, limits.voiceSeconds],
    );
    return { status: "reserved", reservation: { id: inserted.rows[0].id, expiresAt: new Date(inserted.rows[0].expires_at) }, attempt } as const;
  });
}

// Adds seconds to an active reservation when the account and project limits allow them.
export async function extendVoice(pool: Pool, reservationId: string, seconds: number): Promise<{ status: "extended"; expiresAt: Date } | { status: "ended" } | { status: "exhausted" }> {
  return withTransaction(pool, async (client) => {
    const active = await client.query<{ user_id: string }>("SELECT user_id FROM voice_reservations WHERE id = $1 AND expires_at > now()", [reservationId]);
    if (!active.rows[0]) return { status: "ended" } as const;
    if (!withinLimits(await usage(client, active.rows[0].user_id), seconds)) return { status: "exhausted" } as const;
    const updated = await client.query<{ expires_at: Date }>(
      "UPDATE voice_reservations SET expires_at = expires_at + $2 * interval '1 second', reserved_seconds = reserved_seconds + $2 WHERE id = $1 AND expires_at > now() RETURNING expires_at",
      [reservationId, seconds],
    );
    return updated.rows[0] ? { status: "extended", expiresAt: new Date(updated.rows[0].expires_at) } as const : { status: "ended" } as const;
  });
}

// Ends the connection. The reserved seconds still count toward the day.
export async function releaseVoice(pool: Pool, reservationId: string): Promise<void> {
  await pool.query("UPDATE voice_reservations SET expires_at = now() WHERE id = $1 AND expires_at > now()", [reservationId]);
}
