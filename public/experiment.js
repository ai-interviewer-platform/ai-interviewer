// Landing experiment assignment, shared by the browser (public/landing.js) and the server
// (src/experiment.ts), which recomputes it to find documents that saw the wrong variant.

// 32-bit FNV-1a. The exposure identifier is already random, so this only needs to be stable.
function hash(text) {
  let value = 0x811c9dc5;
  for (const char of text) value = Math.imul(value ^ char.codePointAt(0), 0x01000193) >>> 0;
  return value;
}

// A variant's version changes with its copy, so a changed wording is never counted as the same variant.
export const variantVersion = variant => hash(JSON.stringify([variant.id, variant.copy ?? null])).toString(16).padStart(8, '0');

// The variant of one document: stable for the document, in proportion to the approved weights.
export function assignVariant(experiment, exposureId) {
  const total = experiment.variants.reduce((sum, variant) => sum + variant.weight, 0);
  let point = (hash(`${experiment.id}:${exposureId}`) / 2 ** 32) * total;
  return experiment.variants.find(variant => (point -= variant.weight) < 0) ?? experiment.variants.at(-1);
}

// Experiment and variant ids, and the variant version format.
export const experimentSlug = /^[a-z0-9][a-z0-9-]{0,63}$/;
export const versionPattern = /^[\da-f]{8}$/;

// The landing copy a treatment may replace. Values are plain text.
export const copySlots = ['eyebrow', 'headline', 'intro'];
