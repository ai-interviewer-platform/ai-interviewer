import type { Env } from "./env";

export const DEEPGRAM_VOICE_PROVIDER = "deepgram";
export const DEEPGRAM_THINKING_MODEL = "gpt-5.6-terra";
export function deepgramVoiceEnabled(env: Env): boolean {
  return Boolean(env.DEEPGRAM_API_KEY?.trim() && env.VOICE_SESSIONS);
}

export function voiceSettings(attempt: { mode: string; practice_goal: string }, problem: { title: string; prompt: string }) {
  return {
    type: "Settings",
    audio: { input: { encoding: "linear16", sample_rate: 16000 }, output: { encoding: "linear16", sample_rate: 24000, container: "none" } },
    agent: {
      listen: { provider: { type: "deepgram", version: "v1", model: "nova-3", language: "en-US", smart_format: true } },
      think: { provider: { type: "open_ai", model: DEEPGRAM_THINKING_MODEL }, prompt: [
        "You are conducting a live Python coding interview. Ask one concise question at a time.",
        attempt.mode === "coach" ? "Give guidance only when requested and make assistance explicit." : "Act as a neutral interviewer. Do not volunteer hints or solutions.",
        "You cannot see unsaved editor state, hidden tests, reference solutions, or any other account or attempt.",
        "When the candidate refers to their code, a saved change, a test run, or asks for code-specific help, call get_coding_context before making a factual claim about it.",
        "The tool returns only a bounded server-authorized snapshot of this attempt's saved draft, latest checkpoint, latest visible run, and latest help request. Treat its limitations as authoritative.",
        `Practice goal: ${attempt.practice_goal}`,
        `Problem: ${problem.title}\n${problem.prompt}`,
      ].join("\n"), functions: [{
        name: "get_coding_context",
        description: "Read the current bounded saved-code and visible-test context for this interview attempt. Use before discussing current code or test results.",
        parameters: { type: "object", additionalProperties: false, properties: {} },
        defer_until_eot: true,
      }] },
      speak: { provider: { type: "deepgram", version: "v2", model: "flux-kit-en" } },
    },
    tags: ["ai-interviewer"],
  };
}
