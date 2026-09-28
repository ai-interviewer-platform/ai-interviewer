import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import pg from "pg";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("Set DATABASE_URL to the target PostgreSQL connection string.");

const client = new pg.Client({ connectionString });
const root = resolve(import.meta.dirname, "..");

async function expectedMigrations() {
  const authDirectory = resolve(root, "migrations", "auth");
  const applicationDirectory = resolve(root, "migrations");
  const auth = (await readdir(authDirectory)).filter(file => file.endsWith(".sql")).sort().map(file => resolve(authDirectory, file));
  const application = (await readdir(applicationDirectory)).filter(file => /^\d+_.+\.sql$/.test(file)).sort().map(file => resolve(applicationDirectory, file));
  return Promise.all([...auth, ...application].map(async path => ({
    filename: path.slice(root.length + 1).replaceAll("\\", "/"),
    checksum: createHash("sha256").update(await readFile(path, "utf8")).digest("hex"),
  })));
}

async function expectDatabaseRejection(name, statement, parameters, message) {
  await client.query(`SAVEPOINT ${name}`);
  let rejected = false;
  try {
    await client.query(statement, parameters);
  } catch (error) {
    rejected = true;
    assert.match(error instanceof Error ? error.message : String(error), message);
  } finally {
    await client.query(`ROLLBACK TO SAVEPOINT ${name}`);
    await client.query(`RELEASE SAVEPOINT ${name}`);
  }
  assert.equal(rejected, true, `${name} should have been rejected by PostgreSQL`);
}

