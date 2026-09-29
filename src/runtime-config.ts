import type { Env } from "./env";
import { deepgramVoiceEnabled } from "./deepgram";
import { pythonRunnerConfigured } from "./python-runner-client";
import { reviewProviderConfigured } from "./review-provider";
import { configuredApplicationOrigin } from "./origin";

export function runtimeCapabilities(env: Env) {
  const capabilities = {
    collectionPolicyApproved: env.PERSONAL_DATA_COLLECTION_APPROVED === "true",
    originConfigured: configuredApplicationOrigin(env.BETTER_AUTH_URL) !== null,
    authConfigured: Boolean(env.BETTER_AUTH_SECRET?.trim()),
    databaseConfigured: Boolean(env.HYPERDRIVE?.connectionString || env.DATABASE_URL?.trim()),
    voiceConfigured: deepgramVoiceEnabled(env),
    runnerConfigured: pythonRunnerConfigured(env),
    reviewConfigured: reviewProviderConfigured(env),
    reviewQueueConfigured: Boolean(env.REVIEW_QUEUE?.send),
  };
  return { ...capabilities, mvpReady: Object.values(capabilities).every(Boolean) };
}
