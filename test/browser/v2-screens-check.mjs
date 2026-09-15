import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import assert from 'node:assert/strict';
const base=process.env.APP_URL;
if (!base) throw new Error('Set APP_URL to the running preview.');
const browser=await chromium.launch({channel:'msedge'});
const context=await browser.newContext({viewport:{width:1440,height:900}});
const page=await context.newPage();
try {
 for(const route of ['welcome','profile']) {
  await page.goto(`${base}/#${route}`);
  await page.locator('.v2-screen').waitFor();
  await page.evaluate(async()=>{await document.fonts.ready;await Promise.all(document.getAnimations().map(a=>a.finished));});
  const result=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();
  // The requested reference palette retains its known secondary-text contrast findings.
  console.log(route, 'reference-palette contrast findings:', result.violations.filter(v=>v.id==='color-contrast').flatMap(v=>v.nodes).length);
  assert.deepEqual(result.violations.filter(v=>v.id!=='color-contrast').map(v=>({id:v.id,nodes:v.nodes.map(n=>({target:n.target,summary:n.failureSummary}))})),[],route);
  await page.screenshot({path:`output/playwright/${route}-v2-verified.png`,fullPage:true});
  for(const width of [768,320]) {
   await page.setViewportSize({width,height:900});
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
   assert.deepEqual(await page.locator('.v2-screen a,.v2-screen button').evaluateAll(es=>es.filter(e=>!e.closest('.v2-map-scroll')&&e.getBoundingClientRect().right>innerWidth).map(e=>e.textContent)),[]);
   await page.screenshot({path:`output/playwright/${route}-v2-${width}-verified.png`,fullPage:true});
  }
  await page.setViewportSize({width:1440,height:900});
 }
 await page.goto(`${base}/#welcome`);
 for (const [name,title] of [['Retry','Try it differently'],['Attempt','Attempt saved'],['Review','Review the evidence']]) {
  await page.getByRole('button',{name,exact:true}).click();
  assert.equal(await page.getByRole('button',{name,exact:true}).getAttribute('aria-current'),'step');
  await page.getByText(title,{exact:true}).waitFor();
 }
 await page.getByRole('link',{name:'You found the match. What happened next?',exact:true}).click();
 assert.equal(new URL(page.url()).hash,'#review');
 await page.goto(`${base}/#profile`);
 assert.equal(await page.locator('.v2-profile-26').count(),26*7);
 await page.getByRole('button',{name:'Edit profile'}).click();
 await page.getByLabel('Display name').fill('Morgan');
 await page.getByLabel('Bio').fill('Practicing Python');
 await page.getByRole('button',{name:'Save profile'}).click();
 await page.getByRole('heading',{name:'Morgan',exact:true}).waitFor();
 assert.ok((await page.locator('.v2-profile').textContent()).includes('Practicing Python'));
 await page.getByRole('link',{name:/Loops 1 attempt/}).click();
 assert.equal(new URL(page.url()).hash,'#roadmap?topic=flow');
 await page.emulateMedia({reducedMotion:'reduce'});
 await page.goto(`${base}/#welcome`);
 assert.equal(await page.locator('.v2-screen').evaluate(e=>e.getAnimations({subtree:true}).length),0);
 console.log('Passed: v2 screens, structural accessibility, responsive controls, stage selection, review navigation, profile editing, topic routes and reduced motion.');
} finally {await browser.close();}
