import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { build } from "esbuild";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";

// Real workerd WebSockets and production relay; database and provider are fixtures.
// This catches runtime Blob-to-text conversion that a JavaScript socket mock misses.
test("voice relay preserves binary PCM in both directions and text control frames", async () => {
  const config = await readFile("wrangler.jsonc", "utf8");
  const compatibilityDate = config.match(/"compatibility_date":\s*"([^"]+)"/)[1];
  const fixtures = {
    "./database": `export const databaseForInvocation = () => ({
      query: async () => ({ rows: [{ title: "Fixture", prompt: "Explain the solution." }] }),
      end: async () => {},
    });`,
    "./voice-budget": `import { limits } from "./security";
      export const reserveVoice = async () => ({ status: "reserved",
        reservation: { id: "reservation", expiresAt: new Date(Date.now() + limits.voiceSeconds * 1000) },
        attempt: { id: "attempt", user_id: "user", problem_id: "problem", mode: "mock", created_at: new Date().toISOString() },
      });
      export const releaseVoice = async () => {};`,
    "./attempt-timeline": "export const withTimeline = async () => { throw new Error('Unexpected transcript'); };",
    "./interviewer-turn": `export const loadCodingContext = async () => { throw new Error('Unexpected context request'); };
      export const interviewerRules = () => { throw new Error('Unexpected settings request'); };`,
  };
  const bundle = await build({
    stdin: { contents: `export { VoiceSession } from "./src/voice-session.ts";
      export default { fetch(request, env) { return env.VOICE_SESSIONS.getByName("fixture").fetch(request); } };`, resolveDir: process.cwd() },
    bundle: true, format: "esm", platform: "neutral", write: false, external: ["cloudflare:workers"],
    plugins: [{ name: "voice-fixtures", setup(plugin) {
      plugin.onResolve({ filter: /^\.\/(database|voice-budget|attempt-timeline|interviewer-turn)$/ }, args => ({ path: args.path, namespace: "fixture" }));
      plugin.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({ contents: fixtures[args.path], resolveDir: `${process.cwd()}/src` }));
    } }],
  });
  const runtime = new Miniflare(convertV4MiniflareOptions({ workers: [
    { name: "relay", modules: true, compatibilityDate, script: bundle.outputFiles[0].text,
      durableObjects: { VOICE_SESSIONS: "VoiceSession" },
      bindings: { DEEPGRAM_API_KEY: "fictional-key" }, outboundService: "provider" },
    { name: "provider", modules: true, compatibilityDate, script: `export default { fetch() {
      const pair = new WebSocketPair();
      const socket = pair[1];
      socket.binaryType = "arraybuffer";
      socket.accept();
      socket.addEventListener("message", event => socket.send(event.data));
      return new Response(null, { status: 101, webSocket: pair[0] });
    } };` },
  ] }));
  try {
    const response = await runtime.dispatchFetch("http://localhost/voice", { headers: { Upgrade: "websocket" } });
    assert.equal(response.status, 101);
    const socket = response.webSocket;
    socket.accept();
    const roundTrip = data => new Promise((resolve, reject) => {
      socket.addEventListener("message", event => resolve(event.data), { once: true });
      socket.addEventListener("error", reject, { once: true });
      socket.addEventListener("close", () => reject(new Error("Relay closed before returning the frame")), { once: true });
      socket.send(data);
    });
    const pcm = new Int16Array([0, 32767, -32768, 1234, -1234]);
    const received = await roundTrip(pcm.buffer);
    assert.ok(received instanceof ArrayBuffer, `PCM must remain binary, received ${String(received)}`);
    assert.deepEqual(new Int16Array(received), pcm);
    assert.equal(await roundTrip('{"type":"KeepAlive"}'), '{"type":"KeepAlive"}');
    socket.close();
  } finally { await runtime.dispose(); }
});
