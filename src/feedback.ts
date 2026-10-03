import { closedFeedbackStatuses, feedbackCategories, feedbackQuestions, feedbackStatuses, feedbackTextLimit, pageFeature, questionFor } from '../public/feedback-questions.js';
import { pageActivity } from '../public/measurement-contract.js';
import { badRequest, json, notFound } from './http';
import { collectionApproved } from './operator';
import { limits } from './security';
import type { CollectionPolicy, SiteInput } from './site-collection';
import { listTriageRecords } from './triage';

const columns = 'id, question_id, question_version, feature, surface, activity, answer, response_text, category, status, resolution, created_at, updated_at';

const records = ({ url, database }: SiteInput) => listTriageRecords(database(), 'feedback_responses', columns, url.searchParams, { status: feedbackStatuses, feature: Object.keys(feedbackQuestions), surface: Object.keys(pageFeature), category: feedbackCategories });

async function save({ body, database }: SiteInput) {
  const surface = typeof body.surface === 'string' ? body.surface : '';
  const question = questionFor(surface);
  // The comment is stored exactly as written; blank text counts as no comment.
  const text = typeof body.text === 'string' && body.text.trim() ? body.text : '';
  const answer = body.answer ?? null;
  if (!question || body.questionId !== question.id || body.questionVersion !== question.version) return badRequest('This question changed. Reload the page and try again.');
  if (answer !== null && !(typeof answer === 'string' && Object.hasOwn(question.answers, answer))) return badRequest('Choose one of the listed answers.');
  if (text.length > feedbackTextLimit) return badRequest(`Keep the comment to ${feedbackTextLimit} characters or fewer.`);
  if (answer === null && !text) return badRequest('Choose an answer or add a comment.');
  await database().query(`INSERT INTO feedback_responses (id, question_id, question_version, feature, surface, activity, answer, response_text)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`, [crypto.randomUUID(), question.id, question.version, question.feature, surface, pageActivity[surface as keyof typeof pageActivity], answer, text || null]);
  return json({ saved: true }, { status: 201 });
}

async function triage({ body, database }: SiteInput) {
  const pool = database();
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

export const feedbackPolicy: CollectionPolicy = {
  configKey: 'feedbackEnabled',
  enabled: env => collectionApproved(env.FEEDBACK_COLLECTION_APPROVED, env),
  routes: { 'POST /api/feedback': { handle: save }, 'GET /api/feedback/records': { handle: records, operator: true }, 'POST /api/feedback/records': { handle: triage, operator: true } },
  bytes: limits.feedbackBytes,
  perMinute: limits.feedbackPerMinute,
  rateKey: 'feedback',
  closed: 'Feedback is not being collected.',
  busy: 'Feedback is busy. Try again in a minute.',
  unavailable: 'Feedback could not be saved. Your answer is still here; try again.',
};
