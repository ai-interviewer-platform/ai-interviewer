import { isRecord } from "./http";

export const reviewLimits = { evidenceBytes: 192 * 1024, events: 200, responseBytes: 64 * 1024, findings: 8, references: 8, timeoutMs: 45_000 };
export const evidenceStatuses = ["reproducible_observation", "supported_interpretation", "tentative_interpretation", "insufficient_evidence"] as const;
export class PermanentReviewError extends Error {}
export class TransientReviewError extends Error {}
export type Finding = {
  observation: string; interpretation: string | null; limitations: string;
  suggested_action: string | null; criterion: string | null;
  evidence_status: typeof evidenceStatuses[number]; evidenceIds: string[];
};
export type ReviewGenerationRequest = { payload: string; allowedEvidenceIds: Set<string> };
export interface ReviewProvider {
  readonly evaluatorVersion: string;
  generate(request: ReviewGenerationRequest): Promise<Finding[]>;
}
const fieldLimits = { observation: 500, interpretation: 2000, limitations: 1000, suggested_action: 1000, criterion: 200 };
const nullable = new Set(["interpretation", "suggested_action", "criterion"]);
const properties = {
  ...Object.fromEntries(Object.entries(fieldLimits).map(([key, maxLength]) => [key, { type: nullable.has(key) ? ["string", "null"] : "string", minLength: 1, maxLength }])),
  evidence_status: { type: "string", enum: evidenceStatuses },
  evidenceIds: { type: "array", minItems: 1, maxItems: reviewLimits.references, items: { type: "string" } },
};
export const reviewOutputSchema = { type: "object", additionalProperties: false, required: ["findings"], properties: {
  findings: { type: "array", maxItems: reviewLimits.findings, items: { type: "object", additionalProperties: false, required: Object.keys(properties), properties } },
} };

export function validateFindings(value: unknown, allowed: Set<string>): Finding[] {
  const invalid = () => new PermanentReviewError("Review output failed finding or evidence-reference validation; no findings were published.");
  if (!isRecord(value) || Object.keys(value).length !== 1 || !Array.isArray(value.findings) || value.findings.length > reviewLimits.findings) throw invalid();
  const seen = new Set<string>();
  return value.findings.map(item => {
    if (!isRecord(item) || Object.keys(item).length !== Object.keys(properties).length || Object.keys(item).some(key => !(key in properties))) throw invalid();
    for (const [key, max] of Object.entries(fieldLimits)) {
      const field = item[key];
      if (field === null && nullable.has(key)) continue;
      if (typeof field !== "string" || !field.trim() || field.length > max) throw invalid();
    }
    if (!evidenceStatuses.some(status => status === item.evidence_status) || !Array.isArray(item.evidenceIds) || !item.evidenceIds.length || item.evidenceIds.length > reviewLimits.references) throw invalid();
    if (item.evidenceIds.some(ref => typeof ref !== "string" || !allowed.has(ref)) || new Set(item.evidenceIds).size !== item.evidenceIds.length) throw invalid();
    const fingerprint = (item.observation as string).trim().toLowerCase().replace(/\s+/g, " ");
    if (seen.has(fingerprint)) throw invalid();
    seen.add(fingerprint);
    return item as Finding;
  });
}
