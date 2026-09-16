import { DurableObject } from "cloudflare:workers";
import { appendVoiceTranscript, type AttemptRow } from "./api";
import { databaseForInvocation } from "./database";
import { voiceSettings } from "./deepgram";
import type { Env } from "./env";
import { json } from "./http";
import { limits } from "./security";

export class VoiceSession extends DurableObject<Env> {
  private active = false;
  private closeSession?: () => void;

  async alarm() { this.closeSession?.(); }

  async fetch(request: Request): Promise<Response> {
    if (this.active) return json({ error: "Voice is already connected." }, { status: 409 });
    if (!this.env.DEEPGRAM_API_KEY) return json({ error: "Voice is unavailable." }, { status: 503 });
    this.active = true;
    const pool = databaseForInvocation(this.env);
    const reservationId = crypto.randomUUID();
    let connected = false;
    try {
      const client = await pool.connect();
      let attempt: AttemptRow;
      let problem: { title: string; prompt: string };
      try {
        await client.query("BEGIN");
        // ponytail: project budget serializes reservations; shard only when contention requires it.
        await client.query("SELECT pg_advisory_xact_lock(hashtext('voice-project-budget'))");
        await client.query("DELETE FROM voice_reservations WHERE expires_at <= now() AND started_at < date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'");
        const owned = await client.query<AttemptRow>("SELECT * FROM attempts WHERE id = $1 AND user_id = $2 AND input_mode = 'voice' AND status <> 'completed' FOR UPDATE", [request.headers.get("x-attempt-id"), request.headers.get("x-user-id")]);
        if (!owned.rows[0]) { await client.query("ROLLBACK"); return json({ error: "Attempt unavailable." }, { status: 403 }); }
        attempt = owned.rows[0];
        const usage = await client.query<{ account_seconds: number; project_seconds: number; active: boolean }>(
          `SELECT COALESCE(sum(reserved_seconds) FILTER (WHERE user_id = $1), 0)::int AS account_seconds,
            COALESCE(sum(reserved_seconds), 0)::int AS project_seconds,
            COALESCE(bool_or(user_id = $1 AND expires_at > now()), false) AS active
           FROM voice_reservations WHERE started_at >= date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'
             OR expires_at > now()`, [attempt.user_id]);
        const budget = usage.rows[0];
        if (budget.active || budget.account_seconds + limits.voiceSeconds > limits.accountVoiceSeconds || budget.project_seconds + limits.voiceSeconds > limits.projectVoiceSeconds) {
          await client.query("ROLLBACK"); return json({ error: "Voice allocation is exhausted or another connection is active." }, { status: 429 });
        }
        await client.query("INSERT INTO voice_reservations (id, user_id, attempt_id, expires_at, reserved_seconds) VALUES ($1, $2, $3, now() + $4 * interval '1 second', $4)", [reservationId, attempt.user_id, attempt.id, limits.voiceSeconds]);
        const result = await client.query<{ title: string; prompt: string }>("SELECT title, prompt FROM problems WHERE id = $1", [attempt.problem_id]);
        problem = result.rows[0];
        await client.query("COMMIT");
      } catch (error) { await client.query("ROLLBACK"); throw error; }
      finally { client.release(); }

      const started = Date.now();
      const reservation = await pool.query<{ expires_at: Date }>("SELECT expires_at FROM voice_reservations WHERE id = $1", [reservationId]);
      const deadline = new Date(reservation.rows[0].expires_at).getTime();
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
      let providerSessionId = reservationId;
      let writes = Promise.resolve();
      let timer: ReturnType<typeof setTimeout>;
      const close = () => {
        if (closed) return;
        closed = true;
        clearTimeout(timer);
        provider.close(1000, "Session ended"); browser.close(1000, "Session ended");
        this.active = false;
        this.closeSession = undefined;
        this.ctx.waitUntil(writes.finally(async () => {
          await pool.query("UPDATE voice_reservations SET expires_at = now() WHERE id = $1", [reservationId]);
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
          if (message.type === "ConversationText") {
            if (typeof message.content !== "string" || new TextEncoder().encode(message.content).length > limits.textBytes || ++queued > limits.pendingTranscripts) return close();
            const body = { role: message.role, text: message.content, providerSessionId, sourceId: `${reservationId}:${++order}`, sourceOrder: order, occurrenceOffsetMs: Date.now() - Date.parse(attempt.created_at) };
            writes = writes.then(async () => {
              const result = await appendVoiceTranscript(pool, attempt, body);
              if (!result.ok) throw new Error("Transcript rejected.");
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
    } catch { return json({ error: "Voice could not connect." }, { status: 503 }); }
    finally { if (!connected) { this.active = false; await pool.end(); } }
  }
}
