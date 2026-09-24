// Real signed-in journey against a local stack: `npm run runner:dev` plus
// `npm run dev:runner`, local PostgreSQL, and collection approved in .dev.vars.
// Creates a fictional account; it is retained for inspection.
import { launchBrowser } from './launch.mjs';
import AxeBuilder from '@axe-core/playwright';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';

const base = process.env.APP_URL;
if (!base) throw new Error('Set APP_URL to the running app.');
assert.ok(['localhost', '127.0.0.1'].includes(new URL(base).hostname), 'Use a local Worker only');
const browser = await launchBrowser({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (error) => errors.push(error.message + ' ' + (error.stack ?? '').split('\n').slice(0, 3).join(' | ')));
const api = (path) => page.evaluate(async (url) => (await fetch(url, { credentials: 'same-origin' })).json(), path);
const alert = () => page.locator('#personal-error').innerText();
const axe = async (screen) => {
  const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
  assert.deepEqual(result.violations.map((violation) => `${screen}: ${violation.id} ${violation.nodes.map((node) => node.target).join(' ')}`), []);
};
try {
  await page.goto(`${base}/#personal`);
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.getByLabel('Display name').fill('Fictional flow check');
  await page.getByLabel('Email').fill(`flow-${randomUUID()}@example.invalid`);
  await page.getByLabel('Password').fill(randomBytes(18).toString('base64url'));
  await page.locator('#personal-auth-form button[type="submit"]').click();
  await page.getByRole('heading', { name: /Start with the work/ }).waitFor();
  await axe('dashboard');
  const status = page.locator('.catalog-filters [role="status"]');
  await page.getByLabel('Difficulty').selectOption('Hard');
  const [shown, total] = (await status.innerText()).match(/\d+/g).map(Number);
  assert.ok(shown > 0 && shown < total, 'Difficulty filter narrows the catalog');
  await page.getByLabel('Difficulty').selectOption('');
  console.log('Passed: sign-up, signed-in dashboard, and catalog filters');

  const catalog = await api('/api/catalog');
  const problem = catalog.problems.find((item) => item.id === 'sum-odd-positions-v1');
  assert.ok(problem, 'Seeded problem is in the catalog');
  assert.ok(problem.starter_code.includes('\n'), 'Starter code has real line breaks');
  await page.getByLabel('Topic').selectOption(problem.topic);
  await page.locator(`[data-start-problem="${problem.id}"]`).click();
  await page.getByRole('radio', { name: /^Text/ }).check();
  await page.getByRole('checkbox', { name: /Allow Deepgram processing/ }).check();
  await page.getByRole('button', { name: 'Start interview' }).click();
  await page.locator('#personal-code').waitFor();
  console.log('Passed: setup and consent create an attempt');

  await page.getByLabel('Message the interviewer').fill('I will slice from index one with a step of two.');
  await page.getByRole('button', { name: 'Send message' }).click();
  await page.locator('.messages').getByText('I will slice from index one').waitFor();

  await page.locator('#personal-code').fill('def sum_odd_positions(values):\n    return -1\n');
  await page.getByRole('button', { name: 'Run visible tests' }).click();
  await page.locator('#personal-error').getByText(/Run recorded/).waitFor({ timeout: 60_000 });
  assert.match(await alert(), /0 passed, 2 failed/);
  assert.equal(await page.locator('.test-case.failed').count(), 2);
  assert.match(await page.locator('.test-cases').innerText(), /sum_odd_positions\(\[4, 7, 2, 9\]\)[\s\S]*Expected 16 · got -1/);
  await page.locator('#personal-code').fill('def sum_odd_positions(values):\n    return sum(values[1::2])\n');
  await page.getByRole('button', { name: 'Run visible tests' }).click();
  await page.locator('#personal-error').getByText(/2 passed, 0 failed/).waitFor({ timeout: 60_000 });
  assert.equal(await page.locator('.test-case.passed').count(), 2);
  await axe('workspace');
  console.log('Passed: text message, failing run, passing run through the isolated runner');

  await page.getByRole('button', { name: 'Request help' }).click();
  await page.locator('#personal-error').getByText(/hint request was recorded/).waitFor();

  const attemptId = await page.evaluate(async () => (await (await fetch('/api/attempts')).json()).attempts[0].id);
  const detail = await api(`/api/attempts/${attemptId}`);
  const offsets = detail.events.map((event) => event.occurrence_offset_ms);
  assert.deepEqual(offsets, [...offsets].sort((a, b) => a - b), 'Timeline is ordered');
  const order = detail.events.map((event) => event.event_type);
  assert.ok(order.indexOf('candidate_text') < order.lastIndexOf('code_run'), `Message precedes the last run: ${order.join(', ')}`);
  assert.ok(order.lastIndexOf('code_run') < order.indexOf('help_requested'), `Run precedes help: ${order.join(', ')}`);
  console.log('Passed: evidence timeline preserves the order of actions');

  await page.getByRole('button', { name: 'Finish interview' }).click();
  await page.locator('#personal-error').getByText(/Attempt completed/).waitFor();
  assert.equal(await page.locator('#personal-code').isDisabled(), true);
  let review;
  for (let i = 0; i < 20 && review?.review.status !== 'failed' && review?.review.status !== 'ready'; i++) {
    await page.waitForTimeout(500);
    review = await api(`/api/attempts/${attemptId}/review`);
  }
  assert.ok(['failed', 'ready'].includes(review.review.status), 'Queue consumer settles the review');
  console.log(`Passed: finish freezes evidence; review ${review.review.status}${review.review.failure_reason ? ` (${review.review.failure_reason})` : ''}`);

  await page.getByRole('button', { name: '← Sessions' }).click();
  await page.getByRole('heading', { name: /Start with the work/ }).waitFor();
  assert.match(await page.locator('.home-history').innerText(), /Sum odd positions[\s\S]*completed/);
  // A multi-argument problem from the public bank uses the positional contract.
  await page.getByLabel('Topic').selectOption('Bit manipulation');
  while (!(await page.locator('[data-start-problem="mbpp-6-v1"]').count())) await page.locator('[data-more-problems]').click();
  await page.locator('[data-start-problem="mbpp-6-v1"]').click();
  await page.getByRole('radio', { name: /^Text/ }).check();
  await page.getByRole('checkbox', { name: /Allow Deepgram processing/ }).check();
  await page.getByRole('button', { name: 'Start interview' }).click();
  await page.locator('#personal-code').fill('def differ_At_One_Bit_Pos(a, b):\n    return bin(a ^ b).count("1") == 1\n');
  await page.getByRole('button', { name: 'Run visible tests' }).click();
  await page.locator('#personal-error').getByText(/3 passed, 0 failed/).waitFor({ timeout: 60_000 });
  assert.match(await page.locator('.test-cases').innerText(), /differ_At_One_Bit_Pos\(13, 9\)/);
  await page.getByRole('button', { name: '← Sessions' }).click();
  console.log('Passed: public-bank problem with several arguments');

  await page.getByRole('button', { name: 'Sign out' }).click();
  await page.getByRole('button', { name: 'Create account' }).waitFor();
  assert.deepEqual(errors, []);
  console.log('Passed: sign out');
} finally {
  await browser.close();
}
