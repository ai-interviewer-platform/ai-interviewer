import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import assert from 'node:assert/strict';
import { directions, topics, topicTrees } from './model.js';

const base = process.env.PROTOTYPE_URL;
if (!base) throw new Error('Set PROTOTYPE_URL to the running local preview.');
const browser = await chromium.launch({ channel: 'msedge' });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
try {
  for (const direction of directions) {
    for (const route of ['welcome', 'roadmap?topic=sets', 'review', 'roadmap?topic=flow&leaf=early-return']) {
      await page.goto(`${base}/#${route}${route.includes('?') ? '&' : '?'}direction=${direction.id}`);
      await page.evaluate(async () => Promise.all(document.getAnimations().map((animation) => animation.finished)));
      const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
      assert.deepEqual(result.violations.map((item) => ({ id: item.id, nodes: item.nodes.map((node) => node.failureSummary) })), [], `${direction.name}: ${route}`);
    }
    await page.goto(`${base}/#welcome?direction=${direction.id}`);
    await page.getByRole('heading', { name: 'Welcome back, Alex.' }).click();
    await page.screenshot({ path: `output/playwright/home-${direction.id}.png`, fullPage: true });
    for (const width of [768, 320]) {
      await page.setViewportSize({ width, height: 900 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      await page.screenshot({ path: `output/playwright/home-${direction.id}-${width}.png`, fullPage: true });
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
  }
  console.log('Passed: all directions, core surfaces, contrast scan, and home reflow');

  await page.evaluate(() => sessionStorage.removeItem('interview-prototype'));
  await page.goto(`${base}/#welcome?direction=fieldnotes`);
  await page.reload();
  const before = await page.locator('.thread-steps .recorded').count();
  await page.getByRole('link', { name: 'Open your review', exact: true }).click();
  await page.getByRole('link', { name: 'Home', exact: true }).click();
  assert.equal(await page.locator('.thread-steps .recorded').count(), before + 1);
  const progress = await page.locator('.thread-steps').innerText();
  await page.getByLabel('Visual direction').selectOption('blueprint');
  assert.equal(await page.locator('.thread-steps').innerText(), progress);
  await page.reload();
  assert.equal(await page.getByLabel('Visual direction').inputValue(), 'blueprint');
  assert.equal(await page.locator('.thread-steps').innerText(), progress);
  await page.goto(`${base}/#welcome?state=empty`);
  assert.equal(await page.locator('.thread-steps .recorded').count(), 0);
  assert.equal(await page.locator('.activity-line').count(), 0);
  console.log('Passed: recorded review progress, direction persistence, and empty state');

  for (const topic of topics) {
    for (const leaf of topicTrees[topic.id].flatMap((branch) => branch.leaves)) {
      await page.goto(`${base}/#roadmap?topic=${topic.id}`);
      await page.locator(`#leaf-${leaf.id}`).click();
      await page.getByRole('dialog', { name: leaf.name, exact: true }).waitFor();
      assert.equal(await page.locator('.drawer-problems > li').count(), leaf.exercises.length);
      await page.keyboard.press('Escape');
      await page.waitForURL(new RegExp(`return=${leaf.id}`));
      await page.waitForFunction((id) => document.activeElement.id === id, `leaf-${leaf.id}`);
      assert.equal(await page.evaluate(() => document.activeElement.id), `leaf-${leaf.id}`);
    }
  }
  await page.goto(`${base}/#roadmap?topic=sets`);
  await page.getByRole('link', { name: /Seen-value tracking/ }).click();
  const animations = await page.locator('#problem-drawer').evaluate((el) => el.getAnimations().map((animation) => animation.effect.getKeyframes()));
  assert.ok(animations.flat().some((frame) => String(frame.transform).includes('-100%')), 'Drawer has a left-origin slide');
  await page.locator('#problem-drawer').evaluate(async (el) => Promise.all(el.getAnimations().map((animation) => animation.finished)));
  await page.screenshot({ path: 'output/playwright/drawer-fieldnotes.png', fullPage: true });
  await page.keyboard.press('Escape');
  await page.waitForURL(/return=seen/);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.getByRole('link', { name: /Seen-value tracking/ }).click();
  assert.equal(await page.locator('#problem-drawer').evaluate((el) => getComputedStyle(el).transitionDuration), '0s');
  await page.keyboard.press('Escape');
  await page.waitForURL(/return=seen/);
  console.log('Passed: every practice leaf, problem list, Escape focus, drawer slide, reduced motion');

  await page.setViewportSize({ width: 768, height: 900 });
  await page.goto(`${base}/#roadmap?view=map`);
  await page.getByRole('button', { name: 'Pan right', exact: true }).click();
  assert.ok(await page.locator('.map-scroll').evaluate((el) => el.scrollLeft > 0));
  await page.getByRole('button', { name: 'Pan left', exact: true }).click();
  await page.locator('.map-scroll').focus();
  await page.keyboard.press('ArrowRight');
  await page.waitForFunction(() => document.querySelector('.map-scroll').scrollLeft > 0);
  await page.goto(`${base}/#welcome`);
  await page.locator('h1').focus();
  await page.keyboard.press('PageDown');
  await page.waitForFunction(() => scrollY > 0);
  assert.equal(await page.evaluate(() => [...document.querySelectorAll('*')].every((el) => getComputedStyle(el).scrollbarWidth === 'none')), true);
  console.log('Passed: hidden scrollbars preserve map pan, keyboard scrolling, and page scrolling');
} finally { await browser.close(); }
