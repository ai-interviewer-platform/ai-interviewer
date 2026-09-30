import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import AxeBuilder from '@axe-core/playwright';
import { launchBrowser } from './browser/launch.mjs';
import { assignVariant, variantVersion } from '../public/experiment.js';
import { operatorToken, siteHarness } from './site-harness.mjs';
import { aggregateFrom } from '../tools/marketing/strategy.mjs';

const policy = { version: 'fixture-v1', contactPurpose: 'Fixture invitation only.', operator: 'Fixture operator', contact: 'privacy@example.invalid', retention: 'Until the test ends.', processors: 'Isolated fixture.', emailProvider: 'none', confirmation: 'browser_receipt', deletion: 'Receipt withdrawal.' };
const treatmentCopy = 'See what your practice shows.';
// Fixture numbers only: a 20% baseline and a 60-point effect give a small planned sample.
const start = new Date(Date.now() - 1000).toISOString();
const contract = {
  id: 'hero-fixture', status: 'running', start, hypothesis: 'Naming the evidence raises waitlist intent.', audience: 'Landing documents that are not automated or internal.',
  primaryOutcome: { name: 'cta_selected', action: 'waitlist' }, guardrails: [{ name: 'cta_selected', action: 'sample' }],
  baseline: { start: '2026-01-01T00:00:00.000Z', end: '2026-01-02T00:00:00.000Z' }, minimumEffect: 0.6, alpha: 0.05, power: 0.8,
  identity: 'document', method: 'fixed-horizon-two-proportion',
  variants: [{ id: 'control', weight: 1 }, { id: 'evidence-first', weight: 1, copy: { headline: treatmentCopy } }],
};
const env = { MEASUREMENT_COLLECTION_APPROVED: 'true', WAITLIST_COLLECTION_APPROVED: 'true', WAITLIST_POLICY: JSON.stringify(policy), PERSONAL_DATA_COLLECTION_APPROVED: 'false', LANDING_EXPERIMENT: JSON.stringify(contract) };
const site = await siteHarness('experiment', env);
const { pool, base, request } = site;
const event = (fields = {}) => ({ version: 'coursay-outcomes-v1', id: crypto.randomUUID(), name: 'landing_exposed', surface: 'landing', activity: 'none', action: 'none', authority: 'client', attribution: 'unknown', exposureId: crypto.randomUUID(), ...fields });
const configured = variantId => { let id; do id = crypto.randomUUID(); while (assignVariant(contract, id).id !== variantId); return id; };
const exposure = (exposureId, variantId, fields = {}) => event({ name: 'experiment_exposed', exposureId, experiment: contract.id, variant: variantId, variantVersion: variantVersion(contract.variants.find(item => item.id === variantId)), eligibility: 'eligible', ...fields });
const edgeUserAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0';
// One landing document: exposure, then the chosen outcomes.
async function visit(variantId, outcomes = [], fields = {}, headers = {}) {
  const exposureId = configured(variantId);
  await request('/api/measure', event({ exposureId }));
  await request('/api/measure', exposure(exposureId, variantId, fields), headers);
  for (const action of outcomes) await request('/api/measure', event({ name: 'cta_selected', action, exposureId }));
  return exposureId;
}
const stopped = () => JSON.stringify({ ...contract, status: 'stopped', end: new Date().toISOString() });
const report = async (overrides = {}) => (await request(`/api/measure/report?start=${encodeURIComponent(start)}&end=${encodeURIComponent(new Date(Date.now() + 1000).toISOString())}`, undefined, { authorization: `Bearer ${operatorToken}` }, overrides)).json();

