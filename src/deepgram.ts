import type { Env } from "./env";
import { json, serverUnavailable } from "./http";

type DeepgramGrant = {
  access_token?: unknown;
  expires_in?: unknown;
};

export const DEEPGRAM_VOICE_PROVIDER = "deepgram";
export const DEEPGRAM_THINKING_MODEL = "gpt-5.6-terra";

export function deepgramVoiceEnabled(env: Env): boolean {
  return Boolean(env.DEEPGRAM_API_KEY?.trim());
}

export async function grantDeepgramAccessToken(env: Env): Promise<Response> {
  if (!deepgramVoiceEnabled(env)) {
    return serverUnavailable("Deepgram voice is not configured.");
  }

  let response: Response;
  try {
    response = await fetch("https://api.deepgram.com/v1/auth/grant", {
      method: "POST",
      headers: {
        authorization: `Token ${env.DEEPGRAM_API_KEY}`,
        "content-type": "application/json",
      },
      body: "{}",
    });
  } catch {
    return serverUnavailable("Deepgram could not issue a voice-session token.");
  }

  if (!response.ok) {
    return serverUnavailable("Deepgram rejected the voice-session token request.");
  }

  const grant = await response.json() as DeepgramGrant;
  if (typeof grant.access_token !== "string" || !grant.access_token || typeof grant.expires_in !== "number") {
    return serverUnavailable("Deepgram returned an invalid voice-session token.");
  }

  return json({ accessToken: grant.access_token, expiresIn: grant.expires_in });
}
