import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { research } from '../tools/marketing/research.mjs';

test('operator discovery uses saved context for blank queries and preserves source identity', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'research-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const app = research({ directory, env: { EXA_API_KEY: 'fixture' }, fetch: async (url, options) => {
    assert.equal(url, 'https://api.exa.ai/search');
    assert.deepEqual(JSON.parse(options.body), { query: 'Python practice ads for new graduates', numResults: 2 });
    return Response.json({ results: [{ url: 'https://example.com/ad#top', title: 'Ad' }, { url: 'https://example.com/ad', title: 'Duplicate' }], costDollars: { total: 0.01 } });
  } });
  await app.setContext('Python practice ads for new graduates');
  const started = await app.start({ query: '', numResults: 2 });
  await started.finished;
  const run = await app.get(started.id);
  assert.equal(run.query, 'Python practice ads for new graduates');
  assert.equal(run.queryMode, 'saved-context');
  assert.equal(run.sources.length, 1);
  assert.equal(run.sources[0].url, 'https://example.com/ad');
  assert.equal(run.sources[0].observedMetrics, null);
  assert.deepEqual(run.discovery.cost, { total: 0.01 });
  assert.equal(await research({ directory }).getContext(), 'Python practice ads for new graduates');
});

test('uncertain Jev submission survives restart and cannot silently bill a duplicate call', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'research-')); t.after(() => rm(directory, { recursive: true, force: true }));
  const env = { DASHSCOPE_API_KEY: 'fixture', DASHSCOPE_BASE_URL: 'https://dashscope-intl.aliyuncs.com', QWEN_COVERED_USAGE_CONFIRMED: 'true', MONID_CLI_PATH: 'fixture-cli.js' };
  let submissions = 0;
  const options = { directory, env, fetch: async () => Response.json({ choices: [{ message: { content: '{"observations":[],"gaps":[]}' } }] }), exec: async () => { submissions++; throw new Error('Network failed after submission'); } };
  const app = research(options), run = await app.importSource({ url: 'https://example.com/image.png', kind: 'image' }); await run.finished;
  const reopened = research(options); await (await reopened.resume(run.id)).finished;
  assert.equal(submissions, 1);
  assert.match((await reopened.get(run.id)).sources[0].error, /submission uncertain/);
});

test('unsupported discovered URLs remain explicit without discarding usable sources', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'research-')); t.after(() => rm(directory, { recursive: true, force: true }));
  const app = research({ directory, env: { EXA_API_KEY: 'fixture' }, fetch: async () => Response.json({ results: [{ url: 'http://example.com/old' }, { url: 'https://example.com/ad' }] }) });
  const run = await app.start({ query: 'ads', numResults: 2 }); await run.finished;
  const result = await app.get(run.id);
  assert.equal(result.sources.length, 2);
  assert.equal(result.sources[0].unsupported, true);
  assert.equal(result.sources[1].url, 'https://example.com/ad');
});

test('resume reacquires missing visual media while preserving partial page text', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'research-')); t.after(() => rm(directory, { recursive: true, force: true }));
  let available = false;
  const app = research({ directory, env: { FIRECRAWL_API_KEY: 'fixture' }, fetch: async () => Response.json({ success: true, data: { markdown: 'Preserved copy', ...(available ? { screenshot: 'https://cdn.example.com/ad.png' } : {}) } }) });
  const run = await app.importSource({ url: 'https://example.com/ad', kind: 'page' }); await run.finished;
  assert.equal((await app.get(run.id)).sources[0].acquisition.markdown, 'Preserved copy');
  available = true; await (await app.resume(run.id)).finished;
  assert.equal((await app.get(run.id)).sources[0].acquisition.screenshot, 'https://cdn.example.com/ad.png');
});

test('manual video import retains timed observations under the original parent without inventing audio', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'research-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const app = research({ directory, env: { DASHSCOPE_API_KEY: 'fixture', DASHSCOPE_BASE_URL: 'https://dashscope-intl.aliyuncs.com', QWEN_COVERED_USAGE_CONFIRMED: 'true' }, fetch: async (_url, options) => {
    assert.equal(JSON.parse(options.body).messages[1].content[0].video_url.url, 'https://example.com/creative.mp4');
    return Response.json({ choices: [{ message: { content: JSON.stringify({ observations: [{ description: 'Problem shown', startSeconds: 0, endSeconds: 3 }], gaps: [] }) } }] });
  } });
  const run = await app.importSource({ url: 'https://example.com/creative.mp4', kind: 'video' }); await run.finished;
  const source = (await app.get(run.id)).sources[0];
  assert.equal(source.evidence.audio, 'unavailable');
  assert.equal(source.evidence.coverage, 'video-frames');
  assert.equal(source.evidence.observations[0].parentSourceId, source.id);
  assert.equal(source.evidence.observations[0].startSeconds, 0);
});

