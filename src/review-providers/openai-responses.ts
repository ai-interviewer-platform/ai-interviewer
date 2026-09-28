import type { Env } from "../env";
import { isRecord } from "../http";
import {
  PermanentReviewError,
  reviewInstructions,
  reviewLimits,
  reviewOutputSchema,
  TransientReviewError,
  validateFindings,
  type Finding,
  type ReviewGenerationRequest,
  type ReviewProvider,
} from "../review-provider";

async function boundedText(response: Response): Promise<string> {
  if (!response.body) throw new PermanentReviewError("Review provider returned an empty response.");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > reviewLimits.responseBytes) {
        void reader.cancel().catch(() => {});
        throw new PermanentReviewError("Review provider response exceeded 64 KiB; no findings were published.");
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return new TextDecoder().decode(bytes);
}

function normalizeEnvelope(raw: string, allowed: Set<string>): Finding[] {
  let envelope: unknown;
  try { envelope = JSON.parse(raw); } catch { throw new PermanentReviewError("Review provider returned malformed JSON."); }
  if (!isRecord(envelope) || envelope.status !== "completed" || !Array.isArray(envelope.output)) throw new PermanentReviewError("Review provider did not return a completed structured response.");
  const texts: string[] = [];
  for (const output of envelope.output) {
    if (!isRecord(output)) throw new PermanentReviewError("Review provider returned an invalid output envelope.");
    if (output.type === "reasoning") continue;
    if (output.type !== "message" || output.role !== "assistant" || !Array.isArray(output.content)) throw new PermanentReviewError("Review provider returned an unsupported output.");
    for (const content of output.content) {
      if (!isRecord(content) || content.type !== "output_text" || typeof content.text !== "string") throw new PermanentReviewError("Review provider refused or returned unsupported content.");
      texts.push(content.text);
    }
  }
  if (texts.length !== 1) throw new PermanentReviewError("Review provider did not return one structured result.");
  let value: unknown;
  try { value = JSON.parse(texts[0]); } catch { throw new PermanentReviewError("Review findings were not valid JSON."); }
  return validateFindings(value, allowed);
}

export class OpenAIResponsesReviewProvider implements ReviewProvider {
  readonly evaluatorVersion: string;

  constructor(private readonly apiKey: string, private readonly model: string) {
    this.evaluatorVersion = `openai-responses/evidence-v1/${model}`;
  }

  async generate({ payload, allowedEvidenceIds }: ReviewGenerationRequest): Promise<Finding[]> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => { controller.abort(); reject(new TransientReviewError("Review provider timed out.")); }, reviewLimits.timeoutMs);
    });
    try {
      return await Promise.race([deadline, (async () => {
        const response = await fetch("https://api.openai.com/v1/responses", {
          method: "POST", redirect: "error", signal: controller.signal,
          headers: { "content-type": "application/json", authorization: `Bearer ${this.apiKey}` },
          body: JSON.stringify({ model: this.model, store: false, max_output_tokens: 6000, instructions: reviewInstructions,
            input: payload, text: { format: { type: "json_schema", name: "interview_review", strict: true, schema: reviewOutputSchema } },
          }),
        });
        if (!response.ok) {
          void response.body?.cancel().catch(() => {});
          if ([408, 409, 429].includes(response.status) || response.status >= 500) throw new TransientReviewError("Review provider is temporarily unavailable.");
          throw new PermanentReviewError("Review provider rejected the request; check server credentials, model access, and structured-output support.");
        }
        return normalizeEnvelope(await boundedText(response), allowedEvidenceIds);
      })()]);
    } catch (error) {
      if (error instanceof PermanentReviewError || error instanceof TransientReviewError) throw error;
      throw new TransientReviewError("Review provider connection failed.");
    } finally { clearTimeout(timer); }
  }
}

export function openAIResponsesProvider(env: Env): ReviewProvider {
  if (!env.REVIEW_PROVIDER_API_KEY?.trim() || !env.REVIEW_PROVIDER_MODEL?.trim()) throw new PermanentReviewError("Review provider is not configured; no findings were generated.");
  if (env.REVIEW_PROVIDER_MODEL.length > 200) throw new PermanentReviewError("Review model configuration is invalid.");
  return new OpenAIResponsesReviewProvider(env.REVIEW_PROVIDER_API_KEY, env.REVIEW_PROVIDER_MODEL);
}
