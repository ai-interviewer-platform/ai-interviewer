import Anthropic from "@anthropic-ai/sdk";

// Owner decision 2026-09-28: Opus for review quality, Sonnet for live text turns.
export const REVIEW_MODEL = "claude-opus-5-5";
export const INTERVIEWER_MODEL = "claude-sonnet-5";

// Returns the text of a completed response. Refusals, truncation, and empty
// output throw, so callers never publish a partial or substituted answer.
export async function claudeText(apiKey: string, params: Anthropic.MessageCreateParamsNonStreaming, options: { maxRetries: number; timeoutMs: number }): Promise<string> {
  // The client reads globalThis.fetch when it is constructed.
  const client = new Anthropic({ apiKey, maxRetries: options.maxRetries, timeout: options.timeoutMs });
  const response = await client.messages.create(params);
  if (response.stop_reason !== "end_turn") throw new Error(`the model stopped with ${response.stop_reason ?? "no stop reason"}`);
  const text = response.content.flatMap((block) => block.type === "text" ? [block.text] : []).join("").trim();
  if (!text) throw new Error("the model returned no text");
  return text;
}

// A short reason that is safe to store and show; it never includes provider bodies.
export function providerFailure(error: unknown): string {
  if (error instanceof Anthropic.APIError) return error.status ? `provider HTTP ${error.status}` : "provider connection failed";
  return error instanceof Error ? error.message : "unknown provider failure";
}
