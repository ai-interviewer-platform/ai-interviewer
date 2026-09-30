import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { discover, acquire, observe, classify, publicUrl, taxonomy, scoreRubrics, landingPage } from './research-providers.mjs';
import { prepareVideo } from './media.mjs';
import { captions } from './captions.mjs';

const initialContext = 'Coursay: Python coding interview practice for students and new graduates actively preparing for SWE interviews. Find related ads and short-form or long-form content about explaining, testing and revising solutions.';

export function research({ directory, env = process.env, fetch = globalThis.fetch, exec }) {
  const active = new Map();
  const events = new EventEmitter();
  const path = id => {
    if (!/^[a-f0-9-]+$/.test(id)) throw new Error('Invalid run id');
    return join(directory, `${id}.json`);
  };
  // ponytail: synchronous local snapshots avoid Windows read/rename races;
  // move to transactional storage if measured record size blocks the local UI.
  function save(run) {
    mkdirSync(directory, { recursive: true });
    writeFileSync(`${path(run.id)}.pending`, JSON.stringify(run));
    renameSync(`${path(run.id)}.pending`, path(run.id));
    events.emit(run.id, structuredClone(run));
  }
  function get(id) {
    const run = JSON.parse(readFileSync(path(id), 'utf8'));
    if (run.status === 'running' && !active.has(id)) run.status = 'interrupted';
    return run;
  }
  async function getContext() {
    try { return await readFile(join(directory, 'context.txt'), 'utf8'); }
    catch (error) { if (error.code === 'ENOENT') return initialContext; throw error; }
  }
  async function execute(run, signal) {
    try {
      run.status = 'running'; delete run.error;
      if (!run.discovery) {
        run.stage = 'discovery';
        await save(run);
        const found = await discover({ query: run.query, numResults: run.numResults, env, fetch, signal });
        const capturedAt = new Date().toISOString();
        run.sources = [...new Map(found.results.slice(0, run.numResults).map(item => {
          let value, failure;
          try { value = publicUrl(item.url); } catch { failure = { unsupported: true, status: 'unavailable', discoveredUrl: item.url, error: 'Unsupported source URL; public HTTPS required' }; }
          const identity = value ?? item.url;
          return [identity, { id: createHash('sha256').update(identity).digest('hex'), url: value ?? null, title: item.title?.trim() || identity, observedMetrics: null, provenance: { discovery: 'exa', capturedAt }, ...failure }];
        })).values()];
        run.discovery = { cost: found.costDollars ?? null, capturedAt };
      }
      for (const source of run.sources) {
        if (source.status === 'complete' || source.unsupported) continue;
        try {
          signal.throwIfAborted();
          delete source.error;
          source.timings ??= {};
          let started = performance.now();
          run.stage = 'acquisition'; await save(run);
          if (!source.acquisition?.screenshot && !source.acquisition?.video) source.acquisition = source.uploadId
            ? await prepareVideo({ directory, id: source.uploadId, env, signal }) : await acquire({ source, directory, env, fetch, exec, signal });
          source.timings.acquisition ??= performance.now() - started;
          if (!source.title?.trim() || source.title === source.url) source.title = source.acquisition.metadata?.title || source.title || source.url;
          source.segmentId = source.acquisition.video || source.acquisition.localVideo ? 'video-frames' : source.kind === 'image' ? 'image' : 'page-screenshot';
          run.stage = 'vision'; await save(run);
          started = performance.now();
          source.evidence ??= await observe({ source, directory, env, fetch, signal, onSegment: segment => { source.visionSegments ??= []; source.visionSegments.push(segment); save(run); } });
          source.timings.vision ??= performance.now() - started;
          run.stage = 'captions'; await save(run); started = performance.now();
          source.evidence.speech ??= await captions({ source, env, fetch, exec, signal });
          source.timings.captions ??= performance.now() - started;
          source.provenance.access ??= source.uploadId ? 'Operator-supplied local video' : 'Public source without authentication or cookies';
          source.provenance.reportedCanonicalUrl ??= source.acquisition.metadata?.ogUrl ?? source.acquisition.metadata?.sourceURL ?? null;
          if (source.evidence.speech.status === 'available') {
            source.evidence.audio = 'caption-evidence';
            source.evidence.gaps = source.evidence.gaps.filter(gap => !gap.startsWith('Audio unavailable;') && gap !== 'Full video and spoken hooks unverified');
            source.evidence.gaps.push('Caption evidence is separate from sampled visual frames; speech accuracy is not independently verified');
          }
          if (source.landingUrl && !source.landingPage) source.landingPage = await landingPage({ url: source.landingUrl, env, fetch, signal });
          signal.throwIfAborted();
          run.stage = 'classification'; await save(run);
          if (!env.MONID_CLI_PATH) throw new Error('Configure MONID_CLI_PATH to installed CLI entry');
          if (source.jevAttempted && !source.jevRunId) throw new Error('Jev submission uncertain; attach its run id from Monid history before resuming');
          source.jevAttempted = true; await save(run);
          started = performance.now();
          const judged = await classify({ source, env, exec, signal });
          source.timings.classification = performance.now() - started;
          source.jevRunId = judged.runId;
          if (judged.pending) throw new Error(`Jev ${judged.status}; resume to inspect this run`);
          source.classification = judged;
          source.status = 'complete';
        } catch (error) {
          if (error.runId) source.jevRunId = error.runId;
          if (error.submissionNotStarted) delete source.jevAttempted;
          source.status = 'unavailable'; source.error = error.message;
          if (signal.aborted) throw error;
        }
        await save(run);
      }
      run.status = run.sources.some(source => source.status !== 'complete') ? 'partial' : 'complete';
    } catch (error) {
      run.status = signal.aborted ? 'cancelled' : 'failed';
      run.error = error.message;
    }
    run.stage = null;
    run.finishedAt = new Date().toISOString();
    await save(run);
  }
  function launch(run) {
    const controller = new AbortController();
    const finished = execute(run, controller.signal).finally(() => active.delete(run.id));
    active.set(run.id, { controller, finished });
    return { id: run.id, finished };
  }
  return {
    get, getContext,
    async importUpload({ id, name }) {
      const run = { id: randomUUID(), query: name, queryMode: 'local-upload', numResults: 1, createdAt: new Date().toISOString(), status: 'running', discovery: { mode: 'local-upload', cost: null }, sources: [{ id, uploadId: id, title: name, url: null, kind: 'video', observedMetrics: null, provenance: { discovery: 'local-upload', capturedAt: new Date().toISOString() } }] };
      save(run); return launch(run);
    },
    async shutdown() {
      const jobs = [...active.values()];
      jobs.forEach(job => job.controller.abort());
      await Promise.allSettled(jobs.map(job => job.finished));
    },
    async importSource({ url, kind, landingUrl }) {
      if (!['page', 'image', 'video'].includes(kind)) throw new Error('Source kind must be page, image or video');
      const value = publicUrl(url);
      if (landingUrl && publicUrl(landingUrl) === value) throw new Error('Landing page must be separate from the creative');
      const run = { id: randomUUID(), query: value, queryMode: 'manual-import', numResults: 1, createdAt: new Date().toISOString(), status: 'running', discovery: { mode: 'manual-import', cost: null }, sources: [{ id: createHash('sha256').update(value).digest('hex'), url: value, title: value, kind, observedMetrics: null, provenance: { discovery: 'operator', capturedAt: new Date().toISOString() } }] };
      if (landingUrl) run.sources[0].landingUrl = publicUrl(landingUrl);
      save(run); return launch(run);
    },
    subscribe(id, listener) { events.on(id, listener); return () => events.off(id, listener); },
    async cancel(id) { const current = active.get(id); current?.controller.abort(); await current?.finished; return get(id); },
    async reconcile(id, { sourceId, runId }) {
      if (active.has(id)) throw new Error('Stop run before reconciling');
      if (typeof runId !== 'string' || !/^[0-9A-HJKMNP-TV-Z]{26}$/.test(runId)) throw new Error('Monid run id required');
      const run = get(id), source = run.sources.find(item => item.id === sourceId);
      if (!source || source.classification) throw new Error('Unfinished source required');
      source.jevRunId = runId; save(run); return run;
    },
    async resume(id) {
      if (active.has(id)) throw new Error('Run already active');
      const run = get(id);
      if (run.status === 'complete') throw new Error('Run already complete');
      return launch(run);
    },
    async correct(id, { sourceId, field, choice, score, reason, reviewer }) {
      if (active.has(id)) throw new Error('Wait for run to stop before correcting');
      const scored = Object.hasOwn(scoreRubrics, field);
      const valid = scored ? Number.isFinite(score) && score >= 0 && score <= 3 : Object.hasOwn(taxonomy, field) && taxonomy[field].includes(choice);
      if (!valid || typeof reason !== 'string' || !reason.trim() || typeof reviewer !== 'string' || !reviewer.trim()) throw new Error('Valid judgment, reviewer and rationale required');
      const run = get(id);
      const source = run.sources.find(item => item.id === sourceId);
      if (!source?.classification) throw new Error('Classified source required');
      source.corrections ??= [];
      source.corrections.push({ field, ...(scored ? { type: 'score', score } : { type: 'choice', choice }), reason, reviewer, agreesWithModel: scored ? source.classification.answers[field]?.score === score : source.classification.answers[field]?.choice === choice, createdAt: new Date().toISOString() });
      await save(run);
      return run;
    },
    async setContext(value) {
      if (typeof value !== 'string' || !value.trim()) throw new Error('Product/audience context required');
      await mkdir(directory, { recursive: true });
      await writeFile(join(directory, 'context.txt'), value.trim());
    },
    async list() {
      await mkdir(directory, { recursive: true });
      const files = (await readdir(directory)).filter(name => name.endsWith('.json'));
      return Promise.all(files.map(file => get(file.slice(0, -5))));
    },
    async start({ query, numResults }) {
      if (typeof query !== 'string' || !Number.isSafeInteger(numResults) || numResults <= 0) throw new Error('Topic and explicit positive source count required');
      const run = { id: randomUUID(), query: query.trim() || await getContext(), queryMode: query.trim() ? 'topic' : 'saved-context', numResults, createdAt: new Date().toISOString(), status: 'running', sources: [] };
      await save(run);
      return launch(run);
    },
  };
}
