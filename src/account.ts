import type { Pool } from "pg";
import { withTransaction } from "./transaction";
import { badRequest, json, requestBody, string } from "./http";
import type { SessionResolver } from "./request-handler";
import { consumeRate, userRateLimitKey, userRateLimitKeys } from "./security";

export async function deleteAccount(request: Request, sessions: SessionResolver, pool: Pool, userId: string): Promise<Response> {
  const body = await requestBody(request);
  const password = body ? string(body.password) : null;
  if (!password) return badRequest("Enter your password to delete your account.");
  if (!(await consumeRate(pool, userRateLimitKey("account-delete", userId), 600, 5)).allowed) return json({ error: "Too many attempts. Try again later." }, { status: 429 });
  if (!(await sessions.passwordMatches(request, password))) return json({ error: "The password is incorrect. Nothing was deleted." }, { status: 403 });
  // One transaction, so the database removes everything or nothing: the personal rows
  // (migrations/0009_account_deletion_without_rate_limits.sql), then every user-keyed rate-limit row.
  await withTransaction(pool, async (client) => {
    await client.query("SELECT delete_user_account($1)", [userId]);
    await client.query("DELETE FROM security_rate_limits WHERE key = ANY($1)", [userRateLimitKeys(userId)]);
  });
  return json({ deleted: true });
}

const owned = "attempt_id IN (SELECT id FROM attempts WHERE user_id = $1)";
const ownedFindings = `review_id IN (SELECT id FROM reviews WHERE ${owned})`;

// One export query for each table that references users or Attempts, keyed by table
// name. test/account-deletion-integration.mjs fails when a table is missing here.
// Every query is scoped to the signed-in user. Shared problem content is limited
// to titles: no reference solutions and no tests leave the server.
export const exportedTables = {
  users: { key: "user", sql: "SELECT id, display_name, email, email_verified, image, default_input_mode, default_save_audio, created_at, updated_at FROM users WHERE id = $1" },
  auth_accounts: { key: "accounts", sql: "SELECT provider_id, account_id, created_at, updated_at FROM auth_accounts WHERE user_id = $1" },
  auth_sessions: { key: "sessions", sql: "SELECT ip_address, user_agent, created_at, updated_at, expires_at FROM auth_sessions WHERE user_id = $1" },
  attempts: { key: "attempts", sql: "SELECT a.*, p.title AS problem_title FROM attempts a JOIN problems p ON p.id = a.problem_id WHERE a.user_id = $1 ORDER BY a.created_at" },
  attempt_events: { key: "events", sql: `SELECT * FROM attempt_events WHERE ${owned} ORDER BY attempt_id, occurrence_offset_ms, source_id` },
  transcript_segments: { key: "transcripts", sql: `SELECT * FROM transcript_segments WHERE ${owned} ORDER BY attempt_id, end_offset_ms` },
  code_checkpoints: { key: "checkpoints", sql: `SELECT * FROM code_checkpoints WHERE ${owned} ORDER BY attempt_id, created_at` },
  code_runs: { key: "runs", sql: `SELECT * FROM code_runs WHERE ${owned} ORDER BY attempt_id, created_at` },
  assistance_events: { key: "assistance", sql: `SELECT * FROM assistance_events WHERE ${owned} ORDER BY attempt_id, created_at` },
  attempt_audio: { key: "audio", sql: `SELECT * FROM attempt_audio WHERE ${owned} ORDER BY attempt_id, start_offset_ms` },
  reviews: { key: "reviews", sql: `SELECT * FROM reviews WHERE ${owned} ORDER BY created_at` },
  review_findings: { key: "findings", sql: `SELECT * FROM review_findings WHERE ${ownedFindings} ORDER BY created_at` },
  finding_evidence: { key: "findingEvidence", sql: `SELECT * FROM finding_evidence WHERE finding_id IN (SELECT id FROM review_findings WHERE ${ownedFindings})` },
  finding_corrections: { key: "corrections", sql: "SELECT * FROM finding_corrections WHERE user_id = $1 ORDER BY created_at" },
  voice_reservations: { key: "voiceReservations", sql: "SELECT started_at, expires_at, reserved_seconds, attempt_id FROM voice_reservations WHERE user_id = $1 ORDER BY started_at" },
};

// ponytail: one unpaged response; stream or page it if accounts grow very large.
export async function exportAccount(pool: Pool, userId: string): Promise<Response> {
  const entries = await Promise.all(Object.values(exportedTables).map(async ({ key, sql }) => [key, (await pool.query(sql, [userId])).rows] as const));
  const data: Record<string, unknown> = Object.fromEntries(entries);
  data.user = (data.user as unknown[])[0] ?? null;
  return json({ exportedAt: new Date().toISOString(), ...data }, { headers: { "content-disposition": 'attachment; filename="coursay-export.json"' } });
}
