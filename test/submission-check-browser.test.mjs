// Deterministic frontend proof of the Submission check: API responses are mocked.
// Covers the finishing state and the three check states at 320 px with axe WCAG 2.2 AA.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import test from 'node:test';
import AxeBuilder from '@axe-core/playwright';
import { launchBrowser } from './browser/launch.mjs';

const publicRoot = resolve(import.meta.dirname, '../public');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };

async function serve(run) {
  const server = createServer(async (request, response) => {
    const pathname = new URL(request.url, 'http://localhost').pathname;
    const file = resolve(publicRoot, pathname === '/' ? 'index.html' : `.${pathname}`);
    if (!file.startsWith(`${publicRoot}${sep}`)) return response.writeHead(404).end();
    const body = await readFile(file).catch(() => null);
    if (!body) return response.writeHead(404).end();
    response.writeHead(200, { 'content-type': types[extname(file)] || 'application/octet-stream' }).end(body);
  });
  await new Promise(resolveListen => server.listen(0, '127.0.0.1', resolveListen));
  try { await run(`http://127.0.0.1:${server.address().port}`); }
  finally { await new Promise(resolveClose => server.close(resolveClose)); }
}

const DISCLAIMER = 'Hidden tests try other inputs. Passing them all does not prove the solution correct.';
const UNAVAILABLE = 'The Submission check could not run because the isolated runner was unavailable. Your Submission and its Review are unaffected.';
const NO_HIDDEN = 'This Problem has no hidden tests, so no Submission check ran.';

