import type { Env } from "./env";
import { PermanentReviewError, type ReviewProvider } from "./review-provider";
import { openAIResponsesProvider } from "./review-providers/openai-responses";

export const DEFAULT_REVIEW_PROVIDER = "openai-responses";

export function reviewProviderConfigured(env: Env): boolean {
  const provider = env.REVIEW_PROVIDER?.trim() || DEFAULT_REVIEW_PROVIDER;
  return provider === DEFAULT_REVIEW_PROVIDER
    && Boolean(env.REVIEW_PROVIDER_API_KEY?.trim() && env.REVIEW_PROVIDER_MODEL?.trim() && env.REVIEW_PROVIDER_MODEL.length <= 200);
}

export function reviewProviderFor(env: Env): ReviewProvider {
  const provider = env.REVIEW_PROVIDER?.trim() || DEFAULT_REVIEW_PROVIDER;
  if (provider === DEFAULT_REVIEW_PROVIDER) return openAIResponsesProvider(env);
  throw new PermanentReviewError("The configured review provider is unsupported; no findings were generated.");
}
