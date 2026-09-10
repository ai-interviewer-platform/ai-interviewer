import type { Env } from "./env";

/**
 * Personal records are unavailable by default.  An owner must explicitly set
 * PERSONAL_DATA_COLLECTION_APPROVED=true only after the retention and
 * processor policy is approved for this deployment.
 */
export function personalCollectionEnabled(env: Env): boolean {
  return env.PERSONAL_DATA_COLLECTION_APPROVED === "true";
}

export const personalCollectionUnavailable =
  "Personal records are unavailable until the owner enables the approved data-collection policy for this deployment.";