test('finishing shows "Checking your submission…", then the Tests / results pane shows each Submission check state', async () => {
  await serve(async base => {
    const browser = await launchBrowser({ headless: true });
    try {
      const page = await (await browser.newContext({ viewport: { width: 320, height: 800 } })).newPage();
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      const user = { id: 'fixture-user', name: 'Check Tester', email: 'check@example.invalid' };
      const problem = { id: 'fixture-problem', title: 'Fixture sum', topic: 'Arrays', difficulty: 'Easy', prompt: 'Return the sum.', entry_point: 'solve', starter_code: 'def solve(values):\n    return sum(values)' };
      let status = 'active';
      let submissionCheck = null;
      let reviewStatus = 'pending';
      let releaseFinish;
      const finishes = [];
      const detail = () => ({ attempt: { id: 'fixture-attempt', created_at: new Date().toISOString(), mode: 'mock', status, input_mode: 'text', draft_source: problem.starter_code, draft_revision: 1 }, problem, transcripts: [], runs: [], events: [], checkpoints: [], visibleTests: [], review: status === 'completed' ? { status: reviewStatus, failure_reason: reviewStatus === 'failed' ? 'Fictional failure.' : null } : null, submissionCheck, hasMore: false });
      await page.route('**/api/**', async route => {
        const request = route.request();
        const path = new URL(request.url()).pathname;
        let payload;
        if (path === '/api/site-config') payload = { measurementEnabled: false };
        else if (path === '/api/personal-availability') payload = { collectionEnabled: true, voiceEnabled: false, emailEnabled: true };
        else if (path === '/api/auth/get-session') payload = { user };
        else if (path === '/api/me') payload = { userId: user.id };
        else if (path === '/api/catalog') payload = { problems: [problem] };
        else if (path === '/api/attempts') payload = { attempts: [{ id: 'fixture-attempt', title: problem.title, mode: 'mock', status }], page: 0, hasMore: false };
        else if (path === '/api/attempts/fixture-attempt/finish') {
          finishes.push(request.postDataJSON());
          await new Promise(resolveFinish => { releaseFinish = resolveFinish; });
          status = 'completed';
          payload = { reviewId: 'fixture-review', dispatch: 'queued', recoveryDispatch: false, submissionCheck };
        }
        else if (path === '/api/attempts/fixture-attempt') payload = detail();
        else if (path === '/api/attempts/fixture-attempt/review') payload = { review: { id: 'fixture-review', status: reviewStatus }, findings: [] };
        else payload = {};
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(payload) });
      });
      const pane = () => page.locator('.tests-pane');
      const axe = async (name) => {
        const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
        assert.deepEqual(result.violations.map(item => ({ id: item.id, nodes: item.nodes.map(node => node.target) })), [], name);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${name} fits 320 px`);
      };
      let loads = 0;
      const open = async () => {
        // A new query string makes a full page load, so the mocked detail is read again.
        await page.goto(`${base}/?load=${++loads}#personal?page=sessions`);
        await page.locator('[data-open-attempt]').click();
        await page.locator('#personal-code').waitFor();
      };

      // Finishing: the button says what is happening and cannot be pressed twice.
      submissionCheck = { state: 'checked', passed: 4, total: 6, failures: { 'wrong answer': 1, TypeError: 1 } };
      await open();
      const finish = page.getByRole('button', { name: 'Submit code' });
      await finish.click();
      await page.getByRole('dialog', { name: 'Submit and finish?' }).getByRole('button', { name: 'Submit code' }).click();
      const checking = page.getByRole('button', { name: 'Checking your submission…' });
      await checking.waitFor();
      assert.equal(await checking.isDisabled(), true);
      await checking.click({ force: true });
      await axe('finishing');
      releaseFinish();
      await page.locator('#personal-error').getByText(/Attempt completed/).waitFor();
      assert.equal(finishes.length, 1, 'one finish request');
      assert.match(await page.locator('#personal-error').innerText(), /Submission check: passed 4 of 6 hidden tests\./);
      console.log('Passed: finishing state');

      // Checked: the counts, one line per failure category, and the limit of the check.
      let text = await pane().innerText();
      assert.match(text, /Submission check: passed 4 of 6 hidden tests\./);
      assert.match(text, /wrong answer: 1 test/);
      assert.match(text, /TypeError: 1 test/);
      assert.ok(text.includes(DISCLAIMER));
      await axe('checked');
      console.log('Passed: checked state');

      // Unavailable never shows a count, and the Review status does not hide the check.
      for (const review of ['pending', 'failed', 'ready']) {
        reviewStatus = review;
        submissionCheck = { state: 'unavailable', passed: null, total: null, failures: {} };
        await open();
        text = await pane().innerText();
        assert.ok(text.includes(UNAVAILABLE), review);
        assert.doesNotMatch(text, /0 passed|passed 0|of 0/, review);
      }
      await axe('unavailable');
      console.log('Passed: unavailable state');

      submissionCheck = { state: 'no hidden tests', passed: null, total: null, failures: {} };
      await open();
      text = await pane().innerText();
      assert.ok(text.includes(NO_HIDDEN));
      assert.ok(!text.includes(DISCLAIMER));
      await axe('no hidden tests');
      console.log('Passed: no hidden tests state');
      for (const check of [
        { state: 'checked', passed: 4, total: 6, failures: { 'wrong answer': 1, TypeError: 1 } },
        { state: 'unavailable', passed: null, total: null, failures: {} },
        { state: 'no hidden tests', passed: null, total: null, failures: {} },
      ]) {
        submissionCheck = check;
        for (const review of ['pending', 'failed', 'ready']) {
          reviewStatus = review;
          await open();
          const expected = await page.getByRole('group', { name: 'Submission check' }).innerText();
          await page.getByRole('button', { name: 'Inspect review' }).focus();
          await page.getByRole('button', { name: 'Inspect review' }).press('Enter');
          await page.getByRole('heading', { name: `Review ${review}`, exact: true }).waitFor();
          assert.equal(await page.getByRole('group', { name: 'Submission check' }).count(), 1);
          assert.equal(await page.getByRole('group', { name: 'Submission check' }).innerText(), expected);
          await axe(`Review ${review}: ${check.state}`);
        }
      }
      assert.deepEqual(errors, []);
    } finally { await browser.close(); }
  });
});
