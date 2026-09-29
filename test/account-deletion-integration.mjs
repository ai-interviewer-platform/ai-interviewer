// PostgreSQL-backed account export and deletion check. Uses a disposable schema:
// DATABASE_URL=<local database> node test/account-deletion-integration.mjs
import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { testDatabase } from "./postgres-harness.mjs";
import { withSessions } from "./fake-session.mjs";

const { pool: database, drop } = await testDatabase("account_test", { problemBank: false });
const directory = await mkdtemp(join(tmpdir(), "account-deletion-"));
// Every table that references users or Attempts, directly or through another such table.
const personalTables = (await database.query(`WITH RECURSIVE personal(name) AS (
    SELECT 'users'::text
    UNION SELECT c.conrelid::regclass::text FROM pg_constraint c JOIN personal p ON c.confrelid::regclass::text = p.name WHERE c.contype = 'f'
  ) SELECT name FROM personal ORDER BY name`)).rows.map(row => row.name);
// Keyed by the user ID by convention, with no foreign key.
const tables = [...personalTables, "auth_verifications", "security_rate_limits"];
let userRateLimitPrefixes;

async function rowsMentioning(text) {
  const counts = {};
  for (const table of tables) counts[table] = (await database.query(`SELECT count(*)::int AS count FROM ${table} t WHERE to_jsonb(t)::text LIKE $1`, [`%${text}%`])).rows[0].count;
  return counts;
}

async function rejects(sql, parameters = []) {
  const client = await database.connect();
  try {
    await client.query("BEGIN");
    await assert.rejects(client.query(sql, parameters), /completed attempt evidence is immutable/);
  } finally {
    await client.query("ROLLBACK");
    client.release();
  }
}

async function fixture(user) {
  const q = (sql, values) => database.query(sql, values);
  await q("INSERT INTO users (id, display_name, email) VALUES ($1, $1, $1 || '@example.invalid')", [user]);
  await q("INSERT INTO auth_accounts (id, account_id, provider_id, user_id, password, updated_at) VALUES ($1 || '-account', $1, 'credential', $1, 'hash', now())", [user]);
  await q("INSERT INTO auth_sessions (id, expires_at, token, updated_at, user_id) VALUES ($1 || '-session', now() + interval '1 day', $1 || '-token', now(), $1)", [user]);
  await q("INSERT INTO auth_verifications (id, identifier, value, expires_at) VALUES ($1 || '-reset', 'reset-password:' || $1 || '-reset-token', $1, now() + interval '1 hour')", [user]);
  for (const prefix of userRateLimitPrefixes) await q("INSERT INTO security_rate_limits (key, count, expires_at) VALUES ($2 || ':' || $1, 1, now() + interval '1 minute')", [user, prefix]);
  await q("INSERT INTO attempts (id, user_id, problem_id, mode, input_mode, status, setup_context, consent_at, disclosure_version, practice_goal) VALUES ($1 || '-attempt', $1, 'sum-odd-positions-v1', 'mock', 'text', 'active', '{}', now(), 'test', 'Practice')", [user]);
  for (const [suffix, type] of [["checkpoint-event", "code_checkpoint"], ["run-event", "code_run"], ["text-event", "candidate_text"], ["help-event", "help_requested"]]) {
    await q("INSERT INTO attempt_events (id, attempt_id, event_type, source_id, source_order, occurrence_offset_ms) VALUES ($1 || '-' || $2::text, $1 || '-attempt', $3, $2::text, 0, 0)", [user, suffix, type]);
  }
  await q("INSERT INTO code_checkpoints (id, attempt_id, event_id, source_code, checkpoint_type) VALUES ($1 || '-checkpoint', $1 || '-attempt', $1 || '-checkpoint-event', 'pass', 'run')", [user]);
  await q("INSERT INTO code_runs (id, attempt_id, checkpoint_id, event_id, status, run_kind, runner_version, harness_version) VALUES ($1 || '-run', $1 || '-attempt', $1 || '-checkpoint', $1 || '-run-event', 'passed', 'visible', 'test', 'test')", [user]);
  await q("INSERT INTO transcript_segments (id, attempt_id, event_id, speaker, text, end_offset_ms) VALUES ($1 || '-transcript', $1 || '-attempt', $1 || '-text-event', 'candidate', 'My approach', 0)", [user]);
  await q("INSERT INTO assistance_events (id, attempt_id, event_id, category, content) VALUES ($1 || '-help', $1 || '-attempt', $1 || '-help-event', 'hint', '')", [user]);
  await q("INSERT INTO attempt_audio (id, attempt_id, object_key, start_offset_ms, end_offset_ms, media_type, status) VALUES ($1 || '-audio', $1 || '-attempt', $1 || '-audio-object', 0, 10, 'audio/wav', 'deleted')", [user]);
  await q("INSERT INTO attempts (id, user_id, problem_id, mode, input_mode, status, source_attempt_id, source_checkpoint_id, setup_context, consent_at, disclosure_version, practice_goal) VALUES ($1 || '-retry', $1, 'sum-odd-positions-v1', 'coach', 'text', 'active', $1 || '-attempt', $1 || '-checkpoint', '{}', now(), 'test', 'Retry')", [user]);
  await q("UPDATE attempts SET status = 'completed', completed_at = now() WHERE id = $1 || '-attempt'", [user]);
  await q("INSERT INTO reviews (id, attempt_id, status, evidence_manifest) VALUES ($1 || '-review', $1 || '-attempt', 'ready', '{}')", [user]);
  await q("INSERT INTO review_findings (id, review_id, observation, limitations, evidence_status, retry_checkpoint_id) VALUES ($1 || '-finding', $1 || '-review', 'Observed', 'Limited', 'reproducible_observation', $1 || '-checkpoint')", [user]);
  await q("INSERT INTO finding_evidence (id, finding_id, event_id) VALUES ($1 || '-evidence', $1 || '-finding', $1 || '-run-event')", [user]);
  await q("INSERT INTO finding_corrections (id, finding_id, user_id, reason) VALUES ($1 || '-correction', $1 || '-finding', $1, 'Disagree')", [user]);
  await q("INSERT INTO voice_reservations (id, user_id, attempt_id, expires_at, reserved_seconds) VALUES ($1 || '-voice', $1, $1 || '-retry', now(), 60)", [user]);
}

