import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { launchBrowser } from './browser/launch.mjs';
import { serve } from '../tools/marketing/server.mjs';

test('developer browser discovers from saved context, inspects evidence and records a correction', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'research-browser-'));
  const env = { EXA_API_KEY: 'fixture', FIRECRAWL_API_KEY: 'fixture', DASHSCOPE_API_KEY: 'fixture', DASHSCOPE_BASE_URL: 'https://dashscope-intl.aliyuncs.com', QWEN_COVERED_USAGE_CONFIRMED: 'true', MONID_CLI_PATH: 'fixture-cli.js' };
  const app = await serve({ directory, env, fetch: async (url, options) => {
    if (url.includes('exa.ai')) { assert.equal(JSON.parse(options.body).query, 'Python ads for new graduates'); return Response.json({ results: [{ url: 'https://example.com/ad', title: 'Practice demo' }] }); }
    if (url.includes('firecrawl')) return Response.json({ success: true, data: { markdown: 'Try practice', screenshot: 'https://cdn.example.com/ad.png' } });
    return Response.json({ choices: [{ message: { content: '{"observations":[{"description":"Try practice button","region":"bottom center"}],"gaps":["Audio not available"]}' } }], usage: { total_tokens: 30 } });
  }, exec: async () => ({ stdout: JSON.stringify({ status: 'COMPLETED', runId: 'fixture', output: { model: 'jev-1.13.0', answers: Object.fromEntries(['hook','format','awareness','offer','cta'].map(key => [key, { type: 'choice', choice: 'unknown', confidence: 1 }])) } }) }) });
  let browser;
  t.after(async () => { await browser?.close(); await app.close(); await rm(directory, { recursive: true, force: true }); });
  browser = await launchBrowser({ headless: true });
  const page = await browser.newPage();
  await page.goto(app.url);
  await page.locator('#context').fill('Python ads for new graduates');
  await page.locator('#count').fill('1');
  await page.getByRole('button', { name: 'Discover sources' }).click();
  await page.waitForFunction(() => document.getElementById('message').textContent.startsWith('complete'));
  assert.equal(await page.locator('#history button').count(), 1);
  assert.equal(await page.getByRole('link', { name: 'Open original source' }).getAttribute('href'), 'https://example.com/ad');
  await page.getByText('Evidence, provenance, usage & correction history', { exact: true }).click();
  assert.match(await page.locator('pre').innerText(), /bottom center/);
  await page.getByLabel('Corrected label').selectOption('demonstration');
  await page.getByLabel('Reviewer', { exact: true }).fill('fixture-reviewer');
  await page.getByLabel('Correction rationale').fill('Demo visible in original');
  await page.getByRole('button', { name: 'Save human judgment' }).click();
  await page.waitForFunction(() => document.querySelector('#results').textContent.includes('hook: demonstration'));
  await mkdir('.local/marketing', { recursive: true });
  await page.screenshot({ path: '.local/marketing/browser-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.screenshot({ path: '.local/marketing/browser-mobile.png', fullPage: true });
});
