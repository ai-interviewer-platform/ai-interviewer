import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { testDatabase } from "./postgres-harness.mjs";
import { withSessions } from "./fake-session.mjs";

// The message and Help request routes map an Interviewer turn to HTTP, against real
// PostgreSQL with a fake Workers AI binding. Prompt building and the turn rules:
// test/interviewer-turn-integration.mjs. Reviews: test/review-integration.mjs.
const { pool: database, drop } = await testDatabase("llm_test", { problemBank: false });
const directory = await mkdtemp(join(tmpdir(), "llm-integration-"));
const calls = [];
let reply = () => ({ text: "unused" });
const AI = { calls, async run(model, input) {
  this.calls.push({ model, ...input });
  const next = reply(input);
  return { choices: [{ finish_reason: next.stop ?? "stop", message: { role: "assistant", content: next.text } }] };
} };
const outage = () => { throw new Error("3040: Capacity temporarily exceeded"); };
try {
  await build({ entryPoints: ["src/request-handler.ts"], outdir: directory, outExtension: { ".js": ".mjs" }, bundle: true, format: "esm", platform: "node" });
  const { handleRequest } = await import(pathToFileURL(join(directory, "request-handler.mjs")));
  const handle = withSessions(handleRequest);
  const origin = "https://app.example";
  const env = { BETTER_AUTH_URL: origin, PERSONAL_DATA_COLLECTION_APPROVED: "true", AI, REVIEW_QUEUE: { send: async () => {} } };
  const post = (path, body, attemptId = "text", requestEnv = env) => handle(new Request(`${origin}/api/attempts/${attemptId}/${path}`, { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify(body) }), requestEnv, {}, database);
  const rows = async (sql, values = []) => (await database.query(sql, values)).rows;

  await database.query("INSERT INTO users (id, display_name, email) VALUES ('owner', 'Owner', 'owner@example.invalid')");
  await database.query("INSERT INTO attempts (id, user_id, problem_id, mode, input_mode, status, setup_context, consent_at, disclosure_version, practice_goal, draft_source) VALUES ('text', 'owner', 'sum-odd-positions-v1', 'mock', 'text', 'active', '{}', now(), 'test', 'Practice', 'def sum_odd_positions(values):\n    return 0\n')");

  // A reply is generated, stored, and returned once.
  reply = () => ({ text: "What should happen for an empty list?" });
  let response = await post("messages", { text: "I will loop over the odd indexes.", sourceId: "message-1", sourceOrder: 1, occurrenceOffsetMs: 100 });
  assert.equal(response.status, 201);
  const first = await response.json();
  assert.equal(first.reply.text, "What should happen for an empty list?");
  assert.equal(first.reply.speaker, "interviewer");
  response = await post("messages", { text: "I will loop over the odd indexes.", sourceId: "message-1", sourceOrder: 1, occurrenceOffsetMs: 100 });
  assert.deepEqual((await response.json()).reply, first.reply, "a repeated message returns the stored reply");
  assert.equal(calls.length, 1, "a repeated message does not call the model again");
  const stored = await rows("SELECT e.event_type, t.speaker FROM attempt_events e JOIN transcript_segments t ON t.event_id = e.id WHERE e.attempt_id = 'text' ORDER BY t.end_offset_ms");
  assert.deepEqual(stored.map((row) => [row.event_type, row.speaker]), [["candidate_text", "candidate"], ["interviewer_text", "interviewer"]]);

  // Provider failure: the candidate message stays; no reply is invented.
  reply = outage;
  response = await post("messages", { text: "Is the list ever empty?", sourceId: "message-2", sourceOrder: 2, occurrenceOffsetMs: 200 });
  assert.equal(response.status, 201);
  const failed = await response.json();
  assert.equal(failed.reply, null);
  assert.equal(failed.replyError, "The interviewer could not respond, so no reply was generated.");
  assert.equal((await rows("SELECT id FROM transcript_segments WHERE event_id = $1", [failed.eventId])).length, 1);
  assert.equal((await rows("SELECT id FROM attempt_events WHERE event_type = 'interviewer_text'")).length, 1);

  // Requested help in text mode is delivered and recorded.
  reply = () => ({ text: "Which indexes does the slice start from?" });
  response = await post("help", { category: "hint", sourceId: "help-1", sourceOrder: 3, occurrenceOffsetMs: 300 });
  assert.equal(response.status, 201);
  const help = await response.json();
  assert.deepEqual([help.delivered, help.voiceReady, help.reply.text, help.message], [true, false, "Which indexes does the slice start from?", "Your hint request was answered in the conversation."]);
  assert.deepEqual(await rows("SELECT delivered, content FROM assistance_events WHERE event_id = $1", [help.eventId]), [{ delivered: true, content: "Which indexes does the slice start from?" }]);

  // Requested help in text mode with no reply: the request stays recorded and undelivered.
  response = await post("help", { category: "explanation", sourceId: "help-2", sourceOrder: 4, occurrenceOffsetMs: 400 }, "text", { ...env, AI: undefined });
  assert.equal(response.status, 202);
  assert.deepEqual(await response.json(), { eventId: (await rows("SELECT event_id FROM assistance_events WHERE category = 'explanation'"))[0].event_id, delivered: false, voiceReady: false, reply: null, message: "Your explanation request was recorded, but no guidance was delivered. The text interviewer is not configured, so no reply was generated." });

  // Voice: a message gets no text reply, and a Help request waits for the live Interviewer.
  await database.query("INSERT INTO attempts (id, user_id, problem_id, mode, input_mode, status, setup_context, consent_at, disclosure_version, practice_goal, draft_source) VALUES ('voice', 'owner', 'sum-odd-positions-v1', 'mock', 'voice', 'active', '{}', now(), 'test', 'Practice', '')");
  const voiceEnv = { ...env, DEEPGRAM_API_KEY: "fictional", VOICE_SESSIONS: {} };
  const modelCalls = calls.length;
  response = await post("messages", { text: "Can you hear me?", sourceId: "voice-message", sourceOrder: 1, occurrenceOffsetMs: 100 }, "voice", voiceEnv);
  assert.equal(response.status, 201);
  assert.deepEqual(Object.keys(await response.json()), ["eventId"]);
  response = await post("help", { category: "hint", sourceId: "voice-help-1", sourceOrder: 2, occurrenceOffsetMs: 200 }, "voice", voiceEnv);
  assert.equal(response.status, 202);
  const { eventId: _ready, ...ready } = await response.json();
  assert.deepEqual(ready, { delivered: false, voiceReady: true, message: "Your hint request was recorded and is ready for the live interviewer." });
  response = await post("help", { category: "hint", sourceId: "voice-help-2", sourceOrder: 3, occurrenceOffsetMs: 300 }, "voice");
  const { eventId: _unconfigured, ...unconfigured } = await response.json();
  assert.deepEqual(unconfigured, { delivered: false, voiceReady: false, message: "Your hint request was recorded, but no guidance was delivered because the live conversation provider is not configured." });
  assert.equal(calls.length, modelCalls, "voice turns never call the text model");
  console.log("The message and Help request routes map text replies, undelivered reasons and voice turns to HTTP.");
} finally {
  await drop();
  await rm(directory, { recursive: true, force: true });
}