try {
  await build({ entryPoints: ["src/request-handler.ts", "src/account.ts", "src/security.ts"], outdir: directory, outExtension: { ".js": ".mjs" }, bundle: true, format: "esm", platform: "node" });
  const { handleRequest } = await import(pathToFileURL(join(directory, "request-handler.mjs")));
  const { exportedTables } = await import(pathToFileURL(join(directory, "account.mjs")));
  ({ userRateLimitPrefixes } = await import(pathToFileURL(join(directory, "security.mjs"))));
  const handle = withSessions(handleRequest);
  const origin = "https://app.example";
  const env = { BETTER_AUTH_URL: origin, PERSONAL_DATA_COLLECTION_APPROVED: "true" };
  await fixture("owner");
  await fixture("other");
  const before = { owner: await rowsMentioning("owner"), other: await rowsMentioning("other") };
  for (const table of tables) assert.ok(before.owner[table] > 0, `the fixture has a row in ${table}; add one for a new personal table`);

  const exported = await (await handle(new Request(`${origin}/api/me/export`), env, {}, database)).json();
  const text = JSON.stringify(exported);
  assert.equal(exported.user.id, "owner");
  assert.equal(exported.attempts.length, 2);
  for (const table of personalTables) {
    assert.ok(exportedTables[table], `the export has a query for ${table}`);
    if (table !== "users") assert.ok(exported[exportedTables[table].key].length > 0, `the export has the rows of ${table}`);
  }
  assert.doesNotMatch(text, /other|reference_solution|owner-token|"hash"/, "export contains only the owner's non-secret data");
  console.log("Passed: export contains only the signed-in user's data");

  await rejects("UPDATE attempt_events SET payload = '{\"edited\":true}' WHERE id = 'owner-run-event'");
  await rejects("DELETE FROM attempt_events WHERE id = 'owner-run-event'");
  await rejects("UPDATE code_checkpoints SET source_code = 'edited' WHERE id = 'owner-checkpoint'");
  await rejects("SELECT set_config('app.deleting_user_id', 'owner', true); DELETE FROM transcript_segments WHERE id = 'other-transcript'");
  await rejects("SELECT set_config('app.deleting_user_id', 'owner', true); UPDATE transcript_segments SET text = 'edited' WHERE id = 'owner-transcript'");
  console.log("Passed: completed evidence stays immutable outside account deletion");

  const remove = (password, headers = {}) => handle(new Request(`${origin}/api/me`, { method: "DELETE", headers: { origin, "content-type": "application/json", ...headers }, body: JSON.stringify({ password }) }), env, {}, database);
  assert.equal((await remove("correct password", { origin: "https://attacker.example" })).status, 403);
  assert.equal((await remove("wrong")).status, 403);
  assert.equal((await remove("")).status, 400);
  assert.deepEqual(await rowsMentioning("owner"), before.owner, "a rejected request deletes nothing");
  assert.equal((await remove("correct password")).status, 200);
  const after = { owner: await rowsMentioning("owner"), other: await rowsMentioning("other") };
  for (const table of tables) {
    assert.equal(after.owner[table], 0, `${table} has no rows for the deleted user`);
    assert.equal(after.other[table], before.other[table], `${table} keeps the other user's rows`);
  }
  await rejects("DELETE FROM attempt_events WHERE id = 'other-run-event'");
  console.log("Passed: account deletion removes every row of the user and none of another user");
} finally {
  await drop();
  await rm(directory, { recursive: true, force: true });
}
