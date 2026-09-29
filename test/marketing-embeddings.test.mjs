import test from 'node:test';
import assert from 'node:assert/strict';
import { embed } from '../tools/marketing/embeddings.mjs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { collection } from '../tools/marketing/collection.mjs';

test('Gemini embeds authorized image evidence with source lineage and usage', async () => {
  const result = await embed({
    provider: 'gemini', input: { modality: 'image', mimeType: 'image/png', data: 'aGVsbG8=' },
    env: { GEMINI_API_KEY: 'test-key', GEMINI_COVERED_USAGE_CONFIRMED: 'true' },
    fetch: async (url, options) => {
      assert.equal(url, 'https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-2:embedContent');
      assert.equal(options.headers['x-goog-api-key'], 'test-key');
      assert.equal(options.redirect, 'error');
      const body = JSON.parse(options.body);
      assert.deepEqual(body.content.parts, [{ inline_data: { mime_type: 'image/png', data: 'aGVsbG8=' } }]);
      assert.equal(body.taskType, undefined);
      return Response.json({ embedding: { values: [1, 0, 0] }, usageMetadata: { promptTokenCount: 7 } });
    },
  });
  assert.equal(result.model, 'gemini-embedding-2');
  assert.equal(result.dimensions, 3);
  assert.equal(result.modality, 'image');
  assert.deepEqual(result.usage, { promptTokenCount: 7 });
});

test('stored embeddings retrieve source evidence, isolate providers and retain failed revisions', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'marketing-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const env = { GEMINI_API_KEY: 'test', GEMINI_COVERED_USAGE_CONFIRMED: 'true', DASHSCOPE_API_KEY: 'test', DASHSCOPE_COVERED_USAGE_CONFIRMED: 'true', DASHSCOPE_BASE_URL: 'https://dashscope-intl.aliyuncs.com' };
  let failed = false;
  const request = async url => failed ? Response.json({ error: 'SECRET MUST NOT PERSIST' }, { status: 429 })
    : url.includes('googleapis') ? Response.json({ embedding: { values: [1, 0] } })
    : Response.json({ output: { embeddings: [{ index: 0, embedding: [1, 0] }] } });
  const library = collection({ directory, env, fetch: request });
  const source = { id: 'ad-1', segmentId: 'opening', url: 'https://example.com/ad', evidence: { observations: ['practice code'], coverage: 'image only' }, labels: { hook: 'demo' } };
  const input = { modality: 'text', text: 'coding interview practice' };
  await library.add({ provider: 'gemini', source, input });
  await library.add({ provider: 'tongyi', source, input });
  const reopened = collection({ directory, env, fetch: request });
  const results = await reopened.search({ provider: 'tongyi', text: 'practice' });
  assert.equal(results.matches.length, 1);
  assert.equal(results.matches[0].source.url, source.url);
  assert.deepEqual(results.matches[0].source.evidence, source.evidence);
  assert.equal(results.matches[0].embedding.provider, 'tongyi');
  assert.equal(results.matches[0].similarity, 1);
  failed = true;
  const failure = await library.add({ provider: 'tongyi', source, input });
  assert.equal(failure.status, 'unavailable');
  assert.equal(failure.error, 'Embedding tongyi HTTP 429');
  const records = await reopened.list();
  assert.equal(records.length, 3);
  assert.equal(records.filter(record => record.status === 'ready').length, 2);
  assert.equal(JSON.stringify(records).includes('SECRET'), false);
});

test('invalid configuration and unsupported media stop before any billable request', async () => {
  const env = { DASHSCOPE_API_KEY: 'secret', DASHSCOPE_COVERED_USAGE_CONFIRMED: 'true', DASHSCOPE_BASE_URL: 'https://app.monid.ai' };
  const request = async () => { assert.fail('Must not send a request'); };
  await assert.rejects(embed({ provider: 'tongyi', input: { modality: 'text', text: 'test' }, env, fetch: request }), /Alibaba HTTPS host/);
  env.DASHSCOPE_BASE_URL = 'https://dashscope-intl.aliyuncs.com';
  await assert.rejects(embed({ provider: 'tongyi', input: { modality: 'video', data: 'abc', mimeType: 'video/mp4' }, env, fetch: request }), /public HTTPS video URL/);
  await assert.rejects(embed({ provider: 'tongyi', input: { modality: 'audio', url: 'https://example.com/test.mp3' }, env, fetch: request }), /Unsupported modality/);
  env.DASHSCOPE_COVERED_USAGE_CONFIRMED = 'false';
  await assert.rejects(embed({ provider: 'tongyi', input: { modality: 'text', text: 'test' }, env, fetch: request }), /Confirm covered usage/);
});

test('Tongyi embeds image evidence directly through the configured Alibaba region', async () => {
  const result = await embed({
    provider: 'tongyi', input: { modality: 'image', mimeType: 'image/png', data: 'aGVsbG8=' },
    env: { DASHSCOPE_API_KEY: 'test-key', DASHSCOPE_BASE_URL: 'https://dashscope-intl.aliyuncs.com', DASHSCOPE_COVERED_USAGE_CONFIRMED: 'true' },
    fetch: async (url, options) => {
      assert.equal(url, 'https://dashscope-intl.aliyuncs.com/api/v1/services/embeddings/multimodal-embedding/multimodal-embedding');
      assert.equal(options.headers.Authorization, 'Bearer test-key');
      assert.deepEqual(JSON.parse(options.body), { model: 'tongyi-embedding-vision-plus', input: { contents: [{ image: 'data:image/png;base64,aGVsbG8=' }] } });
      return Response.json({ output: { embeddings: [{ index: 0, type: 'image', embedding: [0, 1, 0] }] }, usage: { input_tokens: 8 } });
    },
  });
  assert.equal(result.model, 'tongyi-embedding-vision-plus');
  assert.deepEqual(result.vector, [0, 1, 0]);
  assert.deepEqual(result.usage, { input_tokens: 8 });
});
