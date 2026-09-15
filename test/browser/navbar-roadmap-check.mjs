import { chromium } from 'playwright';
import assert from 'node:assert/strict';
const base = process.env.APP_URL;
if (!base) throw new Error('Set APP_URL to the running preview.');
const browser = await chromium.launch({channel:'msedge'});
const page = await browser.newPage({viewport:{width:1440,height:900}});
try {
  await page.goto(`${base}/#roadmap?topic=sets`);
  await page.evaluate(()=>document.fonts.ready);
  const header = page.locator('.floating-nav .app-header');
  const expanded = await header.boundingBox();
  const wrapper = await page.locator('.floating-nav').boundingBox();
  const padding = await page.locator('.floating-nav').evaluate(el=>parseFloat(getComputedStyle(el).paddingLeft));
  assert.equal(Math.round(expanded.width),Math.round(wrapper.width-padding*2));
  assert.equal(await page.locator('.skill-graph').count(),0);
  assert.equal(await page.locator('.road-grid .road-node').count(),5);
  assert.equal(await page.locator('.selected-topic .subtopic-card').count(),2);
  const graph = await page.locator('.road-grid').boundingBox();
  assert.equal(graph.width,960);
  for (const [id,x] of [['sequences',0],['sets',360],['flow',360],['repeat',720],['runs',720]]) {
    const rect = await page.locator(`#topic-${id}`).boundingBox();
    assert.equal(Math.round(rect.x-graph.x),x);
    assert.equal(rect.width,240);
  }
  const connections = await page.locator('.road-grid > svg path').evaluateAll(paths => paths.map(path => {
    const from = document.getElementById(`topic-${path.dataset.from}`);
    const to = document.getElementById(`topic-${path.dataset.to}`);
    const start = path.getPointAtLength(0);
    const end = path.getPointAtLength(path.getTotalLength());
    return {
      start: [Math.round(start.x), Math.round(start.y)],
      expectedStart: [from.offsetLeft + from.offsetWidth, Math.round(from.offsetTop + from.offsetHeight / 2)],
      end: [Math.round(end.x), Math.round(end.y)],
      expectedEnd: [to.offsetLeft, Math.round(to.offsetTop + to.offsetHeight / 2)],
    };
  }));
  for (const connection of connections) {
    assert.deepEqual(connection.start, connection.expectedStart);
    assert.deepEqual(connection.end, connection.expectedEnd);
  }
  await page.screenshot({path:'output/playwright/roadmap-reference-layout.png',fullPage:true});
  await page.goto(`${base}/#preferences`);
  await page.mouse.wheel(0,900);
  await page.waitForFunction(()=>document.documentElement.dataset.scrolled==='true');
  await header.evaluate(async el=>Promise.all(el.getAnimations().map(a=>a.finished)));
  const compact = await header.boundingBox();
  assert.ok(compact.width<expanded.width);
  assert.equal(Math.round(compact.x+compact.width/2),720);
  assert.ok(compact.y>=0);
  await page.screenshot({path:'output/playwright/navbar-compact.png'});
  await page.evaluate(()=>window.scrollTo(0,0));
  await page.waitForFunction(()=>document.documentElement.dataset.scrolled==='false');
  await header.evaluate(async el=>Promise.all(el.getAnimations().map(a=>a.finished)));
  assert.equal(Math.round((await header.boundingBox()).width),Math.round(expanded.width));
  assert.equal(await page.locator('html').evaluate(el=>getComputedStyle(el).overscrollBehavior),'none');
  await page.goto(`${base}/#roadmap?topic=sets&leaf=seen`);
  assert.equal(await page.locator('#problem-drawer').evaluate(el=>getComputedStyle(el).overscrollBehavior),'none');
  await page.keyboard.press('Escape');
  for (const width of [768,320]) {
    await page.setViewportSize({width,height:900});
    for (const route of ['welcome','profile','roadmap?topic=flow','roadmap?view=map&topic=sets','sample']) {
      await page.goto(`${base}/#${route}`);
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,`${route} ${width}`);
      const h=await header.boundingBox();
      assert.ok(h.x>=0 && h.x+h.width<=width);
    }
  }
  await page.goto(`${base}/#welcome`);
  assert.equal(await page.locator('.profile-caption').count(),0);
  await page.emulateMedia({reducedMotion:'reduce'});
  assert.equal(await header.evaluate(el=>getComputedStyle(el).transitionDuration),'0s');
  console.log('Passed: content-sized graph connections and selected subtopics, full-width/compact/restore navbar, overscroll policy, narrow reflow, reduced motion');
} finally { await browser.close(); }
