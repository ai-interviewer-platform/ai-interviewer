import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import assert from 'node:assert/strict';
const browser = await chromium.launch({channel:'msedge'});
const context = await browser.newContext({viewport:{width:1440,height:1000}});
const page = await context.newPage();
const base = process.env.APP_URL;
if (!base) throw new Error('Set APP_URL to the running preview.');
try {
  const accessibilityIssues = [];
  await page.goto(`${base}/#welcome`);
  await page.getByRole('button', {name:'Retry', exact:true}).click();
  assert.equal(await page.getByRole('button', {name:'Retry', exact:true}).getAttribute('aria-current'),'step');
  assert.equal(await page.getByRole('button', {name:'Retry', exact:true}).getAttribute('aria-pressed'),'true');
  await page.goto(`${base}/#preferences`);
  await page.getByLabel('Theme', {exact:true}).selectOption('light');
  await page.reload();
  assert.equal(await page.locator('html').getAttribute('data-theme'), 'light');
  for (const route of ['welcome','roadmap','sessions','setup','sample','review?source=sample','preferences','profile','system']) {
    await page.goto(`${base}/#${route}`);
    await page.evaluate(async () => Promise.all(document.getAnimations().filter(animation => animation.effect.getTiming().iterations !== Infinity).map(animation => animation.finished)));
    const result = await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();
    accessibilityIssues.push(...result.violations.map(v=>({route,id:v.id,nodes:v.nodes.map(n=>({target:n.target,summary:n.failureSummary}))})));
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth > innerWidth),false,route);
  }
  await page.screenshot({path:'output/playwright/revision-light-system.png',fullPage:true});
  await page.goto(`${base}/#sessions?filter=Draft%20saved`);
  assert.equal(await page.locator('.session-row:visible').count(),1);
  await page.goto(`${base}/#preferences`);
  await page.reload();
  assert.equal(await page.locator('.app-shell').getAttribute('data-nav'),'top');
  await page.getByRole('checkbox',{name:'Reduce motion in this preview'}).check();
  await page.reload();
  assert.equal(await page.locator('html').getAttribute('data-reduce'),'true');
  await page.goto(`${base}/#welcome`);
  assert.equal(await page.evaluate(()=>document.getAnimations().length),0);
  for (const width of [768,320]) {
    await page.setViewportSize({width,height:900});
    for (const route of ['welcome','profile','preferences','sessions']) {
      await page.goto(`${base}/#${route}`);
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth > innerWidth),false,`${route} top navigation at ${width}`);
    }
  }
  await page.emulateMedia({forcedColors:'active'});
  await page.goto(`${base}/#sample`);
  assert.equal(await page.locator('.problem-pane').evaluate(el=>getComputedStyle(el).borderTopStyle),'solid');
  assert.deepEqual(accessibilityIssues, []);
  console.log('Passed: light-theme accessibility, appearance persistence, session filtering, top navigation reflow, reduced motion, forced-color boundaries');
} finally { await browser.close(); }
