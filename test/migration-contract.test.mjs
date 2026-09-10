import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const authSchema = await readFile(new URL("../src/db/generated-auth.ts", import.meta.url), "utf8");
const applicationSchema = await readFile(new URL("../migrations/0002_application.sql", import.meta.url), "utf8");

test("Better Auth generator owns the mapped PostgreSQL auth tables", () => {
  assert.match(authSchema, /pgTable\("users"/);
  assert.match(authSchema, /pgTable\(\s*"auth_sessions"/);
  assert.match(authSchema, /display_name/);
  assert.match(authSchema, /default_save_audio/);
  assert.doesNotMatch(applicationSchema, /CREATE TABLE users/);
});

test("application migration retains evidence, ownership, and retry constraints", () => {
  for (const table of ["attempts", "attempt_events", "code_checkpoints", "code_runs", "reviews", "review_findings", "finding_corrections"]) {
    assert.match(applicationSchema, new RegExp(`CREATE TABLE ${table}`));
  }
  assert.match(applicationSchema, /REFERENCES users\(id\)/);
  assert.match(applicationSchema, /UNIQUE \(attempt_id, source_id\)/);
  assert.match(applicationSchema, /enforce_attempt_detail_membership/);
  assert.match(applicationSchema, /reject_completed_attempt_evidence/);
  assert.match(applicationSchema, /enforce_retry_lineage/);
  assert.match(applicationSchema, /enforce_review_evidence_membership/);
  assert.match(applicationSchema, /CHECK \(\(source_attempt_id IS NULL\) = \(source_checkpoint_id IS NULL\)\)/);
});
