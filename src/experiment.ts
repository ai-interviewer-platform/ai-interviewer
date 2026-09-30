import type { Pool } from 'pg';
import { assignVariant, copySlots, experimentSlug as slug, variantVersion } from '../public/experiment.js';
import { actions, outcomeNames } from '../public/measurement-contract.js';
import type { Env } from './env';

type Outcome = { name: string; action: string };
type Variant = { id: string; weight: number; copy?: Record<string, string> };
export type Experiment = {
  id: string; status: 'running' | 'stopped'; start: string; end?: string; hypothesis: string; audience: string;
  primaryOutcome: Outcome; guardrails: Outcome[]; baseline: { start: string; end: string };
  minimumEffect: number; alpha: number; power: number; identity: 'document'; method: 'fixed-horizon-two-proportion';
  variants: [Variant, Variant];
};

const text = (value: unknown) => typeof value === 'string' && value.trim() !== '';
const fraction = (value: unknown) => typeof value === 'number' && value > 0 && value < 1;
const outcome = (value: any) => outcomeNames.includes(value?.name) && actions.includes(value?.action);
const instant = (value: unknown) => typeof value === 'string' && !Number.isNaN(Date.parse(value));

// The pre-registered contract of the one landing experiment. Every field is an owner choice;
// nothing here has a default. An incomplete contract serves the control to everyone.
export function landingExperiment(env: Env): { experiment: Experiment | null; problems: string[] } {
  if (!env.LANDING_EXPERIMENT) return { experiment: null, problems: [] };
  let value: any;
  try { value = JSON.parse(env.LANDING_EXPERIMENT); } catch { return { experiment: null, problems: ['LANDING_EXPERIMENT is not JSON.'] }; }
  const problems = [
    [slug.test(value?.id), 'id: a lowercase slug'],
    [['running', 'stopped'].includes(value?.status), 'status: running or stopped'],
    [instant(value?.start), 'start: when the experiment starts collecting'],
    [value?.status !== 'stopped' || (instant(value?.end) && Date.parse(value.end) > Date.parse(value.start)), 'end: when a stopped experiment stopped, after its start'],
    [text(value?.hypothesis), 'hypothesis'],
    [text(value?.audience), 'audience: the eligible audience'],
    [outcome(value?.primaryOutcome), 'primaryOutcome: an allowlisted outcome event and action'],
    [Array.isArray(value?.guardrails) && value.guardrails.length > 0 && value.guardrails.every(outcome), 'guardrails: one or more allowlisted outcome events and actions'],
    [instant(value?.baseline?.start) && instant(value?.baseline?.end) && Date.parse(value.baseline.start) < Date.parse(value.baseline.end) && Date.parse(value.baseline.end) <= Date.parse(value?.start), 'baseline: the measured start and end, closed before the experiment starts'],
    [fraction(value?.minimumEffect), 'minimumEffect: the smallest meaningful absolute difference'],
    [fraction(value?.alpha), 'alpha: the two-sided significance level'],
    [fraction(value?.power), 'power'],
    [value?.identity === 'document', 'identity: document'],
    [value?.method === 'fixed-horizon-two-proportion', 'method: fixed-horizon-two-proportion'],
    [Array.isArray(value?.variants) && value.variants.length === 2 && value.variants.every((variant: any) => slug.test(variant?.id) && typeof variant.weight === 'number' && variant.weight > 0)
      && value.variants[0].id !== value.variants[1].id && value.variants[0].copy === undefined
      && Object.keys(value.variants[1].copy ?? {}).length > 0 && Object.entries(value.variants[1].copy).every(([slot, copy]) => copySlots.includes(slot) && text(copy)),
    'variants: a control without copy, then one treatment with copy for allowlisted slots, each with a positive weight'],
  ].filter(([valid]) => !valid).map(([, problem]) => `Missing or invalid ${problem}.`);
  return problems.length ? { experiment: null, problems } : { experiment: value, problems };
}

// What the landing page needs: only for a complete, running contract from its start, while measurement is on.
export function experimentConfig(env: Env, measuring: boolean) {
  const { experiment } = landingExperiment(env);
  if (!measuring || experiment?.status !== 'running' || Date.now() < Date.parse(experiment.start)) return null;
  return { id: experiment.id, variants: experiment.variants.map(variant => ({ ...variant, version: variantVersion(variant) })) };
}

