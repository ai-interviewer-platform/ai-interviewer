import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { after, test } from "node:test";

// The Voice session relay and its provider credentials run in test/security-integration.mjs.
const directory = await mkdtemp(join(tmpdir(), "deepgram-"));
after(() => rm(directory, { recursive: true, force: true }));
await build({ entryPoints: ["src/deepgram.ts"], outdir: directory, outExtension: { ".js": ".mjs" }, bundle: true, format: "esm", platform: "node" });
const { DEEPGRAM_THINKING_MODEL, DEEPGRAM_VOICE_PROVIDER, deepgramVoiceEnabled, voiceSettings } = await import(pathToFileURL(join(directory, "deepgram.mjs")));
const problem = { title: "Sum odd positions", prompt: "Return the sum of the values at odd indexes." };

test("the voice settings use Deepgram listening and speech with GPT-5.6 Terra thinking", () => {
  const settings = voiceSettings({ mode: "mock", practice_goal: "Explain the slice" }, problem);
  assert.equal(DEEPGRAM_VOICE_PROVIDER, "deepgram");
  assert.equal(settings.type, "Settings");
  assert.deepEqual(settings.audio, { input: { encoding: "linear16", sample_rate: 16000 }, output: { encoding: "linear16", sample_rate: 24000, container: "none" } });
  assert.deepEqual(settings.agent.listen.provider, { type: "deepgram", version: "v1", model: "nova-3", language: "en-US", smart_format: true });
  assert.deepEqual(settings.agent.think.provider, { type: "open_ai", model: "gpt-5.6-terra" });
  assert.equal(DEEPGRAM_THINKING_MODEL, "gpt-5.6-terra");
  assert.deepEqual(settings.agent.speak.provider, { type: "deepgram", version: "v2", model: "flux-kit-en" });
  assert.deepEqual(settings.agent.think.functions.map(({ name, defer_until_eot }) => ({ name, defer_until_eot })), [{ name: "get_coding_context", defer_until_eot: true }]);
});

test("the voice prompt carries the Mode, the practice goal, and the Problem", () => {
  const mock = voiceSettings({ mode: "mock", practice_goal: "Explain the slice" }, problem).agent.think.prompt;
  const coach = voiceSettings({ mode: "coach", practice_goal: "Explain the slice" }, problem).agent.think.prompt;
  for (const prompt of [mock, coach]) {
    assert.ok(prompt.includes("Practice goal: Explain the slice"));
    assert.ok(prompt.includes(`Problem: ${problem.title}\n${problem.prompt}`));
    assert.ok(prompt.includes("call get_coding_context"));
  }
  assert.ok(mock.includes("Do not volunteer hints or solutions."));
  assert.ok(coach.includes("Give guidance only when requested"));
});

test("voice is enabled only with a Deepgram key and the Voice session binding", () => {
  assert.equal(deepgramVoiceEnabled({ DEEPGRAM_API_KEY: "fictional", VOICE_SESSIONS: {} }), true);
  for (const env of [{}, { DEEPGRAM_API_KEY: " ", VOICE_SESSIONS: {} }, { DEEPGRAM_API_KEY: "fictional" }]) assert.equal(deepgramVoiceEnabled(env), false);
});
