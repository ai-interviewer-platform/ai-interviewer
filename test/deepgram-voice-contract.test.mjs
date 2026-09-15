import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("Deepgram is the browser voice pipeline with GPT-5.6 Terra thinking", async () => {
  const [source, packageJson] = await Promise.all([
    read("../src/browser/voice-agent.js"),
    read("../package.json"),
  ]);

  assert.match(source, /from "@deepgram\/agents"/);
  assert.match(source, /VOICE_PROVIDER = "deepgram"/);
  assert.match(source, /model: "nova-3"/);
  assert.match(source, /THINKING_MODEL = "gpt-5\.6-terra"/);
  assert.match(source, /type: "open_ai"/);
  assert.match(source, /model: "flux-kit-en"/);
  assert.match(source, /user-started-speaking/);
  assert.match(packageJson, /"@deepgram\/agents"/);
  assert.match(packageJson, /"build:voice"/);
});

test("permanent Deepgram credentials remain server-side and audio retention stays off", async () => {
  const [api, deepgram, environment, browser, example] = await Promise.all([
    read("../src/api.ts"),
    read("../src/deepgram.ts"),
    read("../src/env.ts"),
    read("../public/personal-adapter.js"),
    read("../.env.example"),
  ]);

  assert.match(environment, /DEEPGRAM_API_KEY/);
  assert.match(deepgram, /https:\/\/api\.deepgram\.com\/v1\/auth\/grant/);
  assert.match(deepgram, /authorization: `Token \$\{env\.DEEPGRAM_API_KEY\}`/);
  assert.match(api, /voice-token/);
  assert.match(api, /attempt\.input_mode !== "voice"/);
  assert.match(api, /providerSessionId/);
  assert.match(browser, /name="inputMode" value="voice" checked/);
  assert.match(browser, /data-voice-toggle/);
  assert.match(browser, /voice-transcript/);
  assert.match(browser, /saveAudio: false/);
  assert.doesNotMatch(browser, /DEEPGRAM_API_KEY/);
  assert.match(example, /DEEPGRAM_API_KEY=/);
});
