import type { Pool } from 'pg';
import { bugContactPurpose, bugStatuses, bugSurfaces, bugTextLimit, closedBugStatuses, diagnosticErrorLimit, diagnosticValues, operatorContact, secretPattern } from '../public/bug-report-contract.js';
import { pageFeature } from '../public/feedback-questions.js';
import { pageActivity } from '../public/measurement-contract.js';
import type { Env } from './env';
import { badRequest, boundedRequest, checkOrigin, isEmailAddress, isRecord, json, nonnegativeSafeInteger, notFound, requestBody, serverUnavailable } from './http';
import { isOperator, operatorRequired } from './operator';
import { consumeRate, limits, siteRateLimitKey } from './security';
import { listTriageRecords } from './triage';

const columns = 'id, reference, surface, feature, activity, expected, actual, steps, diagnostics, contact_email, contact_purpose, status, investigation, resolution, created_at, updated_at';
const unavailable = () => serverUnavailable('Your report was not saved. Your text is still here; try again.');
// A field error names its form field, so the form can mark and focus it.
const invalid = (field: string, error: string) => json({ error, field }, { status: 400 });

export function bugReportsEnabled(env: Env) {
  return env.BUG_REPORT_COLLECTION_APPROVED === 'true' && Boolean(env.WAITLIST_OPERATOR_TOKEN);
}

// Keeps only allowlisted diagnostic values. A bad value is dropped, never a reason to refuse a report.
function allowlistedDiagnostics(value: unknown) {
  const source = isRecord(value) ? value : {};
  const kept: Record<string, unknown> = {};
  for (const key of ['browser', 'os', 'viewport'] as const) if (diagnosticValues[key].includes(source[key] as string)) kept[key] = source[key];
  if (nonnegativeSafeInteger(source.viewportWidth) && source.viewportWidth > 0 && source.viewportWidth <= 10000) kept.viewportWidth = Math.round(source.viewportWidth / 100) * 100;
  if (typeof source.online === 'boolean') kept.online = source.online;
  if (Array.isArray(source.errors)) kept.errors = source.errors.filter(name => diagnosticValues.errors.includes(name)).slice(0, diagnosticErrorLimit);
  return kept;
}

export async function bugReportRequest(request: Request, env: Env, database: () => Pool): Promise<Response> {
  const url = new URL(request.url);
  const operatorPath = url.pathname === '/api/bug-reports/records';
  if (operatorPath && !isOperator(request, env)) return operatorRequired();
  if (!operatorPath && !bugReportsEnabled(env)) return serverUnavailable('Bug reports are not collected here yet.');
  const originError = checkOrigin(request, env.BETTER_AUTH_URL);
  if (originError) return originError;
  if (operatorPath && request.method === 'GET') return listTriageRecords(database(), 'bug_reports', columns, url.searchParams, { status: bugStatuses, surface: bugSurfaces, feature: [...new Set(Object.values(pageFeature)), 'other'] });
  if (request.method !== 'POST') return notFound();
  const bounded = await boundedRequest(request, limits.bugReportsBytes);
  if (bounded instanceof Response) return bounded;
  const body = await requestBody(bounded);
  if (!body) return badRequest('Send the report as JSON.');
  try {
    return operatorPath ? await triage(database(), body) : await save(database(), body);
  } catch {
    return unavailable();
  }
}

async function save(pool: Pool, body: Record<string, unknown>) {
  // Free text is stored as written, except that anything shaped like a secret is replaced.
  const text = (field: string) => { const value = body[field]; return typeof value === 'string' && value.trim() ? value.replace(secretPattern, '[removed]') : ''; };
  const surface = typeof body.surface === 'string' && bugSurfaces.includes(body.surface) ? body.surface : null;
  const email = typeof body.contactEmail === 'string' ? body.contactEmail.trim().toLowerCase() : '';
  if (!surface) return badRequest('Reload the page and try again.');
  if (!text('expected')) return invalid('expected', 'Describe what you expected.');
  if (!text('actual')) return invalid('actual', 'Describe what happened instead.');
  for (const field of ['expected', 'actual', 'steps']) if (String(body[field] ?? '').length > bugTextLimit) return invalid(field, `Keep each answer to ${bugTextLimit} characters or fewer.`);
  if (email && !isEmailAddress(email)) return invalid('contactEmail', 'Enter a reply address, such as name@example.com, or leave it empty.');
  if (email && body.contactConsent !== true) return invalid('contactConsent', 'Agree to the reply purpose, or remove the reply address.');
  if (!email && body.contactConsent === true) return invalid('contactEmail', 'Enter the reply address, or clear the reply checkbox.');
  if (!(await consumeRate(pool, siteRateLimitKey('bug-report'), 60, limits.bugReportsPerMinute)).allowed) return json({ error: `Reports are busy. Try again in a minute, or email ${operatorContact}.` }, { status: 429 });
  const reference = `BR-${crypto.randomUUID().replaceAll('-', '').slice(0, 8).toUpperCase()}`;
  await pool.query(`INSERT INTO bug_reports (id, reference, surface, feature, activity, expected, actual, steps, diagnostics, contact_email, contact_purpose)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
  [crypto.randomUUID(), reference, surface, pageFeature[surface as keyof typeof pageFeature] ?? 'other', pageActivity[surface as keyof typeof pageActivity] ?? 'none',
    text('expected'), text('actual'), text('steps') || null, JSON.stringify(allowlistedDiagnostics(body.diagnostics)), email || null, email ? bugContactPurpose : null]);
  return json({ reference }, { status: 201 });
}

async function triage(pool: Pool, body: Record<string, unknown>) {
  if (typeof body.id !== 'string' || !body.id) return badRequest('Choose a bug report.');
  if (body.action === 'delete') {
    await pool.query('DELETE FROM bug_reports WHERE id = $1', [body.id]);
    return json({ deleted: true });
  }
  // A reporter can withdraw reply permission while the report stays open.
  if (body.action === 'erase-contact') {
    const erased = await pool.query(`UPDATE bug_reports SET contact_email = NULL, contact_purpose = NULL, updated_at = now() WHERE id = $1 RETURNING ${columns}`, [body.id]);
    return erased.rows[0] ? json({ record: erased.rows[0] }) : notFound();
  }
  const note = (field: string) => { const value = body[field]; return typeof value === 'string' && value.trim() ? value.trim() : null; };
  if (!bugStatuses.includes(body.status as string)) return invalid('status', 'Choose a listed status.');
  const current = await pool.query<{ investigation: string | null; resolution: string | null }>('SELECT investigation, resolution FROM bug_reports WHERE id = $1', [body.id]);
  if (!current.rows[0]) return notFound();
  // Notes that are not sent stay as they were.
  const investigation = 'investigation' in body ? note('investigation') : current.rows[0].investigation;
  const resolution = 'resolution' in body ? note('resolution') : current.rows[0].resolution;
  const closing = closedBugStatuses.includes(body.status as string);
  if (closing && !resolution) return invalid('resolution', 'Record the resolution before closing the report.');
  // Closing fulfils the reply purpose, so the address is erased with it.
  const updated = await pool.query(`UPDATE bug_reports SET status = $2, investigation = $3, resolution = $4, updated_at = now(),
      contact_email = CASE WHEN $5 THEN NULL ELSE contact_email END, contact_purpose = CASE WHEN $5 THEN NULL ELSE contact_purpose END
    WHERE id = $1 RETURNING ${columns}`, [body.id, body.status, investigation, resolution, closing]);
  return json({ record: updated.rows[0] });
}
