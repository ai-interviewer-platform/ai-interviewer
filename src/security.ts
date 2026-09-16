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
};

export async function consumeRate(pool: Pool, key: string, window: number, max: number) {
  await pool.query("DELETE FROM security_rate_limits WHERE expires_at <= now()");
  const result = await pool.query<{ count: number }>(
    `INSERT INTO security_rate_limits (key, count, expires_at) VALUES ($1, 1, now() + $2 * interval '1 second')
     ON CONFLICT (key) DO UPDATE SET
       count = CASE WHEN security_rate_limits.expires_at <= now() THEN 1 ELSE security_rate_limits.count + 1 END,
       expires_at = CASE WHEN security_rate_limits.expires_at <= now() THEN EXCLUDED.expires_at ELSE security_rate_limits.expires_at END
     WHERE security_rate_limits.expires_at <= now() OR security_rate_limits.count < $3
     RETURNING count`, [key, window, max],
  );
  return { allowed: result.rows.length > 0, retryAfter: window };
}
