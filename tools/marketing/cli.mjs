import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { collection } from './collection.mjs';
import { embed } from './embeddings.mjs';
import { restoreResearch, syncIfConfigured } from './cloud.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
try { process.loadEnvFile(join(root, '.env.marketing.local')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
const [command, provider, ...args] = process.argv.slice(2);
const controller = new AbortController();
process.once('SIGINT', () => controller.abort());
const library = collection({ directory: join(root, '.local/marketing/research/embeddings') });
const output = value => console.log(JSON.stringify(value, (key, item) => key === 'vector' ? undefined : item, 2));

try {
  if (command === 'serve') {
    const receipt = await syncIfConfigured({ directory: join(root, '.local/marketing/research') });
    if (receipt) output({ cloud: receipt });
    const { serve } = await import('./server.mjs');
    const app = await serve({ directory: join(root, '.local/marketing/research') });
    console.log(`Developer research: ${app.url}`);
    process.once('SIGINT', () => { void app.close(); });
  } else if (command === 'cloud-sync') {
    const receipt = await syncIfConfigured({ directory: join(root, '.local/marketing/research') });
    if (!receipt) throw new Error('Configure MARKETING_D1_DATABASE_ID before cloud sync');
    output(receipt);
    if (receipt.status !== 'saved') process.exitCode = 1;
  } else if (command === 'cloud-restore') {
    if (!provider) throw new Error('Supply an empty restore directory');
    output(await restoreResearch({ directory: provider }));
  } else if (command === 'smoke') {
    // Synthetic valid PNG: no third-party creative or customer data leaves the machine.
    const inputs = [
      { modality: 'text', text: 'Python interview practice' },
      { modality: 'image', mimeType: 'image/png', data: 'iVBORw0KGgoAAAANSUhEUgAAAQAAAAEACAIAAADTED8xAAACz0lEQVR4nO3VgQkAIQwEQX3sv+V8GSI7U8ERWLJnZkHVd3sA3CQA0gRAmgBIEwBpAiBNAKQJgDQBkCYA0gRAmgBIEwBpAiBNAKQJgDQBkCYA0gRAmgBIEwBpAiBNAKQJgDQBkCYA0gRAmgBIEwBpAiBNAKQJgDQBkCYA0gRAmgBIEwBpAiBNAKQJgDQBkCYA0gRAmgBIEwBpAiBNAKQJgDQBkCYA0gRAmgBIEwBpAiBNAKQJgDQBkCYA0gRAmgBIEwBpAiBNAKSd9bi9by/Im3n4BD4AaQIgTQCkCYA0AZAmANIEQJoASBMAaQIgTQCkCYA0AZAmANIEQJoASBMAaQIgTQCkCYA0AZAmANIEQJoASBMAaQIgTQCkCYA0AZAmANIEQJoASBMAaQIgTQCkCYA0AZAmANIEQJoASBMAaQIgTQCkCYA0AZAmANIEQJoASBMAaQIgTQCkCYA0AZAmANIEQJoASBMAaQIgTQCkCYA0AZAmANIEQJoASBMAaQIgTQCkCYA0AZAmANIEQJoASBMAaQIgTQCkCYA0AZAmANIEQJoASBMAaQIgTQCkCYA0AZAmANIEQJoASBMAaQIgTQCkCYA0AZAmANIEQJoASBMAaQIgTQCkCYA0AZAmANIEQJoASBMAaQIgTQCkCYA0AZAmANIEQJoASBMAaQIgTQCkCYA0AZAmANIEQJoASBMAaQIgTQCkCYA0AZAmANIEQJoASDvrcTO3F/AyH4A0AZAmANIEQJoASBMAaQIgTQCkCYA0AZAmANIEQJoASBMAaQIgTQCkCYA0AZAmANIEQJoASBMAaQIgTQCkCYA0AZAmANIEQJoASBMAaQIgTQCkCYA0AZAmANIEQJoASBMAaQIgTQCkCYA0AZAmANIEQJoASBMAaQIgTQCkCYA0AZAmANIEQJoASBMAaQIgTQCkCYA0AZAmANIEQJoASBMAq+wHfaYI/2gTJZsAAAAASUVORK5CYII=' },
    ];
    for (const input of inputs) {
      output(await embed({ provider, input, signal: controller.signal }));
    }
  } else if (command === 'add') {
    const document = JSON.parse(await readFile(args[0], 'utf8'));
    const result = await library.add({ ...document, provider, signal: controller.signal });
    output(result);
    if (result.status !== 'ready') process.exitCode = 1;
  } else if (command === 'search') {
    output(await library.search({ provider, text: args.join(' '), signal: controller.signal }));
  } else if (command === 'list') {
    output(await library.list());
  } else {
    console.log('Commands: serve | cloud-sync | cloud-restore <empty-directory> | smoke <gemini|tongyi> | add <provider> <source.json> | search <provider> <text> | list');
    process.exitCode = 1;
  }
} catch (error) {
  // HTTP response bodies/headers and keys are deliberately never printed.
  console.error(error.message);
  process.exitCode = 1;
}
