import assert from "node:assert/strict";
import { test } from "node:test";
import { createAttemptSession } from "../public/attempt-session.js";

function fixture({ inputMode = "text", status = "active", editor = "def f():\n    return 2\n" } = {}) {
  const calls = [];
  const row = { id: "attempt/1", input_mode: inputMode, status, draft_source: "def f():\n    return 1\n", draft_revision: 4, created_at: new Date(Date.now() - 5000).toISOString() };
  const view = { editor };
  const api = async (path, options = {}) => {
    calls.push({ path, method: options.method ?? "GET", body: options.body });
    return path.endsWith("/draft") ? { draftRevision: options.body.expectedRevision + 1 } : {};
  };
  const session = createAttemptSession({ api, attempt: () => row, editorSource: () => view.editor });
  return { calls, row, view, session };
}

for (const inputMode of ["text", "voice"]) {
  test(`a changed Draft is saved before every message, Help request, Run, and finish in ${inputMode} Input mode`, async () => {
    for (const [name, send, path] of [
      ["message", (session) => session.message("My plan"), "/messages"],
      ["help", (session) => session.help("hint"), "/help"],
      ["run", (session) => session.run(), "/run"],
      ["finish", (session) => session.finish(), "/finish"],
    ]) {
      const { calls, row, session } = fixture({ inputMode });
      await send(session);
      assert.deepEqual(calls.map(({ method, path: called }) => `${method} ${called}`), ["PATCH /api/attempts/attempt%2F1/draft", `POST /api/attempts/attempt%2F1${path}`], name);
      assert.equal(calls[0].body.source, "def f():\n    return 2\n");
      assert.equal(calls[0].body.expectedRevision, 4);
      assert.deepEqual([row.draft_source, row.draft_revision], ["def f():\n    return 2\n", 5], "the saved Draft becomes the new base");
    }
  });
}

test("an unchanged Draft, a completed Attempt, and no editor save nothing", async () => {
  for (const options of [{ editor: "def f():\n    return 1\n" }, { status: "completed" }, { editor: null }]) {
    const { calls, session } = fixture(options);
    await session.saveChangedDraft();
    assert.deepEqual(calls, []);
  }
  const { calls, session } = fixture({ editor: "def f():\n    return 1\n" });
  await session.run();
  assert.deepEqual(calls.map(({ path }) => path), ["/api/attempts/attempt%2F1/run"]);
});

test("the client builds the Event fields: a named sourceId, a rising sourceOrder, and a non-decreasing offset", async () => {
  const { calls, view, session } = fixture();
  await session.message("First");
  view.editor = "def f():\n    return 3\n";
  await session.help("hint");
  const fields = calls.map(({ body }) => body);
  assert.deepEqual(fields.map(({ sourceId }) => sourceId.split(":")[0]), ["draft", "message", "draft", "help"]);
  assert.deepEqual(fields.map(({ sourceOrder }) => sourceOrder), [1, 2, 3, 4]);
  assert.ok(fields.every(({ occurrenceOffsetMs }, index) => occurrenceOffsetMs >= 5000 && (index === 0 || occurrenceOffsetMs >= fields[index - 1].occurrenceOffsetMs)));
  assert.deepEqual({ text: fields[1].text, category: fields[3].category }, { text: "First", category: "hint" });
});

test("the client builds the Attempt URLs for reads, a Retry, and a Correction", async () => {
  const { calls, session } = fixture();
  await session.detail("attempt/1");
  await session.detail("attempt/1", 2);
  await session.review("attempt/1");
  await session.related();
  await session.retry("checkpoint-1", "Focused retry");
  await session.correctFinding("finding/1", "Disagree");
  assert.deepEqual(calls.map(({ method, path, body }) => [method, path, body]), [
    ["GET", "/api/attempts/attempt%2F1", undefined],
    ["GET", "/api/attempts/attempt%2F1?page=2", undefined],
    ["GET", "/api/attempts/attempt%2F1/review", undefined],
    ["GET", "/api/attempts/attempt%2F1/related", undefined],
    ["POST", "/api/attempts/attempt%2F1/retry", { checkpointId: "checkpoint-1", practiceGoal: "Focused retry" }],
    ["POST", "/api/attempts/attempt%2F1/review/findings/finding%2F1/corrections", { reason: "Disagree" }],
  ]);
});
