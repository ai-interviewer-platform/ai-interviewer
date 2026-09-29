import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { embed } from './embeddings.mjs';

function sameSpace(left, right) {
  return ['provider', 'model', 'dimensions', 'encodingVersion'].every(key => left[key] === right[key]);
}

function similarity(left, right) {
  const dot = left.reduce((sum, value, i) => sum + value * right[i], 0);
  const norm = vector => Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  return dot / (norm(left) * norm(right));
}

// Immutable revisions preserve source lineage and failed re-embedding attempts.
// JSON files live outside public/ and are never imported by the Worker.
export function collection({ directory, env = process.env, fetch = globalThis.fetch }) {
  async function list() {
    await mkdir(directory, { recursive: true });
    const files = (await readdir(directory)).filter(name => name.endsWith('.json'));
    return Promise.all(files.map(async name => JSON.parse(await readFile(join(directory, name), 'utf8'))));
  }
  return {
    list,
    async add({ provider, source, input, signal }) {
      if (!source?.id || !source?.segmentId || !source?.url) throw new Error('Source id, segmentId and original URL required');
      const record = {
        id: randomUUID(), source, provider, createdAt: new Date().toISOString(),
        inputHash: createHash('sha256').update(JSON.stringify(input)).digest('hex'),
      };
      try {
        record.embedding = await embed({ provider, input, env, fetch, signal });
        record.status = 'ready';
      } catch (error) {
        record.status = 'unavailable';
        record.error = error.message;
      }
      await mkdir(directory, { recursive: true });
      const path = join(directory, record.id);
      await writeFile(`${path}.pending`, JSON.stringify(record), { flag: 'wx' });
      await rename(`${path}.pending`, `${path}.json`);
      return record;
    },
    async search({ provider, text, signal }) {
      const query = await embed({ provider, input: { modality: 'text', text }, purpose: 'query', env, fetch, signal });
      const records = await list();
      const matches = records.filter(record => record.status === 'ready' && sameSpace(record.embedding, query))
        .map(record => ({ ...record, similarity: similarity(record.embedding.vector, query.vector) }))
        .sort((a, b) => b.similarity - a.similarity);
      return { matches, usage: query.usage, interpretation: 'Semantic similarity only; not evidence of conversion performance.' };
    },
  };
}