await client.connect();
try {
  const migrations = await client.query("SELECT filename, checksum FROM app_schema_migrations ORDER BY applied_at, filename");
  assert.deepEqual(migrations.rows, await expectedMigrations());

  const authColumns = await client.query(
    "SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'auth_sessions'",
  );
  const authColumnNames = new Set(authColumns.rows.map((row) => row.column_name));
  assert.equal(authColumnNames.has("ip_address"), true);
  assert.equal(authColumnNames.has("user_agent"), true);
  assert.equal(authColumnNames.has("userId"), false);

  const requiredIndexes = new Set((await client.query(
    "SELECT indexname FROM pg_indexes WHERE schemaname = current_schema()",
  )).rows.map(row => row.indexname));
  for (const index of ["auth_sessions_token_unique", "attempts_owner_history_idx", "attempt_events_timeline_idx", "code_runs_attempt_idx", "security_rate_limits_expiry", "voice_reservations_user"]) {
    assert.equal(requiredIndexes.has(index), true, `Missing required index ${index}`);
  }

  const catalog = await client.query(
    `SELECT p.id, p.entry_point, p.test_contract, count(tc.id)::int AS visible_tests
       FROM problems p LEFT JOIN test_cases tc ON tc.problem_id = p.id AND tc.visibility = 'visible'
      WHERE p.is_active = true AND p.is_sample = false
      GROUP BY p.id ORDER BY p.id`,
  );
  assert.ok(catalog.rows.length >= 2);
  for (const problem of catalog.rows) {
    assert.match(problem.entry_point, /^[A-Za-z_][A-Za-z0-9_]{0,127}$/);
    assert.deepEqual(problem.test_contract, { arguments: "values: list", return: "JSON-serializable return value", comparison: "exact JSON equality" });
    assert.ok(problem.visible_tests >= 2 && problem.visible_tests <= 16, `${problem.id} must have 2–16 visible tests`);
  }

  await client.query("BEGIN");
  await client.query(
    "INSERT INTO users (id, display_name, email) VALUES ('verify-owner-a', 'Verify A', 'verify-a@example.invalid'), ('verify-owner-b', 'Verify B', 'verify-b@example.invalid')",
  );
  const attemptValues = "($1, $2, $3, 'mock', 'text', 'active', '{}'::jsonb, now(), 'verification', 'verification')";
  await client.query(
    `INSERT INTO attempts (id, user_id, problem_id, mode, input_mode, status, setup_context, consent_at, disclosure_version, practice_goal) VALUES ${attemptValues}`,
    ["verify-attempt-a", "verify-owner-a", "sum-odd-positions-v1"],
  );
  await client.query(
    `INSERT INTO attempts (id, user_id, problem_id, mode, input_mode, status, setup_context, consent_at, disclosure_version, practice_goal) VALUES ${attemptValues}`,
    ["verify-attempt-b", "verify-owner-b", "sum-odd-positions-v1"],
  );
  await client.query(
    "INSERT INTO attempt_events (id, attempt_id, event_type, source_id, source_order, occurrence_offset_ms) VALUES ('verify-event-a', 'verify-attempt-a', 'run', 'verify-source-a', 0, 0), ('verify-event-b', 'verify-attempt-b', 'run', 'verify-source-b', 0, 0)",
  );
  await client.query(
    "INSERT INTO code_checkpoints (id, attempt_id, event_id, source_code, checkpoint_type) VALUES ('verify-checkpoint-a', 'verify-attempt-a', 'verify-event-a', 'pass', 'run'), ('verify-checkpoint-b', 'verify-attempt-b', 'verify-event-b', 'pass', 'run')",
  );
  await client.query("UPDATE attempts SET status = 'completed', completed_at = now() WHERE id = 'verify-attempt-a'");

  await expectDatabaseRejection(
    "completed_insert",
    "INSERT INTO attempt_events (id, attempt_id, event_type, source_id, source_order, occurrence_offset_ms) VALUES ('verify-late-event', 'verify-attempt-a', 'message', 'verify-late-source', 0, 0)",
    [],
    /completed attempt evidence is immutable/,
  );
  await expectDatabaseRejection(
    "completed_delete",
    "DELETE FROM attempt_events WHERE id = 'verify-event-a'",
    [],
    /completed attempt evidence is immutable/,
  );

  await client.query("INSERT INTO reviews (id, attempt_id, status, evidence_manifest) VALUES ('verify-review-a', 'verify-attempt-a', 'ready', '{}'::jsonb)");
  await client.query("INSERT INTO review_findings (id, review_id, observation, limitations, evidence_status) VALUES ('verify-finding-a', 'verify-review-a', 'Observed', 'Verification only', 'reproducible_observation')");
  await expectDatabaseRejection(
    "cross_attempt_evidence",
    "INSERT INTO finding_evidence (id, finding_id, event_id) VALUES ('verify-evidence', 'verify-finding-a', 'verify-event-b')",
    [],
    /finding evidence must belong to the reviewed attempt/,
  );
  await expectDatabaseRejection(
    "wrong_correction_owner",
    "INSERT INTO finding_corrections (id, finding_id, user_id, reason) VALUES ('verify-correction', 'verify-finding-a', 'verify-owner-b', 'Verification only')",
    [],
    /only the reviewed attempt owner may correct a finding/,
  );
  await expectDatabaseRejection(
    "cross_attempt_retry",
    "INSERT INTO attempts (id, user_id, problem_id, mode, input_mode, status, source_attempt_id, source_checkpoint_id, setup_context, consent_at, disclosure_version, practice_goal) VALUES ('verify-retry', 'verify-owner-a', 'sum-odd-positions-v1', 'coach', 'text', 'active', 'verify-attempt-a', 'verify-checkpoint-b', '{}'::jsonb, now(), 'verification', 'verification')",
    [],
    /retry source must be a checkpoint from the source attempt for the same problem/,
  );
  await client.query("ROLLBACK");
  console.log("Verified migration checksums, auth columns, required indexes, runner-compatible catalog, completed-evidence immutability, review ownership, and retry lineage.");
} catch (error) {
  await client.query("ROLLBACK").catch(() => undefined);
  throw error;
} finally {
  await client.end();
}
