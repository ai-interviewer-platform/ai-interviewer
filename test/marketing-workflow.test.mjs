import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { research } from '../tools/marketing/research.mjs';

test('social post acquisition uses a public video extractor when page scraping fails', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'research-social-')); t.after(() => rm(directory, { recursive: true, force: true }));
  const app = research({ directory, env: { FIRECRAWL_API_KEY: 'fixture', YTDLP_PYTHON: 'python-fixture', YTDLP_PYTHONPATH: 'fixture-modules', DASHSCOPE_API_KEY: 'fixture', DASHSCOPE_BASE_URL: 'https://dashscope-intl.aliyuncs.com', QWEN_COVERED_USAGE_CONFIRMED: 'true' }, fetch: async (url, options) => {
    if (url.includes('firecrawl')) return Response.json({}, { status: 500 });
    assert.equal(JSON.parse(options.body).messages[1].content[0].video_url.url, 'https://video.twimg.com/creative.mp4');
    return Response.json({ choices: [{ message: { content: '{"observations":[{"description":"Ad","startSeconds":0,"endSeconds":2}],"gaps":[]}' } }] });
  }, exec: async (command, args) => {
    assert.equal(command, 'python-fixture'); assert.ok(args.includes('--ignore-config')); assert.ok(args.includes('--no-plugin-dirs'));
    return { stdout: JSON.stringify({ url: 'https://video.twimg.com/creative.mp4', title: 'Original creative', thumbnail: 'https://pbs.twimg.com/image.jpg', uploader: 'Creator', description: 'Visible post copy', duration: 48 }) };
  } });
  const job = await app.importSource({ url: 'https://x.com/creator/status/123', kind: 'page' }); await job.finished;
  const source = app.get(job.id).sources[0];
  assert.equal(source.acquisition.collector, 'yt-dlp');
  assert.equal(source.url, 'https://x.com/creator/status/123');
  assert.equal(source.evidence.coverage, 'video-frames');
});

test('discovered video is inspected as video and gets the twelve reference judgments without invented landing evidence', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'research-video-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const app = research({ directory, env: { EXA_API_KEY: 'fixture', FIRECRAWL_API_KEY: 'fixture', DASHSCOPE_API_KEY: 'fixture', DASHSCOPE_BASE_URL: 'https://dashscope-intl.aliyuncs.com', QWEN_COVERED_USAGE_CONFIRMED: 'true', MONID_CLI_PATH: 'fixture-cli' }, fetch: async (url, options) => {
    if (url.includes('exa.ai')) return Response.json({ results: [{ url: 'https://example.com/watch' }] });
    if (url.includes('firecrawl')) return Response.json({ success: true, data: { video: 'https://cdn.example.com/ad.mp4', screenshot: 'https://cdn.example.com/poster.png', markdown: 'Start practicing' } });
    assert.equal(JSON.parse(options.body).messages[1].content[0].video_url.url, 'https://cdn.example.com/ad.mp4');
    return Response.json({ choices: [{ message: { content: JSON.stringify({ observations: [{ description: 'Practice CTA', startSeconds: 4, endSeconds: 5 }], gaps: [] }) } }] });
  }, exec: async (_cmd, args) => {
    const body = JSON.parse(await readFile(args[args.indexOf('--input-file') + 1], 'utf8'));
    assert.equal(Object.keys(body.questions).length, 12);
    assert.equal(body.questions.hookSpecificity.type, 'score');
    assert.equal(body.state.landingPage, null);
    return { stdout: JSON.stringify({ status: 'COMPLETED', runId: 'fixture', output: { model: 'jev-1.13.0', answers: Object.fromEntries(Object.entries(body.questions).map(([key, q]) => [key, q.type === 'score' ? { type: 'score', score: 2.3, confidence: 0.8 } : { type: 'choice', choice: key === 'homepageMatch' ? 'holds' : 'unknown', confidence: 0.8 }])) } }) };
  } });
  const job = await app.start({ query: 'practice video ads', numResults: 1 }); await job.finished;
  const source = app.get(job.id).sources[0];
  assert.equal(source.status, 'complete');
  assert.equal(source.acquisition.video, 'https://cdn.example.com/ad.mp4');
  assert.equal(source.classification.answers.homepageMatch.choice, 'unknown');
  assert.equal(source.classification.answers.hookSpecificity.score, 2.3);
  assert.ok(source.timings.classification >= 0);
});

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
  }, exec: async (_command, args) => ({ stdout: JSON.stringify({ status: 'COMPLETED', runId: 'fixture', output: { model: 'jev-1.13.0', answers: Object.fromEntries(Object.entries(JSON.parse(await readFile(args[args.indexOf('--input-file') + 1], 'utf8')).questions).map(([key, q]) => [key, q.type === 'score' ? { type: 'score', score: 1, confidence: 1 } : { type: 'choice', choice: 'unknown', confidence: 1 }])) } }) }) });
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
  await app.correct(run.id, { sourceId: run.sources[0].id, field: 'hookSpecificity', score: 3, reason: 'Specific hook visible', reviewer: 'operator' });
  const scored = app.get(run.id).sources[0];
  assert.equal(scored.classification.answers.hookSpecificity.score, null);
  assert.equal(scored.corrections.at(-1).score, 3);
  await assert.rejects(app.correct(run.id, { sourceId: scored.id, field: 'hookSpecificity', score: 4, reason: 'Outside rubric', reviewer: 'operator' }));
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
    const body = JSON.parse(await readFile(args[args.indexOf('--input-file') + 1], 'utf8'));
    assert.equal(body.state.evidence.observations[0].region, 'center button');
    assert.equal(JSON.stringify(body).includes('vector'), false);
    const answers = Object.fromEntries(Object.entries(body.questions).map(([key,q]) => [key, q.type === 'score' ? { type: 'score', score: 1, confidence: 0.5 } : { type: 'choice', choice: 'unknown', confidence: 0.5 }]));
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

