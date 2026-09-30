import type { Pool } from 'pg';
import { closedFeedbackStatuses, feedbackCategories, feedbackQuestions, feedbackStatuses, feedbackTextLimit, pageFeature, questionFor } from '../public/feedback-questions.js';
import { pageActivity } from '../public/measurement-contract.js';
import type { Env } from './env';
import { badRequest, boundedRequest, checkOrigin, json, notFound, requestBody, serverUnavailable } from './http';
import { isOperator, operatorRequired } from './operator';
import { consumeRate, limits, siteRateLimitKey } from './security';

const columns = 'id, question_id, question_version, feature, surface, activity, answer, response_text, category, status, resolution, created_at, updated_at';
const unavailable = () => serverUnavailable('Feedback could not be saved. Your answer is still here; try again.');

export function feedbackEnabled(env: Env) {
  return env.FEEDBACK_COLLECTION_APPROVED === 'true' && Boolean(env.WAITLIST_OPERATOR_TOKEN);
}

export async function feedbackRequest(request: Request, env: Env, database: () => Pool): Promise<Response> {
  const url = new URL(request.url);
  const operatorPath = url.pathname === '/api/feedback/records';
  if (operatorPath && !isOperator(request, env)) return operatorRequired();
  if (!operatorPath && !feedbackEnabled(env)) return serverUnavailable('Feedback is not being collected.');
  const originError = checkOrigin(request, env.BETTER_AUTH_URL);
  if (originError) return originError;
  if (operatorPath && request.method === 'GET') return listRecords(database(), url.searchParams);
  if (request.method !== 'POST') return notFound();
  const bounded = await boundedRequest(request, limits.feedbackBytes);
  if (bounded instanceof Response) return bounded;
  const body = await requestBody(bounded);
  if (!body) return badRequest('Send a JSON request.');
  try {
    return operatorPath ? await triage(database(), body) : await save(database(), body);
  } catch {
    return unavailable();
  }
}

async function save(pool: Pool, body: Record<string, unknown>) {
  const surface = typeof body.surface === 'string' ? body.surface : '';
  const question = questionFor(surface);
  // The comment is stored exactly as written; blank text counts as no comment.
  const text = typeof body.text === 'string' && body.text.trim() ? body.text : '';
  const answer = body.answer ?? null;
  if (!question || body.questionId !== question.id || body.questionVersion !== question.version) return badRequest('This question changed. Reload the page and try again.');
  if (answer !== null && !(typeof answer === 'string' && Object.hasOwn(question.answers, answer))) return badRequest('Choose one of the listed answers.');
  if (text.length > feedbackTextLimit) return badRequest(`Keep the comment to ${feedbackTextLimit} characters or fewer.`);
  if (answer === null && !text) return badRequest('Choose an answer or add a comment.');
  if (!(await consumeRate(pool, siteRateLimitKey('feedback'), 60, limits.feedbackPerMinute)).allowed) return json({ error: 'Feedback is busy. Try again in a minute.' }, { status: 429 });
  await pool.query(`INSERT INTO feedback_responses (id, question_id, question_version, feature, surface, activity, answer, response_text)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`, [crypto.randomUUID(), question.id, question.version, question.feature, surface, pageActivity[surface as keyof typeof pageActivity], answer, text || null]);
  return json({ saved: true }, { status: 201 });
}

async function listRecords(pool: Pool, query: URLSearchParams) {
  const filters: Record<string, readonly string[]> = { status: feedbackStatuses, feature: Object.keys(feedbackQuestions), surface: Object.keys(pageFeature), category: feedbackCategories };
  const conditions: string[] = [];
  const values: string[] = [];
  for (const [name, allowed] of Object.entries(filters)) {
    const value = query.get(name);
    if (value === null || value === '') continue;
    if (!allowed.includes(value)) return badRequest(`Unknown ${name}.`);
    values.push(value);
    conditions.push(`${name} = $${values.length}`);
  }
  try {
    const records = await pool.query(`SELECT ${columns} FROM feedback_responses ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''} ORDER BY created_at DESC LIMIT 200`, values);
    return json({ records: records.rows });
  } catch {
    return unavailable();
  }
}

async function triage(pool: Pool, body: Record<string, unknown>) {
  if (typeof body.id !== 'string' || !body.id) return badRequest('Choose a feedback record.');
  if (body.action === 'delete') {
    await pool.query('DELETE FROM feedback_responses WHERE id = $1', [body.id]);
    return json({ deleted: true });
  }
  const category = body.category ?? null;
  const resolution = typeof body.resolution === 'string' && body.resolution.trim() ? body.resolution.trim() : null;
  if (category !== null && !feedbackCategories.includes(category as string)) return badRequest('Choose a listed category.');
  if (!feedbackStatuses.includes(body.status as string)) return badRequest('Choose a listed status.');
  if (closedFeedbackStatuses.includes(body.status as string) && !resolution) return badRequest('Record the resolution before closing feedback.');
  const updated = await pool.query(`UPDATE feedback_responses SET category = $2, status = $3, resolution = $4, updated_at = now() WHERE id = $1 RETURNING ${columns}`, [body.id, category, body.status, resolution]);
  return updated.rows[0] ? json({ record: updated.rows[0] }) : notFound();
}
