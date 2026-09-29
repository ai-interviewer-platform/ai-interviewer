import type { Pool } from "pg";
import { badRequest, json, requestBody, string } from "./http";
import type { SessionResolver } from "./request-handler";
import { consumeRate } from "./security";

export async function deleteAccount(request: Request, sessions: SessionResolver, pool: Pool, userId: string): Promise<Response> {
  const body = await requestBody(request);
  const password = body ? string(body.password) : null;
  if (!password) return badRequest("Enter your password to delete your account.");
  if (!(await consumeRate(pool, `account-delete:${userId}`, 600, 5)).allowed) return json({ error: "Too many attempts. Try again later." }, { status: 429 });
  if (!(await sessions.passwordMatches(request, password))) return json({ error: "The password is incorrect. Nothing was deleted." }, { status: 403 });
  // One statement, so the database removes everything or nothing (migrations/0007_account_deletion.sql).
  await pool.query("SELECT delete_user_account($1)", [userId]);
  return json({ deleted: true });
}

// Every query is scoped to the signed-in user. Shared problem content is limited
// to titles: no reference solutions and no tests leave the server.
// ponytail: one unpaged response; stream or page it if accounts grow very large.
export async function exportAccount(pool: Pool, userId: string): Promise<Response> {
  const owned = "attempt_id IN (SELECT id FROM attempts WHERE user_id = $1)";
  const ownedFindings = `review_id IN (SELECT id FROM reviews WHERE ${owned})`;
  const queries = {
    user: "SELECT id, display_name, email, email_verified, image, default_input_mode, default_save_audio, created_at, updated_at FROM users WHERE id = $1",
    accounts: "SELECT provider_id, account_id, created_at, updated_at FROM auth_accounts WHERE user_id = $1",
    sessions: "SELECT ip_address, user_agent, created_at, updated_at, expires_at FROM auth_sessions WHERE user_id = $1",
    attempts: "SELECT a.*, p.title AS problem_title FROM attempts a JOIN problems p ON p.id = a.problem_id WHERE a.user_id = $1 ORDER BY a.created_at",
    events: `SELECT * FROM attempt_events WHERE ${owned} ORDER BY attempt_id, occurrence_offset_ms, source_id`,
    transcripts: `SELECT * FROM transcript_segments WHERE ${owned} ORDER BY attempt_id, end_offset_ms`,
    checkpoints: `SELECT * FROM code_checkpoints WHERE ${owned} ORDER BY attempt_id, created_at`,
    runs: `SELECT * FROM code_runs WHERE ${owned} ORDER BY attempt_id, created_at`,
    assistance: `SELECT * FROM assistance_events WHERE ${owned} ORDER BY attempt_id, created_at`,
    reviews: `SELECT * FROM reviews WHERE ${owned} ORDER BY created_at`,
    findings: `SELECT * FROM review_findings WHERE ${ownedFindings} ORDER BY created_at`,
    findingEvidence: `SELECT * FROM finding_evidence WHERE finding_id IN (SELECT id FROM review_findings WHERE ${ownedFindings})`,
    corrections: "SELECT * FROM finding_corrections WHERE user_id = $1 ORDER BY created_at",
    voiceReservations: "SELECT started_at, expires_at, reserved_seconds, attempt_id FROM voice_reservations WHERE user_id = $1 ORDER BY started_at",
  };
  const entries = await Promise.all(Object.entries(queries).map(async ([name, sql]) => [name, (await pool.query(sql, [userId])).rows] as const));
  const data: Record<string, unknown> = Object.fromEntries(entries);
  data.user = (data.user as unknown[])[0] ?? null;
  return json({ exportedAt: new Date().toISOString(), ...data }, { headers: { "content-disposition": 'attachment; filename="coursay-export.json"' } });
}
