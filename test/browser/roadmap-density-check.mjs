import { launchBrowser } from './launch.mjs';
import AxeBuilder from '@axe-core/playwright';
import assert from 'node:assert/strict';
const base=process.env.APP_URL;
if(!base) throw new Error('Set APP_URL to the running preview.');
const browser=await launchBrowser();
const context=await browser.newContext({viewport:{width:1440,height:900}});
const page=await context.newPage();
try {
  await page.goto(`${base}/#roadmap?topic=sets`);
  await page.evaluate(()=>document.fonts.ready);
  const cards=await page.locator('.road-node').evaluateAll(nodes=>nodes.map(n=>({height:n.offsetHeight,overflow:n.scrollHeight>n.clientHeight})));
  assert.ok(cards.every(n=>n.height<120&&!n.overflow),'Cards shrink from the previous 120px without cropping text');
  for(const viewport of [{width:1440,height:900},{width:1366,height:768}]) {
    await page.setViewportSize(viewport);
    const bottom=await page.locator('.selected-topic').evaluate(el=>el.getBoundingClientRect().bottom);
    assert.ok(bottom<=viewport.height,`Selected subtopics fit at ${viewport.width} × ${viewport.height}: ${bottom}`);
  }
  await page.screenshot({path:'output/playwright/compact-roadmap.png',fullPage:true});
  await page.getByRole('link',{name:/Seen-value tracking/}).click();
  await page.locator('#problem-drawer').evaluate(async el=>Promise.all(el.getAnimations().map(a=>a.finished.catch(() => {}))));
  await page.locator('#drawer-title').click();
  assert.equal(await page.locator('#problem-drawer').evaluate(el=>el.open),true,'Inside click stays open');
  const drawer=await page.locator('#problem-drawer').boundingBox();
  const viewport=page.viewportSize();
  await page.mouse.click((drawer.x+drawer.width+viewport.width)/2,viewport.height/2);
  await page.waitForURL(/return=seen/);
  assert.equal(await page.locator('#problem-drawer').evaluate(el=>el.open),false);
  assert.equal(await page.evaluate(()=>document.activeElement.id),'leaf-seen');
  await page.getByRole('link',{name:/Seen-value tracking/}).click();
  await page.waitForFunction(()=>document.querySelector('#problem-drawer').open);
  await page.keyboard.press('Escape');
  await page.waitForURL(/return=seen/);
  for(const width of [1440,1024,768,320]) {
    await page.setViewportSize({width,height:900});
    await page.goto(`${base}/#sessions`);
    await page.evaluate(async()=>Promise.all(document.getAnimations().map(a=>a.finished.catch(() => {}))));
    const buttons=await page.locator('.session-row .session-action').evaluateAll(nodes=>nodes.map(el=>{
      const css=getComputedStyle(el); const rect=el.getBoundingClientRect(); const text=el.querySelector('span').getBoundingClientRect();
      return {font:css.fontFamily,size:css.fontSize,weight:css.fontWeight,height:rect.height,width:rect.width,nowrap:css.whiteSpace,fits:el.scrollWidth<=el.clientWidth&&text.right<=rect.right};
    }));
    assert.equal(buttons.length,3);
    assert.ok(buttons.every(b=>b.font===buttons[0].font&&b.size===buttons[0].size&&b.weight===buttons[0].weight&&b.height===buttons[0].height&&b.fits&&b.nowrap==='nowrap'),JSON.stringify({width,buttons}));
    if(width>768) assert.ok(buttons.every(b=>b.width===buttons[0].width),'Aligned equal-width row actions');
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    if(width===1440) await page.screenshot({path:'output/playwright/session-actions.png',fullPage:true});
  }
  await page.setViewportSize({width:1440,height:900});
  for(const route of ['sessions','roadmap?topic=sets']) {
    await page.goto(`${base}/#${route}`);
    await page.evaluate(async()=>Promise.all(document.getAnimations().map(a=>a.finished.catch(() => {}))));
    const result=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();
    assert.deepEqual(result.violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>n.failureSummary)})),[]);
  }
  console.log('Passed: content-sized cards, visible selected topics at desktop sizes, outside-click and Escape dismissal with focus return, standardized responsive session actions, accessibility');
} finally {await browser.close();}
