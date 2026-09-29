import { DurableObject } from "cloudflare:workers";
import { withTimeline } from "./attempt-timeline";
import { databaseForInvocation } from "./database";
import { DEEPGRAM_VOICE_PROVIDER, voiceSettings } from "./deepgram";
import type { Env } from "./env";
import { json } from "./http";
import { limits } from "./security";
import { loadVoiceCodingContext } from "./voice-context";
import { releaseVoice, reserveVoice } from "./voice-budget";
import { logOperationalEvent } from "./observability";

// One voice connection: the Voice reservation, the relay between the browser and
// Deepgram, the coding-context function calls, the Transcript segments, and cleanup.
export class VoiceSession extends DurableObject<Env> {
  private active = false;
  private closeSession?: () => void;

  async alarm() { this.closeSession?.(); }

  async fetch(request: Request): Promise<Response> {
    if (this.active) return json({ error: "Voice is already connected." }, { status: 409 });
    if (!this.env.DEEPGRAM_API_KEY) return json({ error: "Voice is unavailable." }, { status: 503 });
    this.active = true;
    const pool = databaseForInvocation(this.env);
    let connected = false;
    try {
      const reserved = await reserveVoice(pool, request.headers.get("x-attempt-id"), request.headers.get("x-user-id"));
      if (reserved.status === "attempt unavailable") return json({ error: "Attempt unavailable." }, { status: 403 });
      if (reserved.status === "exhausted") {
        logOperationalEvent("info", "voice_allocation_rejected");
        return json({ error: "Voice allocation is exhausted or another connection is active." }, { status: 429 });
      }
      const { attempt, reservation } = reserved;
      const reservationId = reservation.id;
      const problem = (await pool.query<{ title: string; prompt: string }>("SELECT title, prompt FROM problems WHERE id = $1", [attempt.problem_id])).rows[0];

      const started = Date.now();
      const deadline = reservation.expiresAt.getTime();
      await this.ctx.storage.setAlarm(deadline);
      const upstream = await fetch("https://agent.deepgram.com/v1/agent/converse", {
        headers: { Upgrade: "websocket", Authorization: `Token ${this.env.DEEPGRAM_API_KEY}` },
      });
      const provider = upstream.webSocket;
      if (!provider || Date.now() >= deadline) { provider?.close(); throw new Error("Voice connection failed."); }
      const pair = new WebSocketPair();
      const browser = pair[1];
      provider.accept(); browser.accept();
      let closed = false;
      let order = 0;
      let queued = 0;
      let audioBytes = 0;
      let commands = 0;
      let functionCalls = 0;
      let providerSessionId = reservationId;
      let writes = Promise.resolve();
      const cancelledFunctions = new Set<string>();
      let timer: ReturnType<typeof setTimeout>;
      const close = () => {
        if (closed) return;
        closed = true;
        clearTimeout(timer);
        provider.close(1000, "Session ended"); browser.close(1000, "Session ended");
        this.active = false;
        this.closeSession = undefined;
        this.ctx.waitUntil(writes.finally(async () => {
          await releaseVoice(pool, reservationId);
          await pool.end();
        }));
      };
      this.closeSession = close;
      timer = setTimeout(close, Math.max(0, deadline - Date.now()));
      browser.addEventListener("message", event => {
        if (closed || Date.now() >= deadline) return close();
        if (typeof event.data !== "string") {
          audioBytes += event.data.byteLength;
          // 16 kHz signed 16-bit mono, with two seconds of capture jitter.
          if (audioBytes > 32000 * ((Date.now() - started) / 1000 + 2)) return close();
          provider.send(event.data); return;
        }
        if (event.data.length > limits.textBytes || ++commands > limits.voiceCommands) return close();
        try {
          const message = JSON.parse(event.data);
          if (message.type === "KeepAlive") provider.send('{"type":"KeepAlive"}');
          else if (message.type === "InjectUserMessage" && typeof message.content === "string" && new TextEncoder().encode(message.content).length <= limits.textBytes) {
            provider.send(JSON.stringify({ type: "InjectUserMessage", content: message.content }));
          } else close();
        } catch { close(); }
      });
      provider.addEventListener("message", event => {
        if (closed || Date.now() >= deadline) return close();
        if (typeof event.data !== "string") { browser.send(event.data); return; }
        try {
          const message = JSON.parse(event.data);
          if (message.type === "Welcome") {
            providerSessionId = message.request_id ?? reservationId;
            provider.send(JSON.stringify(voiceSettings(attempt, problem)));
          }
          if (message.type === "FunctionCallCancelled" && Array.isArray(message.functions)) {
            for (const fn of message.functions) if (typeof fn === "object" && fn !== null && typeof fn.id === "string") cancelledFunctions.add(fn.id);
          } else if (message.type === "FunctionCallRequest") {
            if (!Array.isArray(message.functions) || message.functions.length === 0 || message.functions.length > 4) return close();
            for (const fn of message.functions) {
              if (typeof fn !== "object" || fn === null || fn.name !== "get_coding_context" || fn.client_side !== true
                || typeof fn.id !== "string" || fn.id.length > 256 || ++functionCalls > limits.voiceFunctionCalls) return close();
              writes = writes.then(async () => {
                const context = await loadVoiceCodingContext(pool, attempt.id, attempt.user_id);
                if (!context || cancelledFunctions.has(fn.id) || closed) return;
                const response = { type: "FunctionCallResponse", id: fn.id, name: fn.name, content: context,
                  ...(typeof fn.thought_signature === "string" && fn.thought_signature.length <= 1024 ? { thought_signature: fn.thought_signature } : {}) };
                provider.send(JSON.stringify(response));
              }).catch(close);
            }
          } else if (message.type === "ConversationText") {
            if (typeof message.content !== "string" || new TextEncoder().encode(message.content).length > limits.textBytes || ++queued > limits.pendingTranscripts) return close();
            if (message.role !== "user" && message.role !== "assistant") return close();
            const role: "user" | "assistant" = message.role;
            const envelope = { sourceId: `${reservationId}:${++order}`, sourceOrder: order, occurrenceOffsetMs: Date.now() - Date.parse(attempt.created_at) };
            const payload = { verified: true, inputMode: "voice", provider: DEEPGRAM_VOICE_PROVIDER, providerSessionId, role };
            const text: string = message.content;
            writes = writes.then(async () => {
              const recorded = await withTimeline(pool, attempt.id, (timeline) => timeline.record(
                role === "user" ? "candidate_voice" : "interviewer_voice", envelope, payload,
                { transcript: { speaker: role === "user" ? "candidate" : "interviewer", text } },
              ));
              if (recorded.status !== "recorded") throw new Error("Transcript rejected.");
              queued--;
              if (!closed) browser.send(event.data);
            }).catch(close);
          } else browser.send(event.data);
        } catch { close(); }
      });
      for (const socket of [provider, browser]) {
        socket.addEventListener("close", close);
        socket.addEventListener("error", close);
      }
      connected = true;
      return new Response(null, { status: 101, webSocket: pair[0] });
    } catch { logOperationalEvent("warn", "voice_connection_failed"); return json({ error: "Voice could not connect." }, { status: 503 }); }
    finally { if (!connected) { this.active = false; await pool.end(); } }
  }
}
