// The Voice reservation budget against PostgreSQL, without the Durable Object runtime.
import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { testDatabase } from "./postgres-harness.mjs";

const { pool: database, drop } = await testDatabase("voice_budget_test", { problemBank: false });
const directory = await mkdtemp(join(tmpdir(), "voice-budget-"));
try {
  await build({ entryPoints: ["src/voice-budget.ts", "src/security.ts"], outdir: directory, outExtension: { ".js": ".mjs" }, bundle: true, format: "esm", platform: "node" });
  const { extendVoice, releaseVoice, reserveVoice } = await import(pathToFileURL(join(directory, "voice-budget.mjs")));
  const { limits } = await import(pathToFileURL(join(directory, "security.mjs")));
  const reservations = async (user) => (await database.query("SELECT reserved_seconds, expires_at > now() AS active FROM voice_reservations WHERE user_id = $1 ORDER BY started_at", [user])).rows;
  for (const user of ["owner", "other", "third"]) {
    await database.query("INSERT INTO users (id, display_name, email) VALUES ($1, $1, $1 || '@example.invalid')", [user]);
    for (const [suffix, inputMode, status] of [["voice", "voice", "active"], ["text", "text", "active"], ["done", "voice", "completed"]]) {
      await database.query("INSERT INTO attempts (id, user_id, problem_id, mode, input_mode, status, setup_context, consent_at, disclosure_version, practice_goal) VALUES ($1 || '-' || $2, $1, 'sum-odd-positions-v1', 'mock', $3, $4, '{}', now(), 'test', 'Practice')", [user, suffix, inputMode, status]);
    }
  }

  // Only an open voice Attempt of the same user can hold a reservation.
  for (const [attempt, user] of [["owner-text", "owner"], ["owner-done", "owner"], ["owner-voice", "other"], [null, null]]) {
    assert.deepEqual(await reserveVoice(database, attempt, user), { status: "attempt unavailable" });
  }
  const first = await reserveVoice(database, "owner-voice", "owner");
  assert.equal(first.status, "reserved");
  assert.equal(first.attempt.id, "owner-voice");
  assert.ok(first.reservation.expiresAt.getTime() > Date.now());
  console.log("PASS a reservation needs an open voice Attempt of the user");

  // One active voice connection for each user; concurrent reservations cannot both win.
  assert.deepEqual(await reserveVoice(database, "owner-voice", "owner"), { status: "exhausted" });
  const concurrent = await Promise.all([reserveVoice(database, "other-voice", "other"), reserveVoice(database, "other-voice", "other")]);
  assert.deepEqual(concurrent.map(({ status }) => status).sort(), ["exhausted", "reserved"]);
  console.log("PASS one active voice connection for each user");

  // Extend adds seconds within the account limit; release ends the connection.
  const extended = await extendVoice(database, first.reservation.id, 60);
  assert.equal(extended.status, "extended");
  assert.ok(extended.expiresAt > first.reservation.expiresAt);
  assert.deepEqual(await reservations("owner"), [{ reserved_seconds: limits.voiceSeconds + 60, active: true }]);
  assert.deepEqual(await extendVoice(database, first.reservation.id, limits.accountVoiceSeconds), { status: "exhausted" }, "extend respects the account limit");
  await releaseVoice(database, first.reservation.id);
  assert.deepEqual(await reservations("owner"), [{ reserved_seconds: limits.voiceSeconds + 60, active: false }], "released seconds still count for the day");
  assert.deepEqual(await extendVoice(database, first.reservation.id, 60), { status: "ended" });
  assert.equal((await reserveVoice(database, "owner-voice", "owner")).status, "reserved", "a released connection frees the user for a new one");
  console.log("PASS extend and release");

  // The account limit and the project limit count the seconds reserved today.
  await database.query("UPDATE voice_reservations SET expires_at = now(), reserved_seconds = $2 WHERE user_id = $1", ["owner", limits.accountVoiceSeconds]);
  assert.deepEqual(await reserveVoice(database, "owner-voice", "owner"), { status: "exhausted" }, "account limit");
  await database.query("UPDATE voice_reservations SET expires_at = now(), reserved_seconds = $1 WHERE user_id = 'other'", [limits.projectVoiceSeconds]);
  assert.deepEqual(await reserveVoice(database, "third-voice", "third"), { status: "exhausted" }, "project limit");
  await database.query("UPDATE voice_reservations SET started_at = now() - interval '2 days', expires_at = now() - interval '2 days'");
  assert.equal((await reserveVoice(database, "third-voice", "third")).status, "reserved", "earlier days do not count");
  console.log("PASS account and project limits");
} finally {
  await drop();
  await rm(directory, { recursive: true, force: true });
}
