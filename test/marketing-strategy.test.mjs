import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { serve } from '../tools/marketing/server.mjs';
import { launchBrowser } from './browser/launch.mjs';
import AxeBuilder from '@axe-core/playwright';

export const proposal = {
  title: 'Show the reasoning', audienceNeed: 'Practice explaining a Python solution under interview conditions.',
  hypotheses: [{ text: 'Showing a revision may make practice easier to understand.', evidenceIds: ['0:visual:0'] }],
  positioning: 'Practice the explanation, test, review and retry loop.', format: 'Screen recording', channel: 'YouTube Shorts',
  cta: 'Join the waitlist', launchAction: 'waitlist', measurement: { event: 'Sample started', denominator: 'Landing-page visits' },
  assumptions: ['Channel access and launch action need owner confirmation.'],
  hook: 'Can you explain why your solution works?',
  script: [{ text: 'Explain a solution. Run the tests. Review the recorded evidence. Retry.', factIds: ['explain', 'test', 'review', 'retry'] }],
  creativeNotes: 'Adapt the visible problem-to-demonstration structure; record original Coursay footage.',
};
export const safeAudit = { unsupportedProductClaims: [], inventedPerformance: [], brokenEvidence: [], copiedSourceScript: [], ctaMismatch: [] };

export async function strategyFixture(t, providerResult = () => proposal, auditResult = () => safeAudit, landing = { primaryAction: 'waitlist', waitlistEnabled: true }) {
  const directory = await mkdtemp(join(tmpdir(), 'marketing-strategy-'));
  const app = await serve({ directory, env: { DASHSCOPE_API_KEY: 'fixture', DASHSCOPE_BASE_URL: 'https://dashscope-intl.aliyuncs.com', QWEN_COVERED_USAGE_CONFIRMED: 'true', STRATEGY_LAUNCH_BASE_URL: 'https://coursay.example' }, fetch: async (_url, options) => {
    if (_url.endsWith('/api/landing-config')) return Response.json(landing);
    if (_url.endsWith('/api/personal-availability')) return Response.json({ collectionEnabled: true, mvpReady: true });
    const request = JSON.parse(options.body), system = request.messages[0].content;
    const content = system.includes('STRATEGY_GENERATE') ? providerResult(JSON.parse(request.messages[1].content))
      : system.includes('STRATEGY_AUDIT') ? auditResult(JSON.parse(request.messages[1].content))
        : { observations: [{ description: 'A problem is followed by a product demonstration.', region: 'center' }], gaps: [] };
    return Response.json({ model: request.model, choices: [{ message: { content: JSON.stringify(content) } }], usage: { total_tokens: 20 } });
  } });
  t.after(async () => { await app.close(); await rm(directory, { recursive: true, force: true }); });
  const post = async (path, body) => {
    const response = await fetch(app.url + path, { method: 'POST', headers: { Origin: app.url, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
  };
  const run = await post('/api/import', { url: 'https://example.com/creative.png', kind: 'image' });
  await (await fetch(app.url + '/api/events/' + run.body.id)).text();
  const source = (await (await fetch(app.url + '/api/runs')).json())[0].sources[0];
  const input = { goals: 'First practice completed', audience: 'New grads preparing for Python SWE interviews', factIds: ['explain', 'test', 'review', 'retry'], sources: [{ runId: run.body.id, sourceId: source.id }] };
  return { app, post, input };
}

test('operator generates a source-linked draft, reviews it, then uses outcomes in the next experiment', async t => {
  let nextInput;
  const { app, post, input } = await strategyFixture(t, value => { nextInput = value; return proposal; });
  const generated = await post('/api/strategy/generate', input);
  assert.equal(generated.status, 200);
  assert.equal(generated.body.status, 'needs-review');
  assert.equal(generated.body.evidence[0].url, 'https://example.com/creative.png');
  assert.equal(generated.body.evidence[0].observation.region, 'center');
  assert.equal(generated.body.proposal.hook, 'Can you explain why your solution works?');
  assert.equal(generated.body.distributionStatus, 'proposed');
  const id = generated.body.id;
  assert.equal((await post(`/api/strategy/${id}/review`, { decision: 'approve', reviewer: 'Owner' })).status, 400);
  const reviewed = await post(`/api/strategy/${id}/review`, { decision: 'approve', reviewer: 'Owner', rationale: 'Checked the source and original script.', choices: { format: proposal.format, channel: proposal.channel, access: 'I can publish on my own channel.', sequencing: 'Organic first; paid remains unapproved.', launchAction: 'waitlist', cta: proposal.cta } });
  assert.equal(reviewed.body.status, 'approved');
  const outcome = await post(`/api/strategy/${id}/outcomes`, { reviewer: 'Owner', measurement: 'No observed conversions yet.', feedback: 'The retry step was unclear.', nextChange: 'Show the retry transition.', evidence: 'Operator interview notes, 2026-09-29' });
  assert.equal(outcome.body.outcomes[0].nextChange, 'Show the retry transition.');
  await post('/api/strategy/generate', { ...input, previousId: id });
  assert.equal(nextInput.previous.outcomes[0].feedback, 'The retry step was unclear.');
  const saved = await (await fetch(app.url + '/api/strategy')).json();
  assert.equal(saved.drafts.length, 2);
  assert.equal(saved.drafts.find(item => item.id === id).reviews[0].reviewer, 'Owner');
});

test('strategy rejects unsupported facts, broken evidence and invented performance before human approval', async t => {
  let output = structuredClone(proposal), audit = structuredClone(safeAudit);
  const { post, input } = await strategyFixture(t, () => output, () => audit);
  assert.equal((await post('/api/strategy/generate', { ...input, factIds: ['cpp'] })).status, 400);
  output.hypotheses[0].evidenceIds = ['missing-source'];
  let result = await post('/api/strategy/generate', input);
  assert.equal(result.body.status, 'rejected');
  assert.match(result.body.problems.join(' '), /Broken evidence link/);
  output = structuredClone(proposal);
  output.script[0] = { text: 'Practice C++ interviews.', factIds: ['cpp'] };
  result = await post('/api/strategy/generate', input);
  assert.match(result.body.problems.join(' '), /Unsupported product claim/);
  output = structuredClone(proposal);
  output.hook = 'Coursay doubles your chances of being hired.';
  audit.inventedPerformance = ['No measured hiring outcomes support doubling chances.'];
  result = await post('/api/strategy/generate', input);
  assert.equal(result.body.status, 'rejected');
  assert.match(result.body.problems.join(' '), /inventedPerformance/);
  assert.equal((await post(`/api/strategy/${result.body.id}/review`, { decision: 'approve', reviewer: 'Owner', rationale: 'Looks fine' })).status, 400);
});

test('strategy fails closed when the claim auditor is unavailable or incomplete', async t => {
  const { post, input } = await strategyFixture(t, () => proposal, () => ({ unsupportedProductClaims: [] }));
  const result = await post('/api/strategy/generate', input);
  assert.equal(result.body.status, 'rejected');
  assert.match(result.body.problems.join(' '), /Incomplete claim audit/);
});

test('approval rejects a waitlist CTA when the owner and live landing select personal practice', async t => {
  const candidate = structuredClone(proposal); let mismatches = [];
  const { post, input } = await strategyFixture(t, () => candidate, () => ({ ...safeAudit, ctaMismatch: mismatches }), { primaryAction: 'personal_practice', waitlistEnabled: false });
  const draft = (await post('/api/strategy/generate', input)).body;
  const result = await post(`/api/strategy/${draft.id}/review`, { decision: 'approve', reviewer: 'Owner', rationale: 'Reviewed', choices: { format: proposal.format, channel: proposal.channel, cta: proposal.cta, access: 'Own channel', sequencing: 'Organic first', launchAction: 'personal_practice' } });
  assert.equal(result.status, 400);
  assert.match(result.body.error, /launch action/);
  candidate.launchAction = 'personal_practice';
  mismatches = ['Join the waitlist does not start a personal practice Attempt.'];
  assert.equal((await post('/api/strategy/generate', input)).body.status, 'rejected');
  candidate.cta = 'Start a practice Attempt'; mismatches = [];
  const corrected = (await post('/api/strategy/generate', input)).body;
  const approved = await post(`/api/strategy/${corrected.id}/review`, { decision: 'approve', reviewer: 'Owner', rationale: 'Reviewed matching action', choices: { format: candidate.format, channel: candidate.channel, cta: candidate.cta, access: 'Own channel', sequencing: 'Organic first', launchAction: 'personal_practice' } });
  assert.equal(approved.body.status, 'approved');
  delete candidate.launchAction;
  assert.equal((await post('/api/strategy/generate', input)).body.status, 'rejected');
});

test('developer reviews and exports a strategy brief in the browser at desktop and mobile widths', async t => {
  const { app } = await strategyFixture(t);
  const browser = await launchBrowser({ headless: true }); t.after(() => browser.close());
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(app.url);
  await page.getByRole('button', { name: 'Strategy & scripts', exact: true }).click();
  await page.getByLabel('Goal', { exact: true }).fill('Complete a first practice');
  await page.locator('#strategy-sources input').check();
  await page.getByRole('button', { name: 'Generate draft', exact: true }).click();
  await page.waitForFunction(() => document.getElementById('strategy-status').textContent.includes('needs-review'));
  assert.match(await page.locator('#strategy-detail').innerText(), /Can you explain why your solution works/);
  await page.locator('#strategy-detail details summary').first().click();
  assert.equal(await page.getByRole('link', { name: 'Open original source' }).getAttribute('href'), 'https://example.com/creative.png');
  await page.getByLabel('Reviewer / owner').fill('Owner');
  await page.getByLabel('Review rationale').fill('Checked evidence and product proof.');
  await page.getByLabel('Channel / community access').fill('My channel');
  await page.getByLabel('Organic / paid sequencing').fill('Organic first; no ad spend approved.');
  await page.getByLabel('Actual landing action').selectOption('waitlist');
  await page.getByRole('button', { name: 'Approve brief', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.brief-state').textContent.includes('owner-approved'));
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export review artifact', exact: true }).click();
  assert.match((await download).suggestedFilename(), /-strategy.json$/);
  await page.getByLabel('Outcome recorder').fill('Owner');
  await page.getByLabel('Observed measurement — include unknowns').fill('Unknown conversions');
  await page.getByLabel('Feedback received').fill('Show the retry');
  await page.getByLabel('Change to try next').fill('Include retry footage');
  await page.getByLabel('Outcome evidence reference').fill('Operator notes');
  await page.getByRole('button', { name: 'Save outcome', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('#strategy-detail pre').textContent.includes('Include retry footage'));
  await page.setViewportSize({ width: 1440, height: 1000 });
  await mkdir('.local/marketing', { recursive: true });
  await page.screenshot({ path: '.local/marketing/strategy-desktop.png', fullPage: true });
  assert.deepEqual((await new AxeBuilder({ page }).analyze()).violations.map(item => ({id:item.id,nodes:item.nodes.map(node=>({target:node.target,summary:node.failureSummary}))})), []);
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.screenshot({ path: '.local/marketing/strategy-mobile.png', fullPage: true });
  await page.reload();
  await page.getByRole('button', { name: 'Strategy & scripts', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.brief-state')?.textContent.includes('owner-approved'));
});
