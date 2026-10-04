import { ModelError, REVIEW_MODEL, modelText } from "../llm";
import {
  PermanentReviewError,
  reviewInstructions,
  reviewLimits,
  reviewSchemaFor,
  TransientReviewError,
  type ReviewGenerationRequest,
  type ReviewProvider,
} from "../review-provider";

export class WorkersAIReviewProvider implements ReviewProvider {
  readonly evaluatorVersion = `workers-ai/evidence-v1/${REVIEW_MODEL}`;

  constructor(private readonly ai: Ai) {}

  async generate({ payload, allowedEvidenceIds }: ReviewGenerationRequest): Promise<unknown> {
    let text: string;
    try {
      // Reasoning off keeps the call well inside the timeout; the schema and prompt carry the rules.
      text = await modelText(this.ai, REVIEW_MODEL, {
        max_completion_tokens: 6000,
        reasoning_effort: "none",
        response_format: { type: "json_schema", json_schema: { name: "interview_review", strict: true, schema: reviewSchemaFor(allowedEvidenceIds) } },
        messages: [{ role: "system", content: reviewInstructions }, { role: "user", content: payload }],
      }, { attempts: 1, timeoutMs: reviewLimits.timeoutMs });
    } catch (error) {
      if (error instanceof ModelError && !error.retryable) throw new PermanentReviewError(`Review provider did not complete a structured response (${error.message}); no findings were published.`);
      throw new TransientReviewError("Review provider is temporarily unavailable.");
    }
    try { return JSON.parse(text); } catch { throw new PermanentReviewError("Review findings were not valid JSON."); }
  }
}