// Inverse standard normal CDF (Acklam), accurate to about 1e-9.
export function normalQuantile(p: number) {
  const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239];
  const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
  const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
  const tail = (q: number) => (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  if (p < 0.02425) return tail(Math.sqrt(-2 * Math.log(p)));
  if (p > 1 - 0.02425) return -tail(Math.sqrt(-2 * Math.log(1 - p)));
  const q = p - 0.5, r = q * q;
  return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

// Documents per variant for a two-sided two-proportion test with allocation ratio k = treatment / control.
export function plannedDocuments(baseline: number, effect: number, alpha: number, power: number, k: number) {
  const treated = baseline + effect;
  if (!(baseline > 0 && baseline < 1 && treated < 1)) return null;
  const pooled = (baseline + k * treated) / (1 + k);
  const control = Math.ceil((normalQuantile(1 - alpha / 2) * Math.sqrt(pooled * (1 - pooled) * (1 + 1 / k))
    + normalQuantile(power) * Math.sqrt(baseline * (1 - baseline) + treated * (1 - treated) / k)) ** 2 / effect ** 2);
  return { control, treatment: Math.ceil(k * control) };
}

// Unpooled (Wald) interval for the treatment minus control difference in proportions.
export function differenceInterval(control: { documents: number; conversions: number }, treatment: { documents: number; conversions: number }, alpha: number) {
  const pc = control.conversions / control.documents, pt = treatment.conversions / treatment.documents;
  const margin = normalQuantile(1 - alpha / 2) * Math.sqrt(pc * (1 - pc) / control.documents + pt * (1 - pt) / treatment.documents);
  const difference = pt - pc;
  return { difference, interval: [difference - margin, difference + margin], confidence: 1 - alpha, excludesZero: difference - margin > 0 || difference + margin < 0 };
}

const limitations = [
  'This is a randomized concurrent comparison by document, not a before/after comparison. The baseline only derives the planned sample.',
  'A document is one page load, not a person. A reload or new tab is assigned again, so one person can see both variants.',
  'Treatment copy replaces the control copy when the configuration loads, so the control wording can show briefly.',
  'The baseline counts every landing document, including automated and internal ones; the comparison counts only eligible documents.',
  'Changing the weights or the copy of a running experiment needs a new id: earlier documents would count as the wrong variant or an old version.',
  'The interval is a normal approximation. With a rate of 0% or 100% in a variant it has zero width and overstates certainty.',
  'Outcomes are client events of the exposed document. Server waitlist joins and personal Attempts are not joined to variants.',
  'Guardrail intervals are not adjusted for multiple comparisons. No interval is shown while the experiment runs, so a result cannot change between reports.',
  'Outcomes are observed until the recorded end: a document exposed just before it has little time to convert.',
  'A detected difference is not an automatic winner: the owner decides with the interval, the guardrails and the limitations.',
];

type Exposure = { document: string; variant: string; version: string; eligibility: string; exposedAt: string; outcomes: string[] };

// The experiment window runs from the contract start, whatever window the operator chose. A stopped experiment ends at its recorded end:
// only then is it analyzed, so a result cannot change between reports. A running one shows progress until the report end.
export async function experimentReport(pool: Pool, env: Env, end: Date) {
  const { experiment, problems } = landingExperiment(env);
  if (!experiment) return problems.length ? { status: 'invalid', problems } : null;
  const key = (item: Outcome) => `${item.name}:${item.action}`;
  // An end still in the future would let late outcomes change the result, so it counts as running until then.
  const stopped = experiment.status === 'stopped' && Date.parse(experiment.end!) <= Date.now();
  const window = [experiment.start, stopped ? experiment.end! : end.toISOString()];
  const baseline = (await pool.query(`WITH windowed AS (SELECT * FROM measurement_events WHERE received_at >= $1 AND received_at < $2),
      landed AS (SELECT exposure_id, min(received_at) AS landed_at FROM windowed WHERE name = 'landing_exposed' AND exposure_id IS NOT NULL GROUP BY 1)
    SELECT (SELECT count(*)::int FROM landed) AS documents,
      (SELECT count(DISTINCT exposure_id)::int FROM windowed JOIN landed USING (exposure_id) WHERE name = $3 AND action = $4 AND received_at >= landed_at) AS conversions`,
  [experiment.baseline.start, experiment.baseline.end, experiment.primaryOutcome.name, experiment.primaryOutcome.action])).rows[0];
  const [control, treatment] = experiment.variants;
  const plan = plannedDocuments(baseline.conversions / baseline.documents, experiment.minimumEffect, experiment.alpha, experiment.power, treatment.weight / control.weight);
  // ponytail: loads every exposure of the window into the Worker; aggregate in SQL if traffic grows.
  const rows: Exposure[] = (await pool.query(`WITH windowed AS (SELECT * FROM measurement_events WHERE received_at >= $1 AND received_at < $2)
    SELECT exposure.exposure_id AS document, exposure.variant, exposure.variant_version AS version, exposure.eligibility, exposure.received_at AS "exposedAt",
      coalesce((SELECT json_agg(DISTINCT later.name || ':' || later.action) FROM windowed later WHERE later.exposure_id = exposure.exposure_id AND later.received_at >= exposure.received_at), '[]') AS outcomes
    FROM windowed exposure WHERE exposure.name = 'experiment_exposed' AND exposure.experiment_id = $3 AND exposure.exposure_id IS NOT NULL ORDER BY exposure.received_at`,
  [...window, experiment.id])).rows;
  const missingExposure = (await pool.query(`SELECT count(DISTINCT exposure_id)::int AS documents FROM measurement_events
    WHERE received_at >= $1 AND received_at < $2 AND name = 'landing_exposed' AND exposure_id NOT IN (
      SELECT exposure_id FROM measurement_events WHERE name = 'experiment_exposed' AND experiment_id = $3 AND exposure_id IS NOT NULL)`, [...window, experiment.id])).rows[0].documents;

  const exclusions = { automation: 0, internal: 0, assignmentMismatch: 0, versionMismatch: 0, mixedVariants: 0 };
  const documents = new Map<string, Exposure[]>();
  for (const row of rows) documents.set(row.document, [...(documents.get(row.document) ?? []), row]);
  const eligible = new Map<string, Exposure[]>(experiment.variants.map(variant => [variant.id, []]));
  for (const [document, exposures] of documents) {
    const first = exposures[0];
    const variant = experiment.variants.find(item => item.id === first.variant);
    if (new Set(exposures.map(item => item.variant)).size > 1) exclusions.mixedVariants += 1;
    else if (first.eligibility === 'automation' || first.eligibility === 'internal') exclusions[first.eligibility] += 1;
    else if (!variant || assignVariant(experiment, document).id !== variant.id) exclusions.assignmentMismatch += 1;
    else if (first.version !== variantVersion(variant)) exclusions.versionMismatch += 1;
    else eligible.get(variant.id)!.push(first);
  }
  const planned = (variant: Variant) => plan?.[variant === control ? 'control' : 'treatment'] ?? null;
  // Fixed horizon: the analysis uses the first planned documents of each variant, however long collection continued.
  const analyzed = (variant: Variant) => { const size = planned(variant); return size === null ? eligible.get(variant.id)! : eligible.get(variant.id)!.slice(0, size); };
  const count = (variant: Variant, item: Outcome) => ({ documents: analyzed(variant).length, conversions: analyzed(variant).filter(row => row.outcomes.includes(key(item))).length });
  const reached = plan !== null && experiment.variants.every(variant => eligible.get(variant.id)!.length >= planned(variant)!);
  const compare = (item: Outcome) => ({ ...item, ...differenceInterval(count(control, item), count(treatment, item), experiment.alpha) });
  const primary = stopped && reached ? compare(experiment.primaryOutcome) : null;
  const status = plan === null ? 'plan_unavailable' : !stopped ? 'collecting' : !primary ? 'inconclusive' : primary.excludesZero ? 'difference_detected' : 'inconclusive';
  return {
    status, contract: experiment, reached, window: { start: window[0], end: window[1], endSource: stopped ? 'contract end' : 'report end' },
    design: 'Randomized concurrent comparison by document',
    baseline: { ...experiment.baseline, ...baseline, rate: baseline.documents ? baseline.conversions / baseline.documents : null },
    plan: plan ? { ...plan, reason: 'Derived from the baseline rate, the minimum effect, alpha, power and the allocation weights.' }
      : { reason: 'The baseline has no documents, no conversions, only conversions, or leaves no room for the minimum effect. No sample can be derived; report observations only.' },
    variants: experiment.variants.map(variant => ({ id: variant.id, version: variantVersion(variant), planned: planned(variant), eligible: eligible.get(variant.id)!.length,
      primary: count(variant, experiment.primaryOutcome), guardrails: experiment.guardrails.map(item => ({ ...item, ...count(variant, item) })) })),
    primary, guardrails: primary ? experiment.guardrails.map(compare) : [],
    exclusions, missingExposure,
    limitations: stopped && !reached ? ['Stopped before the planned sample: inconclusive by the stopping rule.', ...limitations] : limitations,
  };
}
