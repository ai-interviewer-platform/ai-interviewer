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
