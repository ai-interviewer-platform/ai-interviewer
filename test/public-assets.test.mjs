import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const { config } = ts.parseConfigFileTextToJson('wrangler.jsonc', await readFile('wrangler.jsonc', 'utf8'));

// src/worker.ts sends every non-API path to env.ASSETS. Without the binding, an
// unmatched path such as /robots.txt throws (Cloudflare error 1101).
test('non-API paths reach the asset binding and crawlers get the site origin', async () => {
  assert.equal(config.assets.binding, 'ASSETS');
  const origin = config.vars.BETTER_AUTH_URL;
  assert.match(await readFile('public/robots.txt', 'utf8'), new RegExp(`Sitemap: ${origin}/sitemap.xml`));
  assert.match(await readFile('public/sitemap.xml', 'utf8'), new RegExp(`<loc>${origin}/</loc>`));
});
