import type { Pool } from 'pg';
import { actions, activities, authorities, eligibilities, eventNames, heatGridSize, heatZones, outcomeNames, pageActivity, viewports } from '../public/measurement-contract.js';
import type { Env } from './env';
import { experimentReport } from './experiment';
import { experimentSlug as slug, versionPattern as version } from '../public/experiment.js';
import { badRequest, boundedRequest, checkOrigin, json, notFound, requestBody, serverUnavailable } from './http';
import { isOperator, operatorRequired } from './operator';
import { consumeRate, limits, siteRateLimitKey } from './security';

const uuid = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;
const automatedAgent = /bot|crawl|spider|slurp|headless|lighthouse|preview/i;
const cell = (value: unknown) => Number.isInteger(value) && (value as number) >= 0 && (value as number) < heatGridSize;
const listed = (list: readonly string[], value: unknown) => typeof value === 'string' && list.includes(value);

const measurementLimitations = [
  'Counts only. Client events are missing when measurement is off, Global Privacy Control or Do Not Track is set, a blocker or network failure drops them, or the browser leaves first.',
  'Landing documents link events of one page load only. A reload, a new tab or an emailed link starts a new document, so attribution beyond one document is unknown.',
  'Selecting an action is intent. Persisted success comes from the server cohort and waitlist outcomes; the two sources are not joined, so no conversion rate between them is calculated.',
  'Event authority "server" means the browser saw a server confirmation. It is still a client report; only the cohort and waitlist outcomes read server records.',
  'Sample events are fictional interactions: a sample start is opening the sample, and nothing is persisted.',
  'Heatmap cells show where clicks landed on the landing page, not why. Text-field clicks are masked and other surfaces are excluded.',
  'Synthetic or internal traffic is not filtered, except from the landing experiment comparison. Patterns do not prove live conversion lift.',
];

export function measurementEnabled(env: Env) {
  return env.MEASUREMENT_COLLECTION_APPROVED === 'true' && Boolean(env.WAITLIST_OPERATOR_TOKEN);
}

export async function measurementRequest(request: Request, env: Env, database: () => Pool): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname === '/api/measure/report' && request.method === 'GET') {
    if (!isOperator(request, env)) return operatorRequired();
    const start = new Date(url.searchParams.get('start') ?? '');
    const end = new Date(url.searchParams.get('end') ?? '');
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return badRequest('Choose an explicit start and end.');
    if (start >= end) return badRequest('Choose a start before the end.');
    return json(await report(database(), env, start, end));
  }
  if (url.pathname !== '/api/measure' || request.method !== 'POST') return notFound();
  if (!measurementEnabled(env)) return serverUnavailable('Measurement is off.');
  const originError = checkOrigin(request, env.BETTER_AUTH_URL);
  if (originError) return originError;
  const bounded = await boundedRequest(request, limits.measurementEventBytes);
  if (bounded instanceof Response) return bounded;
  const body = await requestBody(bounded);
  if (!body || body.version !== 'coursay-outcomes-v1' || body.attribution !== 'unknown' || typeof body.id !== 'string' || !uuid.test(body.id)
    || !listed(eventNames, body.name) || !Object.hasOwn(pageActivity, body.surface as string) || !listed(activities, body.activity) || !listed(actions, body.action)
    || !listed(authorities, body.authority) || (body.exposureId !== null && !(typeof body.exposureId === 'string' && uuid.test(body.exposureId)))) return badRequest('Send an allowlisted event.');
  const click = body.name === 'landing_click';
  if (click && !(listed(heatZones, body.zone) && cell(body.cellX) && cell(body.cellY) && listed(viewports, body.viewport))) return badRequest('Send an allowlisted event.');
  const exposure = body.name === 'experiment_exposed';
  if (exposure && !(typeof body.experiment === 'string' && slug.test(body.experiment) && typeof body.variant === 'string' && slug.test(body.variant)
    && typeof body.variantVersion === 'string' && version.test(body.variantVersion) && listed(eligibilities, body.eligibility))) return badRequest('Send an allowlisted event.');
  // Crawlers and headless browsers that run the page are excluded from experiments whatever the page reported.
  const eligibility = exposure && automatedAgent.test(request.headers.get('user-agent') ?? '') ? 'automation' : body.eligibility;
  try {
    const pool = database();
    if (!(await consumeRate(pool, siteRateLimitKey('measure'), 60, limits.measurementEventsPerMinute)).allowed) return json({ error: 'Measurement is busy.' }, { status: 429 });
    await pool.query(`INSERT INTO measurement_events (id, name, surface, activity, action, authority, exposure_id, zone, cell_x, cell_y, viewport, experiment_id, variant, variant_version, eligibility)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
      ON CONFLICT (id) DO UPDATE SET duplicate_count = measurement_events.duplicate_count + 1`,
    [body.id, body.name, body.surface, body.activity, body.action, body.authority, body.exposureId, click ? body.zone : null, click ? body.cellX : null, click ? body.cellY : null, click ? body.viewport : null,
      exposure ? body.experiment : null, exposure ? body.variant : null, exposure ? body.variantVersion : null, exposure ? eligibility : null]);
    return json({ accepted: true }, { status: 202 });
  } catch {
    return serverUnavailable('Measurement is unavailable.');
  }
}

