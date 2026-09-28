import { launchBrowser } from './launch.mjs';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';

const base = process.env.APP_URL;
if (!base) throw new Error('Set APP_URL to the running app.');
const browser = await launchBrowser({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const motion = value => page.waitForFunction(expected => document.documentElement.dataset.brandMotion === expected, value);
const state = () => page.evaluate(() => document.documentElement.dataset.brandMotion);
try {
  await page.goto(base);
  await motion('launch');
  assert.equal(await page.locator('.floating-nav .coursay-mark').count(), 1);
  await motion('static');
  await page.evaluate(async () => { window.brand = await import('/brand.js'); });
  await page.evaluate(() => { window.finishA = window.brand.beginBrandLoading(); window.finishB = window.brand.beginBrandLoading(); });
  await motion('loading');
  const frames = await page.evaluate(async () => {
    const node = document.querySelector('.floating-nav .brand-node');
    const animation = node.getAnimations()[0];
    const delay = animation.effect.getTiming().delay;
    animation.pause();
    animation.currentTime = delay + 3600 + 180;
    const first = getComputedStyle(node).r;
    animation.currentTime = delay + 3600 + 360;
    const second = getComputedStyle(node).r;
    // A script-controlled CSS animation outlives later style changes; drop the probe.
    animation.cancel();
    return [first, second];
  });
  assert.notEqual(frames[0], frames[1]);
  await page.evaluate(() => window.finishA());
  assert.equal(await state(), 'loading');
  for (const status of ['listening', 'thinking', 'speaking']) {
    await page.evaluate(value => window.brand.setBrandVoice(value), status);
    await motion('voice');
  }
  await page.evaluate(() => window.brand.setBrandVoice('stopped'));
  await motion('loading');
  await page.evaluate(() => window.finishB());
  await motion('static');
  for (const status of ['connecting', 'reconnecting']) {
    await page.evaluate(value => window.brand.setBrandVoice(value), status);
    await motion('loading');
  }
  await page.evaluate(() => window.brand.setBrandVoice('speaking'));
  await motion('voice');
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await page.waitForFunction(() => document.querySelector('link[rel="icon"]').href.startsWith('data:image/png'));
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  assert.match(await page.locator('link[rel="icon"]').getAttribute('href'), /coursay-favicon.svg$/);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await motion('static');
  assert.equal(await page.evaluate(() => document.querySelector('.coursay-mark').getAnimations({ subtree: true }).length), 0);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await motion('voice');
  await page.evaluate(() => { document.documentElement.dataset.reduce = 'true'; });
  await motion('static');
  await page.evaluate(() => { document.documentElement.dataset.reduce = 'false'; });
  await motion('voice');
  await page.keyboard.press('Tab');
  await motion('static');
  await page.evaluate(() => { document.documentElement.dataset.input = 'pointer'; });
  await motion('voice');
  await page.emulateMedia({ forcedColors: 'active' });
  await motion('static');
  await page.emulateMedia({ forcedColors: 'none' });
  await page.evaluate(() => window.brand.setBrandVoice('stopped'));
  await motion('static');
  await mkdir('output/playwright', { recursive: true });
  for (const theme of ['dark', 'light']) {
    await page.evaluate(value => { document.documentElement.dataset.theme = value; }, theme);
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await page.screenshot({ path: `output/playwright/logo-${theme}-${width}.png`, fullPage: true });
    }
  }
  const smallGeometry = await page.locator('.footer-brand .coursay-mark').evaluate(svg => ({
    stroke: getComputedStyle(svg).strokeWidth,
    node: getComputedStyle(svg.querySelector('.brand-node')).r,
    hub: getComputedStyle(svg.querySelector('.brand-hub')).r,
    current: getComputedStyle(svg.querySelector('.brand-current')).r,
  }));
  assert.deepEqual(smallGeometry, { stroke: '3.2px', node: '0px', hub: '4px', current: '6.5px' });
  let release;
  const hold = new Promise(resolve => { release = resolve; });
  await page.route('**/api/personal-availability', async route => {
    await hold;
    await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Service unavailable' }) });
  });
  await page.evaluate(() => { location.hash = '#personal'; });
  await motion('loading');
  release();
  await motion('static');
  await page.getByText('Service unavailable', { exact: true }).waitFor();
  await page.evaluate(() => { location.hash = '#welcome'; });
  await page.locator('.floating-nav .coursay-mark').waitFor();
  assert.equal(await state(), 'static', 'Navigation must not replay launch.');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.reload();
  await motion('static');
  assert.equal(await page.evaluate(() => document.querySelector('.coursay-mark').getAnimations({ subtree: true }).length), 0);
  assert.deepEqual(errors, []);
  console.log('Passed: launch, concurrent requests, voice states, favicon restoration, motion gates, responsive themes, small geometry, failed-request cleanup, and navigation.');
} finally {
  await browser.close();
}