try {
  // Baseline: 10 landing documents on the first of January, 2 of which selected the waitlist.
  for (let index = 0; index < 10; index += 1) {
    const exposureId = crypto.randomUUID();
    await pool.query("INSERT INTO measurement_events (id, name, surface, activity, action, authority, exposure_id, received_at) VALUES ($1, 'landing_exposed', 'landing', 'none', 'none', 'client', $2, '2026-01-01T10:00:00Z')", [crypto.randomUUID(), exposureId]);
    if (index < 2) await pool.query("INSERT INTO measurement_events (id, name, surface, activity, action, authority, exposure_id, received_at) VALUES ($1, 'cta_selected', 'landing', 'none', 'waitlist', 'client', $2, '2026-01-01T10:01:00Z')", [crypto.randomUUID(), exposureId]);
  }
  const config = await (await request('/api/landing-config')).json();
  assert.deepEqual(config.experiment.variants.map(item => item.version), contract.variants.map(variantVersion));
  assert.equal((await (await request('/api/landing-config', undefined, {}, { MEASUREMENT_COLLECTION_APPROVED: 'false' })).json()).experiment, null, 'No experiment without measurement');
  assert.equal((await (await request('/api/landing-config', undefined, {}, { LANDING_EXPERIMENT: stopped() })).json()).experiment, null, 'Rollback serves the control');
  assert.equal((await request('/api/measure', exposure(crypto.randomUUID(), 'control', { eligibility: 'everyone' }))).status, 400);
  assert.equal((await request('/api/measure', exposure(crypto.randomUUID(), 'control', { variant: 'Control' }))).status, 400);
  const invalid = await report({ LANDING_EXPERIMENT: JSON.stringify({ ...contract, alpha: undefined }) });
  assert.equal(invalid.experiment.status, 'invalid');
  assert.deepEqual(invalid.experiment.problems, ['Missing or invalid alpha: the two-sided significance level.']);
  assert.equal((await report({ LANDING_EXPERIMENT: '' })).experiment, null);
  console.log('PASS contract gate, landing configuration, rollback and exposure allowlist');

  // Five documents per variant: below the plan, so no interval.
  for (let index = 0; index < 5; index += 1) { await visit('control', index === 0 ? ['waitlist'] : []); await visit('evidence-first', ['waitlist']); }
  let result = (await report()).experiment;
  assert.equal(result.plan.control, 10, 'Derived: 20% baseline, 60-point effect, alpha 0.05, power 0.8');
  assert.equal(result.baseline.rate, 0.2);
  assert.equal(result.status, 'collecting');
  assert.equal(result.primary, null, 'No interval before the planned sample');
  assert.equal((await report({ LANDING_EXPERIMENT: stopped() })).experiment.status, 'inconclusive', 'Stopping early is inconclusive');
  assert.equal((await report({ LANDING_EXPERIMENT: JSON.stringify({ ...contract, status: 'stopped' }) })).experiment.problems[0], 'Missing or invalid end: when a stopped experiment stopped, after its start.');
  assert.equal((await report({ LANDING_EXPERIMENT: JSON.stringify({ ...contract, baseline: { start: '2025-01-01T00:00:00Z', end: '2025-01-02T00:00:00Z' } }) })).experiment.status, 'plan_unavailable', 'An empty baseline derives nothing');

  for (let index = 0; index < 5; index += 1) { await visit('control', index === 0 ? ['waitlist', 'sample'] : []); await visit('evidence-first', index < 3 ? ['waitlist'] : []); }
  await visit('evidence-first'); // After the horizon: not analyzed.
  // Contamination and exclusions.
  await visit('control', ['waitlist'], {}, { 'user-agent': 'Mozilla/5.0 (compatible; Googlebot/2.1)' });
  await visit('control', ['waitlist'], { eligibility: 'internal' });
  const wrong = configured('control');
  await request('/api/measure', exposure(wrong, 'evidence-first'));
  const mixed = await visit('control');
  await request('/api/measure', exposure(mixed, 'evidence-first'));
  await visit('evidence-first', ['waitlist'], { variantVersion: '00000000' });
  await request('/api/measure', event());
  result = (await report()).experiment;
  assert.deepEqual([result.status, result.reached, result.primary], ['collecting', true, null], 'A running experiment shows progress only, so its result cannot change between reports');
  const final = stopped();
  result = (await report({ LANDING_EXPERIMENT: final })).experiment;
  assert.equal(result.status, 'difference_detected');
  assert.deepEqual(result.variants.map(item => [item.eligible, item.primary]), [[10, { documents: 10, conversions: 2 }], [11, { documents: 10, conversions: 8 }]], 'Fixed horizon: the first planned documents');
  assert.ok(result.primary.interval[0] > 0 && result.primary.confidence === 0.95);
  assert.equal(result.guardrails[0].excludesZero, false);
  assert.deepEqual(result.exclusions, { automation: 1, internal: 1, assignmentMismatch: 1, versionMismatch: 1, mixedVariants: 1 });
  assert.ok(result.missingExposure >= 1, 'A landing document without an exposure is missing data');
  assert.ok(result.limitations.some(line => /not a before\/after/.test(line)) && result.limitations.some(line => /not an automatic winner/.test(line)));
  console.log('PASS derived plan, fixed horizon, interval, guardrails, contamination and missing exposures');

  const browser = await launchBrowser({ headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce', userAgent: edgeUserAgent, timezoneId: 'UTC' });
    await context.addInitScript(() => Object.defineProperty(Navigator.prototype, 'webdriver', { get: () => false }));
    const sent = [];
    context.on('request', item => { if (item.url().endsWith('/api/measure')) sent.push(JSON.parse(item.postData())); });
    const exposures = () => sent.filter(item => item.name === 'experiment_exposed');
    env.LANDING_EXPERIMENT = JSON.stringify({ ...contract, variants: [{ id: 'control', weight: 1e-9 }, contract.variants[1]] });
    const page = await context.newPage();
    await page.goto(base);
    await page.getByRole('heading', { name: treatmentCopy }).waitFor();
    await page.locator('#waitlist-form').waitFor({ state: 'visible' });
    await page.getByRole('link', { name: 'Explore the guided sample' }).click();
    await page.goto(`${base}/#landing`);
    await page.getByRole('heading', { name: treatmentCopy }).waitFor();
    await page.waitForTimeout(300);
    assert.equal(exposures().length, 1, 'One exposure per document, and the variant is stable when the landing returns');
    assert.deepEqual(Object.keys(exposures()[0]).sort(), ['action', 'activity', 'attribution', 'authority', 'eligibility', 'experiment', 'exposureId', 'id', 'name', 'surface', 'variant', 'variantVersion', 'version']);
    assert.deepEqual([exposures()[0].variant, exposures()[0].eligibility], ['evidence-first', 'eligible']);
    const internal = await context.newPage();
    await internal.goto(`${base}/#landing?internal`);
    await internal.locator('#waitlist-form').waitFor({ state: 'visible' });
    await internal.waitForTimeout(300);
    assert.equal(exposures().at(-1).eligibility, 'internal');

    const automated = await browser.newContext({ userAgent: edgeUserAgent });
    const automatedSent = [];
    automated.on('request', item => { if (item.url().endsWith('/api/measure')) automatedSent.push(JSON.parse(item.postData())); });
    await (await automated.newPage()).goto(base);
    await new Promise(done => setTimeout(done, 800));
    assert.equal(automatedSent.find(item => item.name === 'experiment_exposed')?.eligibility, 'automation', 'navigator.webdriver marks automation');
    await automated.close();

    const quiet = await browser.newContext();
    await quiet.addInitScript(() => Object.defineProperty(Navigator.prototype, 'globalPrivacyControl', { get: () => true }));
    const privatePage = await quiet.newPage();
    await privatePage.goto(base);
    await privatePage.locator('#waitlist-form').waitFor({ state: 'visible' });
    assert.equal(await privatePage.locator('#landing-title').innerText(), 'Make your thinking\npart of the answer.', 'Global Privacy Control keeps the control');
    await quiet.close();

    env.LANDING_EXPERIMENT = stopped();
    const before = exposures().length;
    const rollback = await context.newPage();
    await rollback.goto(base);
    await rollback.locator('#waitlist-form').waitFor({ state: 'visible' });
    await rollback.waitForTimeout(300);
    assert.equal(await rollback.locator('#landing-title').innerText(), 'Make your thinking\npart of the answer.');
    assert.equal(exposures().length, before, 'A stopped experiment shows the control and sends no exposure');
    console.log('PASS browser assignment, stable copy, eligibility, Global Privacy Control and rollback');

    env.LANDING_EXPERIMENT = final;
    const inspect = await context.newPage();
    await inspect.goto(`${base}/#operator`);
    await inspect.getByLabel('Operator token').fill(operatorToken);
    await inspect.getByLabel('Window start').fill(new Date(Date.parse(start) - 60_000).toISOString().slice(0, 16));
    await inspect.getByLabel('Window end').fill(new Date(Date.now() + 120_000).toISOString().slice(0, 16));
    await inspect.getByRole('button', { name: 'Load report' }).click();
    await inspect.getByRole('heading', { name: 'Landing experiment' }).waitFor();
    const text = await inspect.locator('#operator-report').innerText();
    assert.match(text, /not an automatic winner/);
    assert.match(text, /95% interval/);
    assert.match(text, /Naming the evidence raises waitlist intent/);
    assert.deepEqual((await new AxeBuilder({ page: inspect }).include('#main').analyze()).violations.map(item => item.id), []);
    const download = inspect.waitForEvent('download');
    await inspect.getByRole('button', { name: 'Download aggregate report (JSON)' }).click();
    const file = await download;
    assert.match(file.suggestedFilename(), /^coursay-report-.*\.json$/);
    const aggregate = aggregateFrom(JSON.parse(await readFile(await file.path(), 'utf8')));
    assert.ok(aggregate.landing.documents > 0, 'The local content-planning tool imports the downloaded report');
    console.log('PASS operator experiment report and an aggregate download the content-planning tool imports');
  } finally { await browser.close(); }
} finally { await site.close(); }
