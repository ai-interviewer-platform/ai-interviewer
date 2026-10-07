// Regression proof for the deployed audit findings; APIs are deterministic fixtures.
import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { devices } from 'playwright';
import { launchBrowser } from './launch.mjs';

test('workspace submission stays clickable; results identify tested code; review fetches current state', async () => {
  const root = resolve('public');
  const server = createServer(async (req, res) => {
    const path = new URL(req.url, 'http://localhost').pathname;
    const file = resolve(root, path === '/' ? 'index.html' : `.${path}`);
    if (!file.startsWith(root + sep)) return res.writeHead(404).end();
    try { res.writeHead(200, { 'content-type': ({'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml'})[extname(file)] || 'application/octet-stream' }).end(await readFile(file)); }
    catch { res.writeHead(404).end(); }
  });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  const browser = await launchBrowser({headless:true});
  try {
    const page = await browser.newPage({viewport:{width:1280,height:720}});
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const code = 'def below_zero(values):\n    return sum(values) < 0\n';
    const testedCode = 'def below_zero(values)\n    return False\n';
    let status = 'active', reviewStatus = 'pending', finished = 0;
    let result = {testId:'case',outcome:'failed',error:"SyntaxError: expected ':'"};
    const problem = {id:'problem',title:'Below zero',topic:'Arrays',difficulty:'Easy',prompt:'Find a negative balance.',entry_point:'below_zero',starter_code:code};
    const detail = () => ({attempt:{id:'attempt',created_at:new Date().toISOString(),status,mode:'mock',input_mode:'text',draft_source:code,draft_revision:5},problem,
      runs:[{id:'run',checkpoint_id:'checkpoint',status:'failed',tests_passed:0,tests_failed:1,test_results:[result]}],
      checkpoints:[{id:'checkpoint',source_code:testedCode}],events:[],transcripts:[],visibleTests:[{id:'case',input_data:{args:[[1,-2]]},expected_output:true}],
      review:status==='completed'?{status:'pending'}:null,submissionCheck:status==='completed'?{state:'checked',passed:3,total:3,failures:{}}:null,hasMore:false});
    const requests = [];
    await page.route('**/api/**', async route => {
      const path = new URL(route.request().url()).pathname;
      let body;
      if(path==='/api/site-config') body={};
      else if(path==='/api/personal-availability') body={collectionEnabled:true,voiceEnabled:false};
      else if(path==='/api/auth/get-session') body={user:{id:'user',name:'Audit fixture',email:'fixture@example.invalid'}};
      else if(path==='/api/me') body={userId:'user'};
      else if(path==='/api/catalog') body={problems:[problem]};
      else if(path==='/api/attempts') body={attempts:[{id:'attempt',title:problem.title,status,mode:'mock'}],hasMore:false,page:0};
      else if(path==='/api/attempts/attempt') body=detail();
      else if(path.endsWith('/review')) {requests.push(reviewStatus);body={review:{id:'review',status:reviewStatus},findings:reviewStatus==='ready'?[{id:'finding',observation:'Fresh finding',limitations:'Fixture evidence',evidence:[]}]:[]};}
      else if(path.endsWith('/related')) body={relatedProblems:[]};
      else if(path.endsWith('/finish')) {finished++;status='completed';body={dispatch:'queued',submissionCheck:{state:'checked',passed:3,total:3,failures:{}}};}
      else {throw new Error(`Unexpected API request: ${path}`);}
      await route.fulfill({contentType:'application/json',body:JSON.stringify(body)});
    });
    await page.goto(`http://127.0.0.1:${server.address().port}/#personal`);
    await page.locator('[data-open-attempt]').click();
    await page.locator('.cm-content').waitFor();
    assert.equal(await page.locator('.run-summary strong').innerText(),'Execution error');
    assert.match(await page.locator('.test-body').innerText(),/Current saved code differs from this run/);
    await page.getByText('View tested code',{exact:true}).click();
    assert.equal(await page.locator('.test-body details pre').innerText(),testedCode);
    await page.getByRole('button',{name:'Pause'}).click();
    await page.getByRole('heading',{name:'Your attempt is paused.'}).waitFor();
    assert.equal(await page.evaluate(()=>document.activeElement.textContent),'Resume');
    await page.getByRole('button',{name:'Resume'}).click();
    await page.locator('.cm-content').waitFor();
    for (const viewport of [{width:1280,height:720},devices['iPhone 13'].viewport]) {
      await page.setViewportSize(viewport);
      await page.locator('[data-finish]').click();
      await page.getByRole('dialog',{name:'Submit and finish?'}).getByRole('button',{name:'Cancel'}).click();
      assert.equal(finished,0,'mouse reached Submit confirmation without Report interception');
    }
    await page.setViewportSize({width:1280,height:720});
    for (const [error, heading] of [['ValueError: fixture','Execution error'],[null,'Wrong answer']]) {
      result = {testId:'case',outcome:'failed',...(error?{error}:{actualOutput:false})};
      await page.getByRole('button',{name:'← Sessions'}).click();
      await page.locator('[data-open-attempt]').click();
      assert.equal(await page.locator('.run-summary strong').innerText(),heading);
    }
    await page.locator('[data-finish]').click();
    await page.getByRole('dialog',{name:'Submit and finish?'}).getByRole('button',{name:'Submit code'}).click();
    await page.getByRole('button',{name:'Inspect review'}).waitFor();
    assert.equal(finished,1);
    reviewStatus='ready';
    await page.getByRole('button',{name:'Inspect review'}).click();
    await page.getByRole('heading',{name:'Review ready'}).waitFor();
    assert.equal(await page.getByText('Fresh finding',{exact:true}).count(),1);
    // Without authored related problems, the next step is the same topic in the catalog.
    await page.getByRole('button',{name:'Practice another Arrays problem'}).waitFor();
    assert.equal(new URL(page.url()).hash,'#personal?attempt=attempt&view=review');
    await page.reload();
    await page.getByRole('heading',{name:'Review ready'}).waitFor();
    assert.equal(requests.at(-1),'ready');
    await page.getByRole('button',{name:'← Back to attempt'}).click();
    reviewStatus='pending';
    await page.getByRole('button',{name:'Inspect review'}).click();
    await page.getByRole('button',{name:'Refresh review'}).waitFor();
    assert.equal(await page.getByText(/No findings were published/).count(),0);
    reviewStatus='ready';
    await page.getByRole('button',{name:'Refresh review'}).click();
    await page.getByRole('heading',{name:'Review ready'}).waitFor();
    await mkdir('output/playwright/audit-fixes',{recursive:true});
    await page.screenshot({path:'output/playwright/audit-fixes/review.png',fullPage:true});
    assert.deepEqual(errors,[]);
  } finally { await browser.close(); await new Promise(done=>server.close(done)); }
});