test('failed stages resume without repeating discovery; corrections retain original judgments', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'research-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const env = { EXA_API_KEY: 'fixture', FIRECRAWL_API_KEY: 'fixture', DASHSCOPE_API_KEY: 'fixture', DASHSCOPE_BASE_URL: 'https://dashscope-intl.aliyuncs.com', QWEN_COVERED_USAGE_CONFIRMED: 'true', MONID_CLI_PATH: 'fixture-cli.js' };
  let retry = false;
  const app = research({ directory, env, fetch: async url => {
    if (url.includes('exa.ai')) { assert.equal(retry, false, 'Discovery must survive retry'); return Response.json({ results: [{ url: 'https://example.com/ad' }] }); }
    if (url.includes('firecrawl')) return Response.json({ success: true, data: { screenshot: 'https://cdn.example.com/a.png' } });
    if (!retry) return Response.json({}, { status: 429 });
    return Response.json({ choices: [{ message: { content: '{"observations":[],"gaps":["No readable text"]}' } }] });
  }, exec: async () => ({ stdout: JSON.stringify({ status: 'COMPLETED', runId: 'fixture', output: { model: 'jev-1.13.0', answers: Object.fromEntries(['hook','format','awareness','offer','cta'].map(key => [key, { type: 'choice', choice: 'unknown', confidence: 1 }])) } }) }) });
  const started = await app.start({ query: 'ads', numResults: 1 }); await started.finished;
  assert.equal((await app.get(started.id)).status, 'partial');
  retry = true;
  await (await app.resume(started.id)).finished;
  const run = await app.get(started.id);
  assert.equal(run.status, 'complete');
  await app.correct(run.id, { sourceId: run.sources[0].id, field: 'hook', choice: 'demonstration', reason: 'Human reviewed original', reviewer: 'operator' });
  const changed = (await app.get(run.id)).sources[0];
  assert.equal(changed.classification.answers.hook.choice, 'unknown');
  assert.equal(changed.corrections[0].choice, 'demonstration');
  assert.equal(changed.corrections[0].agreesWithModel, false);
});

test('topic discovery acquires a page image, extracts cited evidence and returns typed Jev labels', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'research-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const env = { EXA_API_KEY: 'fixture', FIRECRAWL_API_KEY: 'fixture', DASHSCOPE_API_KEY: 'fixture', DASHSCOPE_BASE_URL: 'https://dashscope-intl.aliyuncs.com', QWEN_COVERED_USAGE_CONFIRMED: 'true', MONID_CLI_PATH: 'fixture-cli.js' };
  const fetch = async (url, options) => {
    const body = JSON.parse(options.body);
    if (url.includes('exa.ai')) {
      assert.equal(body.query, 'Python ads');
      return Response.json({ results: [{ url: 'https://example.com/ad', title: 'Ad' }] });
    }
    if (url.includes('firecrawl')) return Response.json({ success: true, data: { markdown: 'Practice free', screenshot: 'https://cdn.example.com/capture.png', metadata: { statusCode: 200 } } });
    assert.equal(body.model, 'qwen3.8-max');
    assert.equal(body.messages[1].content[0].image_url.url, 'https://cdn.example.com/capture.png');
    return Response.json({ choices: [{ message: { content: JSON.stringify({ observations: [{ description: 'Practice free CTA', region: 'center button' }], gaps: ['Video not inspected'] }) } }], usage: { total_tokens: 42 } });
  };
  const exec = async (_command, args) => {
    assert.ok(args.includes('typesafe'));
    assert.ok(args.includes('/systemone'));
    const body = JSON.parse(args[args.indexOf('-i') + 1]);
    assert.equal(body.state.evidence.observations[0].region, 'center button');
    assert.equal(JSON.stringify(body).includes('vector'), false);
    const answers = Object.fromEntries(Object.keys(body.questions).map(key => [key, { type: 'choice', choice: 'unknown', confidence: 0.5 }]));
    return { stdout: JSON.stringify({ status: 'COMPLETED', runId: 'fixture-run', output: { model: 'jev-1.13.0', answers, usage: { input_tokens: 80 } } }) };
  };
  const app = research({ directory, env, fetch, exec });
  const start = await app.start({ query: 'Python ads', numResults: 1 }); await start.finished;
  const run = await app.get(start.id);
  assert.equal(run.status, 'complete');
  const source = run.sources[0];
  assert.equal(source.evidence.coverage, 'page-screenshot');
  assert.equal(source.evidence.audio, 'unavailable');
  assert.equal(source.classification.model, 'jev-1.13.0');
  assert.equal(source.classification.answers.hook.choice, 'unknown');
  assert.equal(source.segmentId, 'page-screenshot');
});
