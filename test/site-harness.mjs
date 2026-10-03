// The real request handler, an isolated PostgreSQL schema and the public assets,
// served on one local origin for API and browser checks.
import { build } from 'esbuild';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { testDatabase } from './postgres-harness.mjs';

export const operatorToken = 'fixture-operator-secret';
const types = { '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.html': 'text/html' };

export async function siteHarness(name, env) {
  const directory = await mkdtemp(join(tmpdir(), `${name}-`));
  const { pool, drop } = await testDatabase(name, { problemBank: false });
  await build({ entryPoints: ['src/request-handler.ts'], outdir: directory, outExtension: { '.js': '.mjs' }, bundle: true, format: 'esm', platform: 'node' });
  const { handleRequest } = await import(pathToFileURL(join(directory, 'request-handler.mjs')));
  const assets = resolve('public');
  let base;
  const configured = () => ({ BETTER_AUTH_URL: base, WAITLIST_OPERATOR_TOKEN: operatorToken, ...env });
  const dependencies = { database: () => pool, sessions: () => { throw Error('Site support must not require a personal session'); } };
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, base);
    if (url.pathname.startsWith('/api/')) {
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      const response = await handleRequest(new Request(url, { method: req.method, headers: req.headers, ...(['GET', 'HEAD'].includes(req.method) ? {} : { body: Buffer.concat(chunks) }) }), configured(), {}, dependencies);
      res.writeHead(response.status, Object.fromEntries(response.headers)); res.end(Buffer.from(await response.arrayBuffer())); return;
    }
    const path = resolve(assets, url.pathname === '/' ? 'index.html' : `.${url.pathname}`);
    if (!path.startsWith(assets + sep)) { res.writeHead(404).end(); return; }
    try { res.writeHead(200, { 'content-type': types[extname(path)] || 'application/octet-stream' }); res.end(await readFile(path)); }
    catch { res.writeHead(404).end(); }
  });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  base = `http://127.0.0.1:${server.address().port}`;
  // Calls the handler directly. `body` undefined sends a GET; a string body is sent as is.
  // `database` replaces the real pool, for example with one that fails when it is touched.
  const request = (path, body, headers = {}, overrides = {}, database = dependencies.database) => handleRequest(new Request(base + path, { method: body === undefined ? 'GET' : 'POST', headers: { origin: base, 'content-type': 'application/json', ...headers }, ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }) }), { ...configured(), ...overrides }, {}, { ...dependencies, database });
  const operator = async (path, body) => (await request(path, body, { authorization: `Bearer ${operatorToken}` })).json();
  async function close() {
    await new Promise(done => server.close(done));
    await drop();
    await rm(directory, { recursive: true, force: true });
  }
  return { pool, base, request, operator, close };
}
