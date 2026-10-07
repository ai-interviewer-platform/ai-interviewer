import { AgentMicrophone, AgentPlayer } from "@deepgram/agents";

export const VOICE_PROVIDER = "deepgram";
export const THINKING_MODEL = "gpt-5.6-luna";

// Browser microphone failures, by DOMException name, as guidance the candidate can act on.
const microphoneErrors = {
  NotAllowedError: "Microphone access is blocked. Allow it in your browser's site settings, then select Reconnect voice.",
  NotFoundError: "No microphone was found. Connect one, then select Reconnect voice.",
  NotReadableError: "Another app is using the microphone. Close it, then select Reconnect voice.",
  NotSupportedError: "This browser cannot use a microphone on this page. Try a current Chrome, Edge, Firefox or Safari.",
};

export function createDeepgramVoiceSession({ attempt, onStatus, onTranscript, onError }) {
  let starting = false;
  let cancelled = false;
  let microphone;
  let player;
  let socket;
  let keepAlive;
  const stop = () => {
    cancelled = true;
    starting = false;
    clearInterval(keepAlive);
    microphone?.stop(); microphone = undefined;
    const connection = socket; socket = undefined;
    connection?.close();
    player?.dispose(); player = undefined;
    onStatus("stopped");
  };
  const fail = error => { stop(); onError(error instanceof Error ? error : new Error("Voice connection ended.")); };
  const microphoneError = error => new Error(microphoneErrors[error?.name] ?? "The microphone could not start. Check the microphone permission of your browser, then select Reconnect voice.");
  return {
    async start() {
      if (socket || starting) return;
      cancelled = false;
      // Ask for the microphone before connecting, so a refusal spends no voice time.
      starting = true;
      onStatus("connecting");
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new DOMException("No media devices.", "NotSupportedError");
        const probe = await navigator.mediaDevices.getUserMedia({ audio: true });
        for (const track of probe.getTracks()) track.stop();
      } catch (error) { if (!cancelled) fail(microphoneError(error)); return; } finally { starting = false; }
      if (cancelled) return;
      player = new AgentPlayer({ sampleRate: 24000 });
      const url = new URL(`/api/attempts/${encodeURIComponent(attempt.id)}/voice`, location.origin);
      url.protocol = location.protocol === "https:" ? "wss:" : "ws:";
      const connection = new WebSocket(url);
      socket = connection;
      connection.binaryType = "arraybuffer";
      // The server refuses the upgrade when the voice allowance is used up or another connection is open.
      let opened = false;
      connection.onopen = () => { opened = true; };
      const ended = () => { if (socket === connection) fail(new Error(opened ? "Voice session ended. Your recorded transcript is saved." : "Voice could not connect. Your voice time may be used up, or voice is open in another tab. Try again later.")); };
      connection.onclose = ended;
      connection.onerror = ended;
      connection.onmessage = async ({ data }) => {
        if (socket !== connection) return;
        if (typeof data !== "string") { player?.queue(data); return; }
        try {
          const message = JSON.parse(data);
          if (message.type === "SettingsApplied") {
            const capture = new AgentMicrophone(frame => { if (socket?.readyState === WebSocket.OPEN) socket.send(frame); }, { sampleRate: 16000 });
            microphone = capture;
            capture.on("error", fail);
            await capture.start().catch(error => { throw microphoneError(error); });
            if (socket !== connection) { capture.stop(); return; }
            keepAlive = setInterval(() => { if (socket?.readyState === WebSocket.OPEN) socket.send('{"type":"KeepAlive"}'); }, 10000);
            onStatus("listening");
          } else if (message.type === "ConversationText") await onTranscript({ role: message.role, text: message.content });
          else if (message.type === "UserStartedSpeaking") { player?.interrupt(); onStatus("listening"); }
          else if (message.type === "AgentThinking") onStatus("thinking");
          else if (message.type === "AgentStartedSpeaking") onStatus("speaking");
          else if (message.type === "AgentAudioDone") onStatus("listening");
          else if (message.type === "Error") fail(new Error("Voice provider could not continue."));
        } catch (error) { fail(error); }
      };
    },
    stop,
    sendText(content) {
      if (socket?.readyState !== WebSocket.OPEN) throw new Error("Start voice before sending a message.");
      socket.send(JSON.stringify({ type: "InjectUserMessage", content }));
    },
    get active() { return Boolean(socket) || starting; },
  };
}
