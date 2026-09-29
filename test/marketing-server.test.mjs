import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { get } from 'node:http';
import { serve } from '../tools/marketing/server.mjs';

test('local API blocks foreign hosts/origins and streams an operator-triggered run', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'research-server-'));
  const app = await serve({ directory, env: { EXA_API_KEY: 'private-test-key' }, fetch: async () => Response.json({ results: [] }) });
  t.after(async () => { await app.close(); await rm(directory, { recursive: true, force: true }); });
  assert.equal(app.server.address().address, '127.0.0.1');
  const hostile = await new Promise(resolve => get(app.url, { headers: { Host: 'attacker.example' } }, res => { res.resume(); resolve(res.statusCode); }));
  assert.equal(hostile, 403);
  assert.equal((await fetch(`${app.url}/api/runs`, { method: 'POST', headers: { Origin: 'https://attacker.example', 'Content-Type': 'application/json' }, body: '{}' })).status, 403);
  assert.equal((await fetch(`${app.url}/.env.marketing.local`)).status, 404);
  const config = await (await fetch(`${app.url}/api/context`)).text();
  assert.equal(config.includes('private-test-key'), false);
  const response = await fetch(`${app.url}/api/runs`, { method: 'POST', headers: { Origin: app.url, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: 'practice ads', numResults: 1 }) });
  assert.equal(response.status, 202);
  const { id } = await response.json();
  const events = await (await fetch(`${app.url}/api/events/${id}`)).text();
  assert.ok(events.includes('"status":"complete"'));
});

test('closing the developer server cancels active provider work and persists cancellation', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'research-cancel-'));
  let notify, cancelled = false;
  const pending = new Promise(resolve => { notify = resolve; });
  const app = await serve({ directory, env: { EXA_API_KEY: 'fixture' }, fetch: async (_url, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener('abort', () => { cancelled = true; reject(new Error('aborted')); }); notify();
  }) });
  t.after(async () => { await app.close(); await rm(directory, { recursive: true, force: true }); });
  await fetch(`${app.url}/api/runs`, { method: 'POST', headers: { Origin: app.url, 'Content-Type': 'application/json' }, body: '{"query":"ads","numResults":1}' });
  await pending;
  await app.close();
  assert.equal(cancelled, true);
});

test('local operator indexes research media and retrieves evidence with isolated provider revisions', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'research-library-'));
  const app = await serve({ directory, env: { FIRECRAWL_API_KEY: 'fixture', DASHSCOPE_API_KEY: 'fixture', DASHSCOPE_BASE_URL: 'https://dashscope-intl.aliyuncs.com', QWEN_COVERED_USAGE_CONFIRMED: 'true', DASHSCOPE_COVERED_USAGE_CONFIRMED: 'true', GEMINI_API_KEY: 'fixture', GEMINI_COVERED_USAGE_CONFIRMED: 'true' }, fetch: async url => {
    if(url.includes('multimodal-embedding'))return Response.json({output:{embeddings:[{index:0,embedding:[1,0]}]}});
    if(url.includes('generativelanguage'))return Response.json({}, {status:402});
    if(url.includes('cdn.example'))return new Response(new Uint8Array([137,80,78,71]),{headers:{'Content-Type':'image/png'}});
    return Response.json({ choices:[{message:{content:'{"observations":[{"description":"Practice button","region":"center"}],"gaps":[]}'}}] });
  } });
  t.after(async()=>{await app.close();await rm(directory,{recursive:true,force:true});});
  const post=async(path,body)=>{const response=await fetch(app.url+path,{method:'POST',headers:{Origin:app.url,'Content-Type':'application/json'},body:JSON.stringify(body)});return {status:response.status,body:await response.json()};};
  const run=await post('/api/import',{url:'https://cdn.example.com/ad.png',kind:'image'});
  await (await fetch(app.url+'/api/events/'+run.body.id)).text();
  const source=(await (await fetch(app.url+'/api/runs')).json())[0].sources[0];
  const indexed=await post('/api/library/index',{runId:run.body.id,sourceId:source.id,provider:'tongyi',modality:'image'});
  assert.equal(indexed.status,200);
  assert.equal(indexed.body.status,'ready');
  assert.equal(indexed.body.source.runId,run.body.id);
  const search=await post('/api/library/search',{provider:'tongyi',text:'practice',modality:'image'});
  assert.equal(search.body.matches[0].source.url,'https://cdn.example.com/ad.png');
  assert.equal(search.body.matches[0].source.evidence.observations[0].region,'center');
  assert.equal(JSON.stringify(search.body).includes('"vector"'),false);
  const failed=await post('/api/library/index',{runId:run.body.id,sourceId:source.id,provider:'gemini',modality:'image'});
  assert.equal(failed.body.status,'unavailable');
  const retained=await post('/api/library/search',{provider:'tongyi',text:'practice'});
  assert.equal(retained.body.matches.length,1);
  assert.equal((await post('/api/library/search',{provider:'tongyi',text:'practice',modality:'video'})).body.matches.length,0);
  assert.equal((await (await fetch(app.url+'/api/library')).json()).length,2);
});
