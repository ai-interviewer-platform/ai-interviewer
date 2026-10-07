import assert from 'node:assert/strict';
import { operatorToken, siteHarness } from './site-harness.mjs';

// Every Site collection kind passes the same gate in the same order. Rows that the gate
// rejects use a database that fails when it is touched.
const waitlistPolicy = { version: 'fixture-v1', contactPurpose: 'Fixture invitation only.', operator: 'Fixture operator', contact: 'privacy@example.invalid', retention: 'Until the test ends.', processors: 'Isolated fixture.', emailProvider: 'none', confirmation: 'browser_receipt', deletion: 'Receipt withdrawal.' };
const kinds = [
  { kind: 'Measurement events', path: '/api/measure', operatorPath: '/api/measure/report?start=2026-01-01T00:00:00Z&end=2026-01-02T00:00:00Z', flag: 'MEASUREMENT_COLLECTION_APPROVED', rateKey: 'site:measure', bytes: 4 * 1024 },
  { kind: 'Feedback responses', path: '/api/feedback', operatorPath: '/api/feedback/records', flag: 'FEEDBACK_COLLECTION_APPROVED', rateKey: 'site:feedback', bytes: 8 * 1024 },
  { kind: 'Bug reports', path: '/api/bug-reports', operatorPath: '/api/bug-reports/records', flag: 'BUG_REPORT_COLLECTION_APPROVED', rateKey: 'site:bug-report', bytes: 32 * 1024 },
  { kind: 'Waitlist entries', path: '/api/waitlist', operatorPath: '/api/waitlist/records', flag: 'WAITLIST_COLLECTION_APPROVED', rateKey: 'site:waitlist', bytes: 4 * 1024 },
];
const open = Object.fromEntries(kinds.map(({ flag }) => [flag, 'true']));
const site = await siteHarness('gate', { ...open, WAITLIST_POLICY: JSON.stringify(waitlistPolicy) });
const { pool, request } = site;
const untouched = () => { throw Error('The database was touched before the gate passed'); };
const failing = () => ({ query: async () => { throw Error('connect ECONNREFUSED'); } });
const operatorHeader = { authorization: `Bearer ${operatorToken}` };
const error = async response => (await response.clone().json()).error;
try {
  for (const { kind, path, operatorPath, flag, rateKey, bytes } of kinds) {
    const closed = { [flag]: 'false' };
    const closedResponse = await request(path, {}, {}, closed, untouched);
    assert.equal(closedResponse.status, 503, `${kind}: closed collection`);
    assert.ok(await error(closedResponse), `${kind}: closed collection explains itself`);
    assert.equal((await request(path, {}, { origin: 'https://elsewhere.example' }, closed, untouched)).status, 503, `${kind}: the flag is checked before the origin`);
    assert.equal((await request(path, {}, { origin: 'https://elsewhere.example' }, {}, untouched)).status, 403, `${kind}: wrong origin`);
    assert.equal((await request(path, 'x'.repeat(bytes + 1), {}, {}, untouched)).status, 413, `${kind}: oversized body`);
    assert.equal((await request(path, 'not json', {}, {}, untouched)).status, 400, `${kind}: body that is not JSON`);
    assert.equal((await request(operatorPath, undefined, {}, {}, untouched)).status, 401, `${kind}: Operator route without the Operator token`);
    assert.equal((await request(operatorPath, undefined, { origin: 'https://elsewhere.example' }, {}, untouched)).status, 401, `${kind}: the Operator token is checked before the origin`);
    assert.equal((await request(operatorPath, undefined, operatorHeader, closed)).status, 200, `${kind}: Operator access while collection is closed`);
    assert.equal((await request(operatorPath, undefined, operatorHeader, {}, failing)).status, 503, `${kind}: Operator database failure`);
    const unavailable = await request(path, {}, {}, {}, failing);
    assert.equal(unavailable.status, 503, `${kind}: database failure`);
    assert.notEqual(await error(unavailable), await error(closedResponse), `${kind}: database failure is not reported as closed collection`);
    await pool.query("INSERT INTO security_rate_limits (key, count, expires_at) VALUES ($1, 1000000, now() + interval '1 minute') ON CONFLICT (key) DO UPDATE SET count = 1000000, expires_at = now() + interval '1 minute'", [rateKey]);
    assert.equal((await request(path, {}, {}, {})).status, 429, `${kind}: project-wide rate limit`);
    await pool.query('DELETE FROM security_rate_limits WHERE key = $1', [rateKey]);
    const keys = [];
    const limiter = { limit: async ({ key }) => { keys.push(key); return { success: false }; } };
    assert.equal((await request(path, {}, { 'cf-connecting-ip': '203.0.113.9' }, { [rateKey === 'site:measure' ? 'MEASURE_VISITOR_LIMITER' : 'FORM_VISITOR_LIMITER']: limiter }, untouched)).status, 429, `${kind}: visitor rate limit, before the database`);
    assert.deepEqual(keys, [`${rateKey.slice(5)}:203.0.113.9`], `${kind}: the visitor limit is keyed by kind and address`);
  }
  assert.equal((await request('/api/waitlist/withdraw', { receipt: 'unknown' }, {}, { WAITLIST_COLLECTION_APPROVED: 'false' })).status, 200, 'Withdrawal stays open while the waitlist is closed');
  assert.deepEqual(await (await request('/api/site-config', undefined, {}, { FEEDBACK_COLLECTION_APPROVED: 'false' }, untouched)).json(), { measurementEnabled: true, feedbackEnabled: false, bugReportsEnabled: true, waitlistEnabled: true });
  assert.equal((await (await request('/api/site-config', undefined, {}, { WAITLIST_OPERATOR_TOKEN: '' }, untouched)).json()).waitlistEnabled, false, 'No Operator token means no collection');
  const landing = await (await request('/api/landing-config', undefined, {}, { WAITLIST_COLLECTION_APPROVED: 'false' }, untouched)).json();
  assert.equal(landing.policy.version, 'fixture-v1', 'Landing content stays readable while the waitlist is closed');
  assert.deepEqual(Object.keys(landing).sort(), ['experiment', 'policy', 'primaryAction'], 'The landing configuration holds only landing content');
  console.log('PASS one Site collection gate: fixed order, closed collection, origin, body limit, JSON, Operator token, Operator access while closed, database failure, visitor and project-wide rate limits for every kind');
} finally { await site.close(); }
