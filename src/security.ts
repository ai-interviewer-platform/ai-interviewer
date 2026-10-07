import type { Pool } from "pg";

// Owner authorized conservative production defaults on 2026-09-16.
export const limits = {
  requestBytes: 256 * 1024,
  textBytes: 64 * 1024,
  pageSize: 50,
  voiceSeconds: 15 * 60,
  accountVoiceSeconds: 60 * 60,
  projectVoiceSeconds: 600 * 60,
  eventsPerAttempt: 10000,
  voiceCommands: 1200,
  pendingTranscripts: 50,
  voiceFunctionCalls: 30,
  // The Coding context of both Input modes (#51): the Draft, then the whole context.
  codingContextDraftBytes: 10 * 1024,
  codingContextBytes: 16 * 1024,
  modelTurnsPerAttempt: 40,
  accountModelTurnsPerHour: 60,
  accountReviewsPerDay: 20,
  // Owner-delegated defaults of 2026-09-30 for first-party measurement (#23).
  measurementEventBytes: 4 * 1024,
  measurementEventsPerMinute: 1200,
  // Owner-delegated default of 2026-09-30 for contextual feedback (#21).
  feedbackPerMinute: 60,
  feedbackBytes: 8 * 1024,
  // Owner-delegated defaults of 2026-09-30 for bug reports (#22).
  bugReportsPerMinute: 30,
  bugReportsBytes: 32 * 1024,
  // The waitlist limit accepted in #49 for the shared Site collection gate (#50). The 4 KiB
  // body limit matches measurement events; a waitlist request is an email address and a version.
  waitlistPerMinute: 30,
  waitlistBytes: 4 * 1024,
};

// Every rate-limit prefix that is keyed by a user ID. Account deletion removes the
// row of each one, so a user-keyed limit must use a prefix from this list.
export const userRateLimitPrefixes = ["api", "account-delete", "model", "review"] as const;

// A key made only by the functions below, so no code can add a user-keyed prefix
// that account deletion does not know.
declare const rateLimitKeyBrand: unique symbol;
export type RateLimitKey = string & { readonly [rateLimitKeyBrand]: true };

export function userRateLimitKey(prefix: typeof userRateLimitPrefixes[number], userId: string): RateLimitKey {
  return `${prefix}:${userId}` as RateLimitKey;
}

export function userRateLimitKeys(userId: string): RateLimitKey[] {
  return userRateLimitPrefixes.map((prefix) => userRateLimitKey(prefix, userId));
}

// Project-wide limits for public collection. No IP address or other identifier is stored;
// the per-visitor limit is counted by Cloudflare (site-collection.ts).
export function siteRateLimitKey(name: "measure" | "feedback" | "bug-report" | "waitlist"): RateLimitKey {
  return `site:${name}` as RateLimitKey;
}

// better-auth keys its limits by IP address and path, not by a user ID.
export function authRateLimitKey(key: string): RateLimitKey {
  return `auth:${key}` as RateLimitKey;
}

export async function consumeRate(pool: Pool, key: RateLimitKey, window: number, max: number) {
  await pool.query("DELETE FROM security_rate_limits WHERE expires_at <= now()");
  return takeRate(pool, key, window, max);
}

// Takes one token without the expiry sweep, so a caller can spend it inside its
// own transaction: a rollback refunds the token, and no other key is locked.
export async function takeRate(db: Pick<Pool, "query">, key: RateLimitKey, window: number, max: number) {
  const result = await db.query<{ count: number }>(
    `INSERT INTO security_rate_limits (key, count, expires_at) VALUES ($1, 1, now() + $2 * interval '1 second')
     ON CONFLICT (key) DO UPDATE SET
       count = CASE WHEN security_rate_limits.expires_at <= now() THEN 1 ELSE security_rate_limits.count + 1 END,
       expires_at = CASE WHEN security_rate_limits.expires_at <= now() THEN EXCLUDED.expires_at ELSE security_rate_limits.expires_at END
     WHERE security_rate_limits.expires_at <= now() OR security_rate_limits.count < $3
     RETURNING count`, [key, window, max],
  );
  return { allowed: result.rows.length > 0, retryAfter: window };
}
