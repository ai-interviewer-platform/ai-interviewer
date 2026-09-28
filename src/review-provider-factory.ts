import type { Env } from "./env";
import { PermanentReviewError, type ReviewProvider } from "./review-provider";
import { openAIResponsesProvider } from "./review-providers/openai-responses";
import { workersAIProvider } from "./review-providers/workers-ai";

// An explicit REVIEW_PROVIDER wins. Otherwise the Workers AI binding is used when
// present (production), and OpenAI Responses with its key and model otherwise.
function selectedProvider(env: Env): string {
  return env.REVIEW_PROVIDER?.trim() || (env.AI ? "workers-ai" : "openai-responses");
}

export function reviewProviderConfigured(env: Env): boolean {
  const provider = selectedProvider(env);
  if (provider === "workers-ai") return Boolean(env.AI);
  return provider === "openai-responses"
    && Boolean(env.REVIEW_PROVIDER_API_KEY?.trim() && env.REVIEW_PROVIDER_MODEL?.trim() && env.REVIEW_PROVIDER_MODEL.length <= 200);
}

export function reviewProviderFor(env: Env): ReviewProvider {
  const provider = selectedProvider(env);
  if (provider === "workers-ai") return workersAIProvider(env);
  if (provider === "openai-responses") return openAIResponsesProvider(env);
  throw new PermanentReviewError("The configured review provider is unsupported; no findings were generated.");
}
