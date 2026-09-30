import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { syncResearch, restoreResearch, syncIfConfigured } from '../tools/marketing/cloud.mjs';
import { research } from '../tools/marketing/research.mjs';

test('cloud archive restores analyzed sources, legacy vectors and original video without exposing a public endpoint', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'marketing-cloud-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const source = join(directory, 'research'), restored = join(directory, 'restored');
  await mkdir(join(source, 'media'), { recursive: true });
  await mkdir(join(directory, 'embeddings'));
  await writeFile(join(source, 'ad.json'), JSON.stringify({ id: 'ad', sources: [{ url: 'https://example.com/ad', evidence: { observations: ['visible offer'] }, classification: { hook: 'demo' } }] }));
  await writeFile(join(source, 'media', 'ad.upload'), Buffer.from([0, 255, 7, 42]));
  await writeFile(join(directory, 'embeddings', 'old.json'), '{"embedding":{"vector":[1,0]}}');
  const db = new DatabaseSync(':memory:'), objects = new Map();
  t.after(() => db.close());
  const fetch = async (url, options = {}) => {
    assert.equal(new URL(url).hostname, 'api.cloudflare.com');
    assert.equal(options.headers.Authorization, 'Bearer fixture');
    if (url.endsWith('/query')) {
      const { sql, params = [] } = JSON.parse(options.body);
      return Response.json({ success: true, result: [{ success: true, results: db.prepare(sql).all(...params) }] });
    }
    if (options.method === 'PUT') { objects.set(url, Buffer.from(options.body)); return Response.json({ success: true }); }
    return new Response(objects.get(url) ?? null, { status: objects.has(url) ? 200 : 404 });
  };
  const env = { CLOUDFLARE_API_TOKEN: 'fixture', MARKETING_CLOUDFLARE_ACCOUNT_ID: 'account', MARKETING_D1_DATABASE_ID: 'database', MARKETING_R2_BUCKET: 'private-research' };
  const first = await syncResearch({ directory: source, env, fetch });
  assert.equal(first.files, 3);
  assert.equal(first.verified, 3);
  const second = await syncResearch({ directory: source, env, fetch });
  assert.equal(second.uploaded, 0);
  await restoreResearch({ directory: restored, env, fetch });
  assert.deepEqual(await readFile(join(restored, 'ad.json')), await readFile(join(source, 'ad.json')));
  assert.deepEqual(await readFile(join(restored, 'media', 'ad.upload')), Buffer.from([0, 255, 7, 42]));
  assert.equal(await readFile(join(restored, 'legacy-embeddings', 'old.json'), 'utf8'), '{"embedding":{"vector":[1,0]}}');
});

test('cloud outage keeps local evidence readable and reports a retryable pending save', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'marketing-cloud-outage-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(join(directory, 'ab.json'), '{"id":"ab","status":"complete","sources":[{"evidence":"kept"}]}');
  const env = { CLOUDFLARE_API_TOKEN: 'fixture', MARKETING_CLOUDFLARE_ACCOUNT_ID: 'account', MARKETING_D1_DATABASE_ID: 'database', MARKETING_R2_BUCKET: 'private-research' };
  const result = await syncIfConfigured({ directory, env, fetch: async () => new Response('private provider details', { status: 503 }) });
  assert.deepEqual(result.error, 'Cloudflare archive HTTP 503');
  assert.equal(result.status, 'pending');
  assert.deepEqual((await research({ directory }).list())[0].sources, [{ evidence: 'kept' }]);
  assert.equal(JSON.parse(await readFile(join(directory, '.cloud-sync.json'), 'utf8')).status, 'pending');
});