async function report(pool: Pool, env: Env, start: Date, end: Date) {
  const window = [start.toISOString(), end.toISOString()];
  const events = await pool.query(`SELECT name, surface, activity, action, authority, count(*)::int AS events,
      count(DISTINCT exposure_id)::int AS documents, sum(duplicate_count)::int AS duplicates, count(*) FILTER (WHERE exposure_id IS NULL)::int AS "withoutDocument"
    FROM measurement_events WHERE received_at >= $1 AND received_at < $2 AND name <> 'landing_click'
    GROUP BY 1, 2, 3, 4, 5 ORDER BY 1, 2, 3, 4, 5`, window);
  // Every step counts the landing documents that reached it after landing; the denominator is `documents`.
  // Documents with events but no landing exposure are counted as unattributed, not dropped.
  const landing = await pool.query(`WITH windowed AS (SELECT * FROM measurement_events WHERE received_at >= $1 AND received_at < $2),
      landed AS (SELECT exposure_id, min(received_at) AS landed_at FROM windowed WHERE name = 'landing_exposed' AND exposure_id IS NOT NULL GROUP BY 1)
    SELECT (SELECT count(*)::int FROM landed) AS documents,
      (SELECT count(DISTINCT exposure_id)::int FROM windowed WHERE exposure_id NOT IN (SELECT exposure_id FROM landed)) AS "unattributedDocuments",
      coalesce((SELECT json_agg(step ORDER BY step.name, step.activity, step.action) FROM (
        SELECT name, activity, action, count(DISTINCT exposure_id)::int AS documents FROM windowed JOIN landed USING (exposure_id)
        WHERE name = ANY($3) AND received_at >= landed_at GROUP BY 1, 2, 3) step), '[]') AS steps`, [...window, outcomeNames]);
  // Authoritative server records for Attempts started in the window, observed until its end.
  const cohort = await pool.query(`WITH started AS (SELECT id, completed_at FROM attempts WHERE source_attempt_id IS NULL AND created_at >= $1 AND created_at < $2)
    SELECT count(*)::int AS started, count(*) FILTER (WHERE completed_at < $2)::int AS completed, count(*) FILTER (WHERE completed_at IS NULL OR completed_at >= $2)::int AS "openAtEnd",
      (SELECT count(*)::int FROM reviews JOIN started ON started.id = reviews.attempt_id WHERE status = 'ready' AND reviews.completed_at < $2) AS "reviewsReady",
      (SELECT count(DISTINCT attempts.source_attempt_id)::int FROM attempts JOIN reviews ON reviews.attempt_id = attempts.source_attempt_id
        WHERE attempts.source_attempt_id IN (SELECT id FROM started) AND reviews.status = 'ready' AND reviews.completed_at < $2 AND attempts.created_at < $2) AS "reviewedRetried"
    FROM started`, window);
  const waitlist = await pool.query(`SELECT count(*) FILTER (WHERE name = 'waitlist_joined')::int AS joined, count(*) FILTER (WHERE name = 'waitlist_withdrawn')::int AS withdrawn
    FROM waitlist_outcomes WHERE occurred_at >= $1 AND occurred_at < $2`, window);
  const heatmap = await pool.query(`SELECT viewport, zone, cell_x AS x, cell_y AS y, count(*)::int AS clicks FROM measurement_events
    WHERE name = 'landing_click' AND received_at >= $1 AND received_at < $2 GROUP BY 1, 2, 3, 4 ORDER BY 1, 2, 3, 4`, window);
  // Counts of preset answers and operator categories only: comments stay in feedback triage.
  const feedbackThemes = await pool.query(`SELECT feature, question_id AS "questionId", question_version AS "questionVersion", answer, category,
      count(*)::int AS responses, count(response_text)::int AS "withComment"
    FROM feedback_responses WHERE created_at >= $1 AND created_at < $2 GROUP BY 1, 2, 3, 4, 5 ORDER BY 1, 2, 3, 4, 5`, window);
  return {
    window: { start: window[0], end: window[1], clock: 'server receipt time' },
    events: events.rows, landing: landing.rows[0], personalCohort: cohort.rows[0], waitlist: waitlist.rows[0], heatmap: heatmap.rows,
    feedbackThemes: feedbackThemes.rows, experiment: await experimentReport(pool, env, end),
    limitations: measurementLimitations,
  };
}
