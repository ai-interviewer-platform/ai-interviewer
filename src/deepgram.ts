import type { Env } from "./env";

export const DEEPGRAM_VOICE_PROVIDER = "deepgram";
export const DEEPGRAM_THINKING_MODEL = "gpt-5.6-terra";
export function deepgramVoiceEnabled(env: Env): boolean {
  return Boolean(env.DEEPGRAM_API_KEY?.trim() && env.VOICE_SESSIONS);
}
