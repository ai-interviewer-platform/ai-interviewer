import assert from 'node:assert/strict';
import AxeBuilder from '@axe-core/playwright';
import { pageActivity } from '../public/measurement-contract.js';
import { launchBrowser } from './browser/launch.mjs';
import { operatorToken, siteHarness } from './site-harness.mjs';

const site = await siteHarness('bugs', { BUG_REPORT_COLLECTION_APPROVED: 'true', FEEDBACK_COLLECTION_APPROVED: 'true', MEASUREMENT_COLLECTION_APPROVED: 'true', PERSONAL_DATA_COLLECTION_APPROVED: 'false' });
const { pool, base, request, operator } = site;
const report = (fields = {}) => ({ surface: 'sample', expected: 'The run shows test results.', actual: 'The run button spins forever.', steps: 'Open the sample, run tests.', diagnostics: { browser: 'Firefox', os: 'Linux', viewport: 'wide', viewportWidth: 1300, online: true, errors: ['TypeError'] }, ...fields });
const records = async (query = '') => (await operator(`/api/bug-reports/records${query}`)).records;
const authorization = { authorization: `Bearer ${operatorToken}` };
try {
  assert.equal((await (await request('/api/site-config', undefined, {}, { BUG_REPORT_COLLECTION_APPROVED: 'false' })).json()).bugReportsEnabled, false);
  assert.equal((await request('/api/bug-reports', report(), {}, { BUG_REPORT_COLLECTION_APPROVED: 'false' })).status, 503);
  assert.equal((await request('/api/bug-reports', report(), { origin: 'https://elsewhere.example' })).status, 403);
  assert.equal((await request('/api/bug-reports', report({ surface: 'nowhere' }))).status, 400);
  for (const invalid of [{ expected: ' ' }, { actual: '' }, { steps: 'x'.repeat(4001) }, { contactEmail: 'me@example.invalid' }, { contactConsent: true }, { contactEmail: 'not-an-address', contactConsent: true }]) {
    const response = await request('/api/bug-reports', report(invalid));
    assert.equal(response.status, 400, JSON.stringify(invalid).slice(0, 80));
    assert.ok((await response.json()).field, 'A validation error names its field');
  }
  const unsafe = await request('/api/bug-reports', report({ surface: 'other', diagnostics: { browser: 'Netscape', os: 'Linux', viewportWidth: 1337, online: 'yes', errors: ['TypeError', 'Cannot read secret-token of undefined', ...Array(9).fill('Error')], userAgent: 'Mozilla/5.0 secret', log: 'console dump', code: 'def solve(): pass', transcript: 'I said' } }), { cookie: 'better-auth.session_token=fixture' });
  assert.equal(unsafe.status, 201, 'A page outside the app, a signed-in cookie and bad diagnostics never block a report');
  const acknowledged = await unsafe.json();
  assert.match(acknowledged.reference, /^BR-[0-9A-F]{8}$/);
  const withContact = await (await request('/api/bug-reports', report({ contactEmail: 'Reply@Example.invalid', contactConsent: true, steps: 'Sent Authorization: Bearer abc.def-123 with sk-live_abcdefghijklmnop and password=hunter2 and 4f9c2a7e1b3d5f6a8c0e2b4d6f8a1c3e5b7d9f0a.' }))).json();
  assert.equal((await request('/api/bug-reports/records')).status, 401);
  const stored = await records();
  assert.equal(stored.length, 2);
  const cleaned = stored.find(item => item.reference === acknowledged.reference);
  assert.deepEqual(cleaned.diagnostics, { os: 'Linux', viewportWidth: 1300, errors: ['TypeError', 'Error', 'Error', 'Error', 'Error'] }, 'Only allowlisted diagnostic values are kept, widths are rounded');
  assert.deepEqual([cleaned.surface, cleaned.feature, cleaned.activity, cleaned.contact_email], ['other', 'other', 'none', null]);
  assert.doesNotMatch(JSON.stringify(stored), /secret|console dump|def solve|I said|Mozilla/);
  const replying = stored.find(item => item.reference === withContact.reference);
  assert.equal(replying.steps, 'Sent Authorization: [removed] with [removed] and [removed] and [removed].', 'Anything shaped like a secret is removed from report text');
  assert.equal(replying.contact_email, 'reply@example.invalid');
  assert.equal(replying.contact_purpose, 'Jack Cao may email this address only about this report. The address is erased when the report is closed.');
  assert.equal((await records('?surface=sample')).length, 1);
  assert.equal((await records('?feature=practice&status=new')).length, 1);
  assert.equal((await request('/api/bug-reports/records?status=lost', undefined, authorization)).status, 400);
  const investigating = await operator('/api/bug-reports/records', { id: replying.id, status: 'investigating', investigation: 'Reproduced in Firefox with a slow runner.' });
  assert.deepEqual([investigating.record.status, investigating.record.investigation, investigating.record.contact_email], ['investigating', 'Reproduced in Firefox with a slow runner.', 'reply@example.invalid']);
  assert.equal((await request('/api/bug-reports/records', { id: replying.id, status: 'fixed' }, authorization)).status, 400, 'Closing needs a resolution');
  const fixed = await operator('/api/bug-reports/records', { id: replying.id, status: 'fixed', resolution: 'Runner timeout now reports an error.' });
  assert.equal(fixed.record.investigation, 'Reproduced in Firefox with a slow runner.', 'Notes that are not sent stay');
  assert.deepEqual([fixed.record.status, fixed.record.resolution, fixed.record.contact_email, fixed.record.contact_purpose], ['fixed', 'Runner timeout now reports an error.', null, null], 'Closing erases the reply address');
  assert.equal(fixed.record.actual, replying.actual, 'The original report is preserved');
  await assert.rejects(pool.query("UPDATE bug_reports SET actual = 'rewritten' WHERE id = $1", [replying.id]), /original bug report is immutable/);
  await assert.rejects(pool.query("UPDATE bug_reports SET contact_email = 'new@example.invalid' WHERE id = $1", [cleaned.id]), /original bug report is immutable/);
  const withdrawn = await (await request('/api/bug-reports', report({ contactEmail: 'withdraw@example.invalid', contactConsent: true }))).json();
  const withdrawing = (await records()).find(item => item.reference === withdrawn.reference);
  const erased = await operator('/api/bug-reports/records', { action: 'erase-contact', id: withdrawing.id });
  assert.deepEqual([erased.record.status, erased.record.contact_email, erased.record.contact_purpose], ['new', null, null], 'Reply permission can be withdrawn while the report stays open');
  await operator('/api/bug-reports/records', { action: 'delete', id: withdrawing.id });
  await operator('/api/bug-reports/records', { action: 'delete', id: cleaned.id });
  assert.equal((await records()).length, 1);
  await pool.query('DELETE FROM bug_reports');
  console.log('PASS bug-report gate, origin, field errors, reply permission, diagnostic allowlist, session independence, private triage, contact erasure, immutability');

  const browser = await launchBrowser({ headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' });
    const page = await context.newPage();
    await page.route('**/api/measure', route => route.abort());
    await page.route('**/api/feedback', route => route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"Feedback outage."}' }));
    const toggle = page.getByRole('button', { name: 'Report a problem', exact: true });
    await page.goto(`${base}/#interview`);
    await page.getByRole('button', { name: 'Feedback', exact: true }).click();
    await page.getByLabel('Somewhat confusing').check();
    await page.getByRole('button', { name: 'Send feedback' }).click();
    await page.getByText('Feedback outage.').waitFor();
    await page.getByRole('button', { name: 'Cancel' }).click();
    await page.locator('#message').fill('MY PRIVATE TRANSCRIPT');
    await page.addScriptTag({ content: "setTimeout(() => { throw new TypeError('secret-detail in handler'); });" });
    await page.waitForTimeout(50);
    await toggle.focus();
    await page.keyboard.press('Enter');
    assert.equal(await toggle.getAttribute('aria-expanded'), 'true');
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'bug-expected', 'Focus moves to the first field');
    const shown = await page.locator('#bug-diagnostics').innerText();
    for (const detail of [/Page\s+interview/, /Activity\s+sample/, /Browser\s+Chrome/, /Operating system\s+Linux/, /Viewport\s+wide, about 1300 px/, /Online\s+yes/, /Recent errors\s+.*TypeError/]) assert.match(shown, detail);
    assert.doesNotMatch(shown, /secret-detail|PRIVATE TRANSCRIPT/);
    assert.deepEqual((await new AxeBuilder({ page }).include('#site-support').analyze()).violations.map(item => item.id), []);
    await page.getByRole('button', { name: 'Send report' }).click();
    assert.equal(await page.locator('#bug-expected').getAttribute('aria-invalid'), 'true');
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'bug-expected', 'The first invalid field takes focus');
    await page.getByLabel('What did you expect?').fill('The message is added to the conversation.');
    await page.getByLabel('What happened instead?').fill('Nothing appeared.');
    await page.getByLabel(/Reply address/).fill('person@example.invalid');
    await page.getByRole('button', { name: 'Send report' }).click();
    assert.equal(await page.getByRole('checkbox', { name: /may email this address only about this report/ }).getAttribute('aria-invalid'), 'true', 'A reply address needs its stated purpose');
    await page.getByRole('checkbox', { name: /may email this address only about this report/ }).check();
    await page.route('**/api/bug-reports', route => route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"Fixture database outage."}' }));
    await page.getByRole('button', { name: 'Send report' }).click();
    await page.getByText(/Fixture database outage/).waitFor();
    assert.equal(await page.getByRole('link', { name: 'jack.cao@utdallas.edu' }).getAttribute('href'), 'mailto:jack.cao@utdallas.edu', 'A failed save offers the contact channel');
    assert.equal(await page.getByLabel('What happened instead?').inputValue(), 'Nothing appeared.', 'A failed save keeps the report');
    await page.unroute('**/api/bug-reports');
    await page.getByRole('button', { name: 'Send report' }).click();
    const saved = await page.locator('#bug-saved').innerText();
    const reference = saved.match(/BR-[0-9A-F]{8}/)[0];
    assert.match(saved, /private.*not posted publicly/i);
    const [row] = await records();
    assert.deepEqual([row.reference, row.surface, row.feature, row.activity, row.contact_email, row.diagnostics.os, row.diagnostics.errors.includes('TypeError')], [reference, 'interview', 'practice', 'sample', 'person@example.invalid', 'Linux', true]);
    assert.doesNotMatch(JSON.stringify(row), /secret-detail|PRIVATE TRANSCRIPT|HeadlessChrome|127\.0\.0\.1/);
    await page.keyboard.press('Escape');

    await toggle.click();
    await page.getByLabel('Include these details').uncheck();
    await page.getByLabel('What did you expect?').fill('No diagnostics.');
    await page.getByLabel('What happened instead?').fill('Checked the opt-out.');
    await page.getByRole('button', { name: 'Send report' }).click();
    await page.locator('#bug-saved').waitFor();
    assert.deepEqual((await records()).find(item => item.expected === 'No diagnostics.').diagnostics, {}, 'Diagnostics stay out when unchecked');

    // The bug path is reachable on every page, including one outside the app, and names that page.
    for (const route of [...Object.keys(pageActivity), 'operator']) {
      await page.goto(`${base}/#${route}`);
      await page.locator('h1, #personal-app').first().waitFor();
      await toggle.click();
      assert.match(await page.locator('#bug-diagnostics').innerText(), new RegExp(`Page\\s+${route === 'operator' ? 'other' : route}\\n`));
      await page.keyboard.press('Escape');
    }

    await context.addCookies([{ name: 'better-auth.session_token', value: 'fixture-signed-in', url: base }]);
    const broken = await context.newPage();
    await broken.route('**/app.js', route => route.abort());
    await broken.route('**/feedback-questions.js', route => route.abort());
    await broken.route('**/api/site-config', route => route.abort());
    await broken.goto(`${base}/#review`);
    await broken.getByRole('button', { name: 'Report a problem', exact: true }).click();
    await broken.getByLabel('What did you expect?').fill('The review loads.');
    await broken.getByLabel('What happened instead?').fill('The page stayed empty.');
    await broken.getByRole('button', { name: 'Send report' }).click();
    await broken.locator('#bug-saved').waitFor();
    await broken.close();
    assert.equal((await records('?surface=review')).length, 1, 'The bug path works signed in, when the application script and the feedback module fail');

    const closed = await context.newPage();
    await closed.route('**/api/site-config', route => route.fulfill({ contentType: 'application/json', body: '{"bugReportsEnabled":false}' }));
    await closed.goto(`${base}/#landing`);
    await closed.getByRole('button', { name: 'Report a problem', exact: true }).click();
    assert.match(await closed.locator('#bug-panel').innerText(), /not collected here yet.*jack\.cao@utdallas\.edu/s);
    await closed.close();
    console.log('PASS bug control: diagnostics shown first, field errors, reply purpose, failure recovery, acknowledgement, opt-out, app failure and disabled fallback');

    const inspect = await context.newPage();
    await inspect.goto(`${base}/#operator`);
    await inspect.getByLabel('Operator token').fill(operatorToken);
    await inspect.getByLabel('Bug status').selectOption('new');
    await inspect.getByLabel('Bug page').selectOption('interview');
    await inspect.getByLabel('Bug feature').selectOption('practice');
    await inspect.getByRole('button', { name: 'Load bug reports' }).click();
    const card = inspect.locator('.triage-record', { hasText: reference });
    assert.match(await card.innerText(), /Nothing appeared\.[\s\S]*Linux[\s\S]*person@example\.invalid/);
    await card.getByLabel('Status').selectOption('investigating');
    await card.getByLabel('Investigation').fill('Composer ignores Enter while the reply is pending.');
    await card.getByRole('button', { name: 'Save triage' }).click();
    await card.getByText('Saved.').waitFor();
    await card.getByLabel('Status').selectOption('fixed');
    await card.getByLabel('Resolution').fill('Enter now queues the message.');
    await card.getByRole('button', { name: 'Save triage' }).click();
    await card.getByText('Saved.').waitFor();
    const [done] = await records('?status=fixed');
    assert.deepEqual([done.reference, done.investigation, done.resolution, done.contact_email], [reference, 'Composer ignores Enter while the reply is pending.', 'Enter now queues the message.', null]);
    assert.deepEqual((await new AxeBuilder({ page: inspect }).include('#main').analyze()).violations.map(item => item.id), []);
    console.log('PASS browser report → private operator investigation, resolution and reply-address erasure');
  } finally { await browser.close(); }
} finally { await site.close(); }
