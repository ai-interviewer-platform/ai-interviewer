import { AgentMicrophone, AgentPlayer, AgentSession } from "@deepgram/agents";

export const VOICE_PROVIDER = "deepgram";
export const THINKING_MODEL = "gpt-5.6-terra";

function interviewerPrompt({ attempt, problem }) {
  const modeInstruction = attempt.mode === "coach"
    ? "Give concise guidance only when the candidate asks for it, and make that assistance explicit."
    : "Act as a neutral interviewer. Clarify the prompt when asked, but do not volunteer hints or a solution.";

  return [
    "You are conducting a live Python coding interview.",
    modeInstruction,
    "Ask one focused question at a time and keep every spoken reply concise and natural.",
    "Do not claim that you can see code, test output, or hidden evidence. Ask the candidate to explain those details aloud.",
    "Do not reveal hidden tests or a reference solution.",
    `Practice goal: ${attempt.practice_goal}.`,
    `Problem title: ${problem.title}.`,
    `Problem statement: ${problem.prompt}`,
  ].join("\n");
}

export function createDeepgramVoiceSession({ attempt, problem, getToken, onStatus, onTranscript, onError }) {
  let microphone;
  let player;
  let session;
  let transcriptQueue = Promise.resolve();

  const stop = () => {
    microphone?.stop();
    microphone = undefined;
    session?.disconnect();
    session = undefined;
    player?.dispose();
    player = undefined;
    onStatus("stopped");
  };

  const fail = (error) => {
    const normalized = error instanceof Error ? error : new Error("The voice session stopped unexpectedly.");
    stop();
    onError(normalized);
  };

  const start = async () => {
    if (session) return;

    player = new AgentPlayer({ sampleRate: 24_000 });
    session = new AgentSession({
      auth: { tokenFactory: getToken },
      agent: {
        listen: {
          provider: {
            type: "deepgram",
            version: "v1",
            model: "nova-3",
            language: "en-US",
            smart_format: true,
          },
        },
        think: {
          provider: {
            type: "open_ai",
            model: THINKING_MODEL,
          },
          prompt: interviewerPrompt({ attempt, problem }),
        },
        speak: {
          provider: {
            type: "deepgram",
            version: "v2",
            model: "flux-kit-en",
          },
        },
      },
      audio: {
        input: { encoding: "linear16", sampleRate: 16_000 },
        output: { encoding: "linear16", sampleRate: 24_000 },
      },
      tags: ["ai-interviewer"],
    });

    session.on("connecting", () => onStatus("connecting"));
    session.on("settings-applied", () => onStatus("listening"));
    session.on("reconnecting", () => onStatus("reconnecting"));
    session.on("agent-thinking", () => onStatus("thinking"));
    session.on("agent-started-speaking", () => onStatus("speaking"));
    session.on("agent-audio-done", () => onStatus("listening"));
    session.on("user-started-speaking", () => {
      player?.interrupt();
      onStatus("listening");
    });
    session.on("audio", (chunk) => player?.queue(chunk));
    session.on("conversation-text", (message) => {
      transcriptQueue = transcriptQueue
        .then(() => onTranscript({
          role: message.role,
          text: message.content,
          providerSessionId: session?.getId(),
        }))
        .catch(fail);
    });
    session.on("sdk-error", fail);
    session.on("error", () => fail(new Error("Deepgram could not continue the voice session.")));

    microphone = new AgentMicrophone((data) => session?.sendAudio(data), {
      sampleRate: 16_000,
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    });
    microphone.on("error", fail);

    try {
      await session.connect();
      await microphone.start();
    } catch (error) {
      fail(error);
      throw error;
    }
  };

  return {
    start,
    stop,
    sendText(content) {
      if (!session) throw new Error("Start voice before sending a message to the interviewer.");
      session.injectUserMessage(content);
    },
    get active() {
      return Boolean(session);
    },
  };
}
