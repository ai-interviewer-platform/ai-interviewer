// Deterministic frontend proof only: API responses are mocked, no account or session is created.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
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

test('Personal practice navigator wiring smoke: authentication, Draft save, Review, voice and sign-out', async () => {
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
      let inputMode = 'text';
      let failDraft = false;
      const user = { id: 'fixture-user', name: 'Flow Tester', email: 'flow@example.invalid' };
      const problem = { id: 'fixture-problem', title: 'Fixture sum', topic: 'Arrays', difficulty: 'Easy', prompt: 'Return the sum.', entry_point: 'solve', starter_code: 'def solve(values):\n    return sum(values)' };
      let attemptId = 'fixture-attempt';
      const detail = () => ({ attempt: { id: attemptId, created_at: new Date().toISOString(), mode: 'mock', status: attemptStatus, input_mode: inputMode, draft_source: problem.starter_code, draft_revision: 1 }, problem, transcripts: [], runs: [], events: [], checkpoints: [], visibleTests: [], review: { status: 'ready' }, hasMore: false });
      await page.route('**/voice-agent.js', route => route.fulfill({ contentType: 'text/javascript', body: `
        export const VOICE_PROVIDER = 'fixture'; export const THINKING_MODEL = 'fixture';
        export function createDeepgramVoiceSession({ onStatus }) {
          return { active: false, async start() { this.active = true; window.voiceStarts = (window.voiceStarts || 0) + 1; onStatus('listening'); },
            stop() { this.active = false; window.voiceStops = (window.voiceStops || 0) + 1; onStatus('stopped'); } };
        }
      ` }));
      await page.route('**/api/**' , async route => {
        const request = route.request();
        const path = new URL(request.url()).pathname;
        let payload;
        let status = 200;
        if (path === '/api/site-config') payload = { measurementEnabled: true };
        else if (path === '/api/measure') { measured.push(request.postDataJSON()); status = 202; payload = { accepted: true }; }
        else if (path === '/api/personal-availability') payload = { collectionEnabled: true, voiceEnabled: true, emailEnabled: true };
        else if (path === '/api/auth/get-session') payload = signedIn ? { user } : null;
        else if (path === '/api/auth/sign-in/email' || path === '/api/auth/sign-up/email') { authRequests.push(path); signedIn = true; payload = { user, token: 'fixture-token' }; }
        else if (path === '/api/auth/sign-out') { signedIn = false; payload = { success: true }; }
        else if (path === '/api/me') { payload = signedIn ? { userId: user.id } : { error: 'Sign in to continue.' }; status = signedIn ? 200 : 401; }
        else if (path === '/api/catalog') payload = { problems: [problem] };
        else if (path === '/api/attempts' && request.method() === 'GET') payload = { attempts: [{ id: attemptId, title: problem.title, mode: 'mock', status: 'completed', review_status: 'ready' }], page: 1, hasMore: false };
        else if (path === '/api/attempts' && request.method() === 'POST') payload = { attemptId };
        else if (path.endsWith('/draft')) { if (failDraft) { status = 503; payload = { error: 'Fictional save failure' }; } else { drafts.push(request.postDataJSON().source); payload = { draftRevision: drafts.length + 1 }; } }
        else if (path.endsWith('/review')) payload = { review: { status: 'ready' }, findings: [{ id: 'fixture-finding', observation: 'Inspect the return', interpretation: 'A fixture finding.', limitations: 'Mock evidence only.', evidence: [], retry_checkpoint_id: 'fixture-checkpoint' }] };
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
      await page.goto(`${base}/#welcome`);
      await page.getByRole('navigation', { name: 'Account' }).getByRole('link', { name: 'Sign in', exact: true }).click();
      await page.locator('#personal-auth-form').waitFor();
      assert.equal(new URL(page.url()).hash, '#personal');
      await page.getByRole('button', { name: 'Create account', exact: true }).click();
      await page.getByLabel('Display name').fill(user.name);
      await submitAuth();
      assert.equal(authRequests.at(-1), '/api/auth/sign-up/email');
      await signOut();
      await submitAuth();
      assert.equal(authRequests.at(-1), '/api/auth/sign-in/email', 'Logout resets signup mode');
      await page.goto(`${base}/#personal?page=catalog`);
      await page.getByRole('heading', { name: 'Practice roadmap', exact: true }).waitFor();
      await page.locator('[data-start-problem]').click();
      await page.getByRole('checkbox', { name: /Allow Deepgram processing/ }).check();
      await page.getByRole('button', { name: 'Start interview', exact: true }).click();
      await page.locator('#personal-code, #personal-error').waitFor();
      assert.equal(await page.locator('#personal-error').count(), 0, await page.locator('main').innerText());
      await noFooter();
      await page.getByRole('button', { name: 'Inspect review', exact: true }).click();
      await page.getByRole('heading', { name: 'Review ready', exact: true }).waitFor();
      await noFooter();
      await page.getByRole('button', { name: 'Retry from this checkpoint', exact: true }).click();
      await page.locator('#personal-code, #personal-error').waitFor();
      assert.equal(await page.locator('#personal-error').count(), 0, await page.locator('main').innerText());
      await noFooter();
      await page.setViewportSize({ width: 1440, height: 1000 });
      attemptStatus = 'active';
      inputMode = 'voice';
      await page.goto(`${base}/#personal?page=sessions`);
      await page.locator('[data-open-attempt]').click();
      await page.locator('#personal-code').fill('draft before settings');
      await page.getByRole('button', { name: 'Start voice', exact: true }).click();
      await page.getByRole('button', { name: 'Stop voice', exact: true }).waitFor();
      assert.equal(await page.locator('#personal-code').inputValue(), 'draft before settings', 'voice effect does not rerender unsaved code');
      failDraft = true;
      await openMenu();
      await menu().getByRole('link', { name: 'Settings', exact: true }).click();
      await page.getByRole('alert').getByText('Fictional save failure').waitFor();
      assert.equal(await page.locator('#personal-code').inputValue(), 'draft before settings');
      assert.equal(await page.evaluate(() => window.voiceStops || 0), 0, 'a failed save does not stop voice or navigate');
      failDraft = false;
      await page.locator('main h1').click();
      await openMenu();
      await menu().getByRole('link', { name: 'Settings', exact: true }).click();
      await page.getByRole('heading', { name: 'Account settings', exact: true }).waitFor();
      assert.equal(drafts.at(-1), 'draft before settings');
      assert.equal(await page.evaluate(() => window.voiceStops), 1);
      await page.goto(`${base}/#personal?page=sessions`);
      await page.locator('[data-open-attempt]').click();
      await page.locator('#personal-code').fill('draft before logout');
      await openMenu();
      await menu().getByRole('button', { name: 'Sign out', exact: true }).click();
      await page.locator('#personal-auth-form').waitFor();
      assert.equal(drafts.at(-1), 'draft before logout');
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
