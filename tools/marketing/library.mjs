import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { collection } from './collection.mjs';
import { mediaPath } from './media.mjs';
import { publicUrl } from './research-providers.mjs';

export function library({ research, directory, env, fetch = globalThis.fetch }) {
  const records = collection({ directory: join(directory, 'embeddings'), env, fetch });
  const withoutVector = record => ({ ...record, ...(record.embedding ? { embedding: { ...record.embedding, vector: undefined } } : {}) });
  return {
    async list() { return (await records.list()).map(withoutVector); },
    async index({ runId, sourceId, provider, modality, segmentId, signal }) {
      const run = research.get(runId);
      if (run.status === 'running') throw new Error('Wait for the research run to stop');
      const creative = run.sources.find(source => source.id === sourceId);
      if (!creative?.evidence) throw new Error('Source evidence required');
      const source = { id: creative.id, runId, url: creative.url, uploadId: creative.uploadId, title: creative.title,
        segmentId: segmentId || (modality === 'image' ? 'poster-or-image' : creative.segmentId),
        evidence: creative.evidence, labels: creative.classification, corrections: creative.corrections ?? [], provenance: creative.provenance,
        playback: creative.acquisition.playback ?? creative.acquisition.video, screenshot: creative.acquisition.screenshot };
      let input = { modality }, error;
      try {
        const acquisition = creative.acquisition;
        if (modality === 'text') input = { modality, text: JSON.stringify({ observations: creative.evidence.observations, speech: creative.evidence.speech }), title: creative.title };
        else if (modality === 'image') {
          let data, mimeType;
          if (acquisition.localVideo) { data = await readFile(mediaPath(directory, acquisition.localVideo, 'jpg')); mimeType = 'image/jpeg'; }
          else {
            const response = await fetch(publicUrl(acquisition.screenshot), { signal, redirect: 'error' });
            if (!response.ok) throw new Error(`Image acquisition HTTP ${response.status}`);
            data = Buffer.from(await response.arrayBuffer()); mimeType = response.headers.get('content-type')?.split(';')[0];
          }
          input = { modality, mimeType, data: data.toString('base64') };
          source.coverage = acquisition.video || acquisition.localVideo ? 'Poster only; not full video' : creative.evidence.coverage;
        } else if (modality === 'video') {
          if (acquisition.localVideo) {
            if (provider === 'tongyi') throw new Error('Tongyi video requires a public URL; choose the local poster or Gemini video explicitly');
            const chunk = acquisition.chunks.find(item => item.id === segmentId) ?? (acquisition.chunks.length === 1 ? acquisition.chunks[0] : null);
            if (!chunk) throw new Error('Choose a video segment');
            input = { modality, mimeType: 'video/mp4', data: (await readFile(mediaPath(directory, chunk.id, 'mp4'))).toString('base64') };
            Object.assign(source, { segmentId: chunk.id, startSeconds: chunk.startSeconds, endSeconds: chunk.endSeconds });
          } else if (provider === 'tongyi') input = { modality, url: publicUrl(acquisition.video) };
          else {
            const response = await fetch(publicUrl(acquisition.video), { signal, redirect: 'error' });
            if (!response.ok) throw new Error(`Video acquisition HTTP ${response.status}`);
            input = { modality, mimeType: response.headers.get('content-type')?.split(';')[0], data: Buffer.from(await response.arrayBuffer()).toString('base64') };
          }
        } else throw new Error('Choose image, video or text');
      } catch (failure) { error = failure.message; }
      return withoutVector(await records.add({ provider, source, input, signal, error }));
    },
    async search({ provider, text, modality, hook, signal }) {
      const result = await records.search({ provider, text, signal });
      result.matches = result.matches.filter(record => (!modality || record.embedding.modality === modality)
        && (!hook || (record.source.corrections?.findLast(item => item.field === 'hook')?.choice ?? record.source.labels?.answers?.hook?.choice) === hook)).map(withoutVector);
      return result;
    },
  };
}
