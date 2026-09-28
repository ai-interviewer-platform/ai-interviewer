import type { Env } from "../env";
import { REVIEW_MODEL, modelText } from "../llm";
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

// Enumerating the attempt's own evidence IDs lets constrained decoding rule out
// foreign or invented citations; validateFindings still checks every one.
function schemaFor(allowed: Set<string>) {
  const schema = structuredClone(reviewOutputSchema);
  schema.properties.findings.items.properties.evidenceIds.items = { type: "string", enum: [...allowed] } as { type: string };
  return schema;
}

export class WorkersAIReviewProvider implements ReviewProvider {
  readonly evaluatorVersion = `workers-ai/evidence-v1/${REVIEW_MODEL}`;

  constructor(private readonly ai: Ai) {}

  async generate({ payload, allowedEvidenceIds }: ReviewGenerationRequest): Promise<Finding[]> {
    let text: string;
    try {
      // Reasoning off keeps the call well inside the timeout; the schema and prompt carry the rules.
      text = await modelText(this.ai, REVIEW_MODEL, {
        max_completion_tokens: 6000,
        reasoning_effort: "none",
        response_format: { type: "json_schema", json_schema: { name: "interview_review", strict: true, schema: schemaFor(allowedEvidenceIds) } },
        messages: [{ role: "system", content: reviewInstructions }, { role: "user", content: payload }],
      }, { attempts: 1, timeoutMs: reviewLimits.timeoutMs });
    } catch (error) {
      // Truncated, filtered, or empty output will not improve on retry; outages and timeouts may.
      if (error instanceof Error && /stopped with|returned no text/.test(error.message)) throw new PermanentReviewError(`Review provider did not complete a structured response (${error.message}); no findings were published.`);
      throw new TransientReviewError("Review provider is temporarily unavailable.");
    }
    let value: unknown;
    try { value = JSON.parse(text); } catch { throw new PermanentReviewError("Review findings were not valid JSON."); }
    return validateFindings(value, allowedEvidenceIds);
  }
}

export function workersAIProvider(env: Env): ReviewProvider {
  if (!env.AI) throw new PermanentReviewError("Review provider is not configured; no findings were generated.");
  return new WorkersAIReviewProvider(env.AI);
}
