// Deterministic frontend proof only: API responses are mocked, no account or session is created.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import test from 'node:test';
import { launchBrowser } from './browser/launch.mjs';

const publicRoot = resolve(import.meta.dirname, '../public');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };

async function serve(run) {
  const server = createServer(async (request, response) => {
    const pathname = new URL(request.url, 'http://localhost').pathname;
    const file = resolve(publicRoot, pathname === '/' ? 'index.html' : `.${pathname}`);
    if (!file.startsWith(`${publicRoot}${sep}`)) return response.writeHead(404).end();
    try { response.writeHead(200, { 'content-type': types[extname(file)] || 'application/octet-stream' }).end(await readFile(file)); }
    catch { response.writeHead(404).end(); }
  });
  await new Promise(resolveListen => server.listen(0, '127.0.0.1', resolveListen));
  try { await run(`http://127.0.0.1:${server.address().port}`); }
  finally { await new Promise(resolveClose => server.close(resolveClose)); }
}

test('mocked account navigation, authentication modes, personal session flow, and session footer boundary', async () => {
  await serve(async base => {
    const browser = await launchBrowser({ headless: true });
    try {
      const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
      const errors = [];
      const unexpectedRequests = [];
      page.on('pageerror', error => { errors.push(error.message); console.log('Browser error:', error.message); });
      let signedIn = false;
      const authRequests = [];
      const drafts = [];
      const measured = [];
      let attemptStatus = 'completed';
      const user = { id: 'fixture-user', name: 'Flow Tester', email: 'flow@example.invalid' };
      const problem = { id: 'fixture-problem', title: 'Fixture sum', topic: 'Arrays', difficulty: 'Easy', prompt: 'Return the sum.', entry_point: 'solve', starter_code: 'def solve(values):\n    return sum(values)' };
      let attemptId = 'fixture-attempt';
      const detail = () => ({ attempt: { id: attemptId, created_at: new Date().toISOString(), mode: 'mock', status: attemptStatus, input_mode: 'text', draft_source: problem.starter_code, draft_revision: 1 }, problem, transcripts: [], runs: [], events: [], checkpoints: [], visibleTests: [], review: { status: 'ready' }, hasMore: false });
      await page.route('**/api/**', async route => {
        const request = route.request();
        const path = new URL(request.url()).pathname;
        let payload;
        let status = 200;
        if (path === '/api/site-config') payload = { measurementEnabled: true };
        else if (path === '/api/measure') { measured.push(request.postDataJSON()); status = 202; payload = { accepted: true }; }
        else if (path === '/api/personal-availability') payload = { collectionEnabled: true, voiceEnabled: false, emailEnabled: true };
        else if (path === '/api/auth/get-session') payload = signedIn ? { user } : null;
        else if (path === '/api/auth/sign-in/email' || path === '/api/auth/sign-up/email') { authRequests.push(path); signedIn = true; payload = { user, token: 'fixture-token' }; }
        else if (path === '/api/auth/sign-out') { signedIn = false; payload = { success: true }; }
        else if (path === '/api/me') { payload = signedIn ? { userId: user.id } : { error: 'Sign in to continue.' }; status = signedIn ? 200 : 401; }
        else if (path === '/api/catalog') payload = { problems: [problem] };
        else if (path === '/api/attempts' && request.method() === 'GET') payload = { attempts: [{ id: attemptId, title: problem.title, mode: 'mock', status: 'completed', review_status: 'ready' }], page: 1, hasMore: false };
        else if (path === '/api/attempts' && request.method() === 'POST') payload = { attemptId };
        else if (path.endsWith('/draft')) { drafts.push(request.postDataJSON().source); payload = { draftRevision: drafts.length + 1 }; }
        else if (path.endsWith('/review')) payload = { review: { status: 'ready' }, findings: [{ id: 'fixture-finding', observation: 'Inspect the return', interpretation: 'A fixture finding.', limitations: 'Mock evidence only.', evidence: [], retry_checkpoint_id: 'fixture-checkpoint' }] };
        else if (path.endsWith('/related')) payload = { relatedProblems: [] };
        else if (path.endsWith('/retry')) { attemptId = 'fixture-retry'; payload = { attemptId }; }
        else if (path === `/api/attempts/${attemptId}`) payload = detail();
        else { unexpectedRequests.push(`${request.method()} ${path}`); status = 404; payload = { error: 'Unexpected mocked request' }; }
        await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(payload) });
      });
      const menu = () => page.locator('.account-menu');
      const openMenu = async () => { await menu().locator('summary').click(); await menu().getByRole('link', { name: 'Settings', exact: true }).waitFor(); };
      const signOut = async () => { await openMenu(); await menu().getByRole('button', { name: 'Sign out', exact: true }).click(); await page.locator('#personal-auth-form').waitFor(); };
      const submitAuth = async () => { await page.getByLabel('Email', { exact: true }).fill(user.email); await page.getByLabel('Password', { exact: true }).fill('fixture-password'); await page.locator('#personal-auth-form button[type=submit]').click(); await page.getByRole('heading', { name: /Start with the work/ }).waitFor(); };
      const noFooter = async () => assert.equal(await page.locator('.page-footer').isVisible(), false, `No page footer on ${new URL(page.url()).hash}`);
      await mkdir('output/playwright/userflow', { recursive: true });
      console.log('Mock flow: guest sign-in entry');
      await page.goto(`${base}/#welcome`);
      await page.getByRole('navigation', { name: 'Account' }).getByRole('link', { name: 'Sign in', exact: true }).click();
      await page.locator('#personal-auth-form').waitFor();
      assert.equal(new URL(page.url()).hash, '#personal');
      await page.getByRole('button', { name: 'Create account', exact: true }).click();
      await page.getByLabel('Display name').fill(user.name);
      await submitAuth();
      assert.equal(authRequests.at(-1), '/api/auth/sign-up/email');
      console.log('Mock flow: signup succeeded');
      await signOut();
      await submitAuth();
      assert.equal(authRequests.at(-1), '/api/auth/sign-in/email', 'Logout resets signup mode');
      console.log('Mock flow: signin after logout succeeded');
      await page.goto(`${base}/#personal?reset=fixture-token`);
      await page.getByRole('heading', { name: 'Choose a new password', exact: true }).waitFor();
      await page.goto(`${base}/#personal`);
      await page.getByRole('heading', { name: /Start with the work/ }).waitFor();
      await menu().locator('summary').focus();
      await page.keyboard.press('Enter');
      assert.equal(await menu().evaluate(element => element.open), true);
      await page.keyboard.press('Escape');
      assert.equal(await menu().evaluate(element => element.open), false);
      assert.equal(await menu().locator('summary').evaluate(element => element === document.activeElement), true);
      await openMenu();
      await page.getByRole('heading', { name: /Start with the work/ }).click();
      assert.equal(await menu().evaluate(element => element.open), false);
      await openMenu();
      await menu().getByRole('link', { name: 'Profile', exact: true }).click();
      await page.getByRole('heading', { name: 'Your profile', exact: true }).waitFor();
      assert.match(await page.locator('main').innerText(), /Flow Tester/);
      assert.match(await page.locator('main').innerText(), /flow@example.invalid/);
      await page.reload();
      await page.getByRole('heading', { name: 'Your profile', exact: true }).waitFor();
      await page.screenshot({ path: 'output/playwright/userflow/profile-desktop.png', fullPage: true });
      await openMenu();
      await menu().getByRole('link', { name: 'Settings', exact: true }).click();
      await page.getByRole('heading', { name: 'Account settings', exact: true }).waitFor();
      await page.getByRole('link', { name: 'Download my data' }).waitFor();
      await page.setViewportSize({ width: 390, height: 844 });
      await openMenu();
      await page.screenshot({ path: 'output/playwright/userflow/settings-menu-mobile.png', fullPage: true });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'Mobile account UI fits viewport');
      await page.keyboard.press('Escape');
      console.log('Mock flow: profile/settings and mobile menu passed');
      await page.goto(`${base}/#personal?page=catalog`);
      await page.getByRole('heading', { name: 'Practice roadmap', exact: true }).waitFor();
      console.log('Mock flow: catalog rendered');
      await page.locator('[data-start-problem]').click();
      console.log('Mock flow: setup rendered');
      await page.getByRole('checkbox', { name: /Allow Deepgram processing/ }).check();
      await page.getByRole('button', { name: 'Start interview', exact: true }).click();
      console.log('Mock flow: start submitted');
      await page.locator('#personal-code, #personal-error').waitFor();
      assert.equal(await page.locator('#personal-error').count(), 0, await page.locator('main').innerText());
      await noFooter();
      await page.screenshot({ path: 'output/playwright/userflow/workspace-mobile.png', fullPage: true });
      await page.getByRole('button', { name: 'Inspect review', exact: true }).click();
      await page.getByRole('heading', { name: 'Review ready', exact: true }).waitFor();
      await noFooter();
      await page.getByRole('button', { name: 'Retry from this checkpoint', exact: true }).click();
      await page.locator('#personal-code, #personal-error').waitFor();
      assert.equal(await page.locator('#personal-error').count(), 0, await page.locator('main').innerText());
      await noFooter();
      await page.setViewportSize({ width: 1440, height: 1000 });
      await page.screenshot({ path: 'output/playwright/userflow/retry-desktop.png', fullPage: true });
      console.log('Mock flow: workspace/review/retry passed');
      attemptStatus = 'active';
      await page.goto(`${base}/#personal?page=sessions`);
      await page.locator('[data-open-attempt]').click();
      await page.locator('#personal-code').fill('draft before settings');
      await openMenu();
      await menu().getByRole('link', { name: 'Settings', exact: true }).click();
      await page.getByRole('heading', { name: 'Account settings', exact: true }).waitFor();
      assert.equal(drafts.at(-1), 'draft before settings');
      await page.goto(`${base}/#personal?page=sessions`);
      await page.locator('[data-open-attempt]').click();
      await page.locator('#personal-code').fill('draft before logout');
      await openMenu();
      await menu().getByRole('button', { name: 'Sign out', exact: true }).click();
      await page.locator('#personal-auth-form').waitFor();
      assert.equal(drafts.at(-1), 'draft before logout');
      console.log('Mock flow: drafts saved before settings/logout');
      await page.goto(`${base}/#profile`);
      await page.locator('#personal-auth-form').waitFor();
      assert.doesNotMatch(await page.locator('main').innerText(), /Alex Morgan|Flow Tester/);
      await page.goto(`${base}/#personal`);
      await submitAuth();
      await page.goto(`${base}/#sample`);
      await openMenu();
      await menu().getByRole('button', { name: 'Sign out', exact: true }).click();
      await page.locator('#personal-auth-form').waitFor();
      assert.equal(signedIn, false, 'Public sample account menu signs out');
      for (const route of ['sample', 'interview', 'review', 'retry', 'complete', 'related']) {
        await page.goto(`${base}/#${route}`);
        await page.locator('h1').waitFor();
        await noFooter();
      }
      await page.goto(`${base}/#welcome`);
      await page.locator('.page-footer').waitFor();
      const personal = measured.filter(item => item.activity === 'personal' && item.name !== 'page_viewed').map(item => `${item.name}:${item.authority}`);
      for (const expected of ['practice_started:server', 'review_opened:client', 'retry_started:server']) assert.ok(personal.includes(expected), `${expected} in ${personal}`);
      assert.ok(!/draft before settings|return sum|flow@example|Flow Tester|fixture-attempt|fixture-token/.test(JSON.stringify(measured)), 'Personal measurement excludes code, account and record identifiers');
      assert.deepEqual(unexpectedRequests, []);
      assert.deepEqual(errors, []);
    } finally { await browser.close(); }
  });
});