test('available captions retain timed spoken evidence through discovery and Jev classification', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'research-captions-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const app = research({ directory, env: { EXA_API_KEY: 'fixture', FIRECRAWL_API_KEY: 'fixture', YTDLP_PYTHON: 'fixture-python', DASHSCOPE_API_KEY: 'fixture', DASHSCOPE_BASE_URL: 'https://dashscope-intl.aliyuncs.com', QWEN_COVERED_USAGE_CONFIRMED: 'true', MONID_CLI_PATH: 'fixture-cli' },
    fetch: async url => {
      if (url.includes('exa.ai')) return Response.json({ results: [{ url: 'https://www.youtube.com/watch?v=fixture' }] });
      if (url.includes('firecrawl')) return Response.json({ success: true, data: { video: 'https://cdn.example.com/ad.mp4' } });
      if (url.includes('captions.example.com')) return Response.json({ events: [{ tStartMs: 0, dDurationMs: 2000, segs: [{ utf8: 'Practice your next interview.' }] }] });
      return Response.json({ choices: [{ message: { content: '{"observations":[{"description":"Practice button","startSeconds":0,"endSeconds":2}],"gaps":[]}' } }] });
    }, exec: async (command, args) => {
      if (command === 'fixture-python') return { stdout: JSON.stringify({ language: 'en', subtitles: { en: [{ ext: 'json3', url: 'https://captions.example.com/en.json' }] }, view_count: 15, webpage_url: 'https://www.youtube.com/watch?v=fixture' }) };
      const body = JSON.parse(await readFile(args[args.indexOf('--input-file') + 1], 'utf8'));
      assert.equal(body.state.evidence.speech.cues[0].text, 'Practice your next interview.');
      return { stdout: JSON.stringify({ status: 'COMPLETED', runId: 'fixture', output: { model: 'jev-1.13.0', answers: Object.fromEntries(Object.entries(body.questions).map(([key, q]) => [key, q.type === 'score' ? { type: 'score', score: 1, confidence: 1 } : { type: 'choice', choice: 'unknown', confidence: 1 }])) } }) };
    } });
  const job = await app.start({ query: 'practice ad', numResults: 1 }); await job.finished;
  const source = app.get(job.id).sources[0];
  assert.equal(source.status, 'complete');
  assert.equal(source.evidence.speech.status, 'available');
  assert.equal(source.evidence.speech.cues[0].startSeconds, 0);
  assert.equal(source.evidence.speech.cues[0].endSeconds, 2);
  assert.equal(source.evidence.speech.kind, 'publisher-captions');
  assert.equal(source.observedMetrics.views, 15);
});
