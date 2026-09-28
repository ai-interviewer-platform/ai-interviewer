import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { after, test } from "node:test";

const directory = await mkdtemp(join(tmpdir(), "voice-context-"));
after(() => rm(directory, { recursive: true, force: true }));
await build({ entryPoints: ["src/voice-context.ts"], outdir: directory, outExtension: { ".js": ".mjs" }, bundle: true, format: "esm", platform: "node" });
const { loadVoiceCodingContext } = await import(pathToFileURL(join(directory, "voice-context.mjs")));

function pool({ owner = "owner", status = "active", inputMode = "voice", source = "def solve(values):\n    pass\n", run = null, checkpoint = null, assistance = null } = {}) {
  return { async query(sql, values) {
    if (sql.startsWith("SELECT draft_source")) {
      if (values[0] !== "attempt" || values[1] !== owner) return { rows: [] };
      return { rows: [{ draft_source: source, draft_revision: 3, status, input_mode: inputMode }] };
    }
    if (sql.startsWith("SELECT id, checkpoint_type")) return { rows: checkpoint ? [checkpoint] : [] };
    if (sql.startsWith("SELECT id, checkpoint_id")) return { rows: run ? [run] : [] };
    if (sql.startsWith("SELECT category")) return { rows: assistance ? [assistance] : [] };
    throw new Error(`Unexpected SQL: ${sql}`);
  } };
}

test("voice coding context is owner-scoped and rejects completed/non-voice attempts", async () => {
  assert.equal(await loadVoiceCodingContext(pool(), "attempt", "other"), null);
  assert.deepEqual(JSON.parse(await loadVoiceCodingContext(pool({ status: "completed" }), "attempt", "owner")), { status: "unavailable", reason: "attempt_not_active" });
  assert.deepEqual(JSON.parse(await loadVoiceCodingContext(pool({ inputMode: "text" }), "attempt", "owner")), { status: "unavailable", reason: "attempt_not_active" });
});

test("voice coding context is bounded and handles a missing runner result", async () => {
  const context = JSON.parse(await loadVoiceCodingContext(pool({ source: "x".repeat(64 * 1024) }), "attempt", "owner"));
  assert.equal(context.status, "available");
  assert.equal(context.savedDraft.truncated, true);
  assert.equal(context.latestVisibleRun, null);
  assert.ok(new TextEncoder().encode(JSON.stringify(context)).byteLength <= 16 * 1024);
});

test("voice coding context exposes only normalized saved and visible-run fields", async () => {
  const context = JSON.parse(await loadVoiceCodingContext(pool({
    checkpoint: { id: "checkpoint", checkpoint_type: "run", created_at: "2026-09-28T00:00:00Z" },
    run: { id: "run", checkpoint_id: "checkpoint", status: "failed", tests_passed: 1, tests_failed: 1, test_results: [{ testId: "visible-a", outcome: "passed", actualOutput: "private-output" }, { testId: "visible-b", outcome: "failed", error: "private-error" }], created_at: "2026-09-28T00:00:01Z" },
    assistance: { category: "hint", delivered: false, created_at: "2026-09-28T00:00:02Z" },
  }), "attempt", "owner"));
  assert.deepEqual(context.latestVisibleRun.outcomes, [{ testId: "visible-a", outcome: "passed" }, { testId: "visible-b", outcome: "failed" }]);
  assert.equal(JSON.stringify(context).includes("private-output"), false);
  assert.equal(JSON.stringify(context).includes("private-error"), false);
  assert.deepEqual(context.latestHelpRequest, { category: "hint", delivered: false, createdAt: "2026-09-28T00:00:02Z" });
});
