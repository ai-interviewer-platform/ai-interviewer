import { AgentMicrophone, AgentPlayer } from "@deepgram/agents";

export const VOICE_PROVIDER = "deepgram";
export const THINKING_MODEL = "gpt-5.6-terra";

export function createDeepgramVoiceSession({ attempt, onStatus, onTranscript, onError }) {
  let microphone;
  let player;
  let socket;
  let keepAlive;
  const stop = () => {
    clearInterval(keepAlive);
    microphone?.stop(); microphone = undefined;
    const connection = socket; socket = undefined;
    connection?.close();
    player?.dispose(); player = undefined;
    onStatus("stopped");
  };
  const fail = error => { stop(); onError(error instanceof Error ? error : new Error("Voice connection ended.")); };
  return {
    async start() {
      if (socket) return;
      onStatus("connecting");
      player = new AgentPlayer({ sampleRate: 24000 });
      const url = new URL(`/api/attempts/${encodeURIComponent(attempt.id)}/voice`, location.origin);
      url.protocol = location.protocol === "https:" ? "wss:" : "ws:";
      const connection = new WebSocket(url);
      socket = connection;
      connection.binaryType = "arraybuffer";
      connection.onclose = () => { if (socket === connection) fail(new Error("Voice session ended. Your recorded transcript is saved.")); };
      connection.onerror = fail;
      connection.onmessage = async ({ data }) => {
        if (socket !== connection) return;
        if (typeof data !== "string") { player?.queue(data); return; }
        try {
          const message = JSON.parse(data);
          if (message.type === "SettingsApplied") {
            const capture = new AgentMicrophone(frame => { if (socket?.readyState === WebSocket.OPEN) socket.send(frame); }, { sampleRate: 16000 });
            microphone = capture;
            capture.on("error", fail);
            await capture.start();
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
    get active() { return Boolean(socket); },
  };
}
