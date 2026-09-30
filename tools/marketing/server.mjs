import { createServer } from 'node:http';
import { readFile, mkdir, stat, rm } from 'node:fs/promises';
import { createWriteStream, createReadStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { mediaPath } from './media.mjs';
import { research } from './research.mjs';
import { library } from './library.mjs';
import { strategy } from './strategy.mjs';
import { syncIfConfigured } from './cloud.mjs';
import { evaluate } from './evaluation.mjs';
import { taxonomy, scoreRubrics } from './research-providers.mjs';

export async function serve(options) {
  options = { env: process.env, ...options };
  const app = research(options);
  const archive = library({ ...options, research: app });
  const planner = strategy({ ...options, research: app });
  const libraryJobs = new Set();
  let origin;
  const files = { '/': ['index.html', 'text/html'], '/app.js': ['app.js', 'text/javascript'], '/strategy.js': ['strategy.js', 'text/javascript'], '/style.css': ['style.css', 'text/css'] };
  const server = createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' https:; media-src 'self' https:; style-src 'self' 'unsafe-inline'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    const json = (status, value) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(value)); };
    if (req.headers.host !== new URL(origin).host || (req.headers.origin && req.headers.origin !== origin)
      || (req.method !== 'GET' && req.headers.origin !== origin)) return json(403, { error: 'Local origin required' });
    try {
      const pathname = new URL(req.url, origin).pathname;
      const media = pathname.match(/^\/api\/media\/([a-f0-9-]+)\.(mp4|jpg)$/);
      if (req.method === 'GET' && media) {
        const file = mediaPath(options.directory, media[1], media[2]);
        const { size } = await stat(file);
        let start = 0, end = size - 1;
        if (req.headers.range) {
          const range = req.headers.range.match(/^bytes=(\d*)-(\d*)$/);
          if (!range || !range[1] && !range[2]) return res.writeHead(416, { 'Content-Range': `bytes */${size}` }).end();
          start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
          end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
          if (start > end || start >= size) return res.writeHead(416, { 'Content-Range': `bytes */${size}` }).end();
        }
        res.writeHead(req.headers.range ? 206 : 200, { 'Content-Type': media[2] === 'mp4' ? 'video/mp4' : 'image/jpeg', 'Accept-Ranges': 'bytes', 'Content-Length': end - start + 1, ...(req.headers.range ? { 'Content-Range': `bytes ${start}-${end}/${size}` } : {}) });
        await pipeline(createReadStream(file, { start, end }), res); return;
      }
      if (req.method === 'POST' && pathname === '/api/upload') {
        if (!req.headers['content-type']?.startsWith('video/')) return json(415, { error: 'Video upload required' });
        const id = randomUUID(), file = mediaPath(options.directory, id, 'upload');
        await mkdir(join(options.directory, 'media'), { recursive: true });
        try { await pipeline(req, createWriteStream(file, { flags: 'wx' })); }
        catch { await rm(file, { force: true }); throw new Error('Upload interrupted'); }
        const name = new URL(req.url, origin).searchParams.get('name') || 'Uploaded video';
        const run = await app.importUpload({ id, name }); run.finished.catch(() => {});
        return json(202, { id: run.id });
      }
      if (req.method === 'GET' && Object.hasOwn(files, pathname)) {
        const [name, type] = files[pathname];
        res.writeHead(200, { 'Content-Type': `${type}; charset=utf-8` });
        return res.end(await readFile(new URL(`./ui/${name}`, import.meta.url)));
      }
      if (req.method === 'GET' && pathname === '/api/context') return json(200, { context: await app.getContext(), taxonomy, scoreRubrics });
      if (req.method === 'GET' && pathname === '/api/library') return json(200, await archive.list());
      if (req.method === 'GET' && pathname === '/api/strategy') return json(200, planner.list());
      if (req.method === 'GET' && pathname === '/api/cloud') {
        if (!options.env.MARKETING_D1_DATABASE_ID) return json(200, { status: 'local-only' });
        try { return json(200, JSON.parse(await readFile(join(options.directory, '.cloud-sync.json'), 'utf8'))); }
        catch (error) { if (error.code !== 'ENOENT') throw error; return json(200, { status: 'pending' }); }
      }
      if (req.method === 'GET' && pathname === '/api/runs') return json(200, await app.list());
      const report = pathname.match(/^\/api\/runs\/([a-f0-9-]+)\/report$/);
      if (req.method === 'GET' && report) return json(200, evaluate(app.get(report[1])));
      const events = pathname.match(/^\/api\/events\/([a-f0-9-]+)$/);
      if (req.method === 'GET' && events) {
        const initial = await app.get(events[1]);
        res.writeHead(200, { 'Content-Type': 'text/event-stream', Connection: 'keep-alive' });
        const send = run => {
          res.write(`data: ${JSON.stringify(run)}\n\n`);
          if (run.status !== 'running') res.end();
        };
        const unsubscribe = app.subscribe(events[1], send);
        res.once('close', unsubscribe);
        send(initial);
        return;
      }
      if (req.method !== 'POST') return json(404, { error: 'Not found' });
      if (req.headers['content-type']?.split(';')[0] !== 'application/json') return json(415, { error: 'JSON required' });
      let raw = ''; for await (const chunk of req) raw += chunk;
      let body; try { body = JSON.parse(raw); } catch { return json(400, { error: 'Invalid JSON' }); }
      const brief = pathname.match(/^\/api\/strategy\/([a-f0-9-]+)\/(review|outcomes)$/);
      if (pathname === '/api/strategy/generate' || brief) {
        const controller = new AbortController(); libraryJobs.add(controller);
        res.once('close', () => controller.abort());
        try {
          const input = { ...body, signal: controller.signal };
          const result = pathname === '/api/strategy/generate' ? await planner.generate(input)
            : brief[2] === 'review' ? await planner.review(brief[1], input) : planner.outcome(brief[1], input);
          await syncIfConfigured(options);
          return json(200, result);
        } finally { libraryJobs.delete(controller); }
      }
      if (pathname === '/api/library/index' || pathname === '/api/library/search') {
        const controller = new AbortController(); libraryJobs.add(controller);
        res.once('close', () => controller.abort());
        try { return json(200, await archive[pathname.endsWith('/index') ? 'index' : 'search']({ ...body, signal: controller.signal })); }
        finally { libraryJobs.delete(controller); }
      }
      if (pathname === '/api/context') { await app.setContext(body.context); return json(200, { saved: true }); }
      if (pathname === '/api/runs') { const run = await app.start(body); run.finished.catch(() => {}); return json(202, { id: run.id }); }
      if (pathname === '/api/import') { const run = await app.importSource(body); run.finished.catch(() => {}); return json(202, { id: run.id }); }
      const action = pathname.match(/^\/api\/runs\/([a-f0-9-]+)\/(resume|cancel|correct|reconcile)$/);
      if (!action) return json(404, { error: 'Not found' });
      if (action[2] === 'resume') { const run = await app.resume(action[1]); run.finished.catch(() => {}); return json(202, { id: run.id }); }
      if (action[2] === 'cancel') return json(200, await app.cancel(action[1]));
      if (action[2] === 'reconcile') return json(200, await app.reconcile(action[1], body));
      return json(200, await app.correct(action[1], body));
    } catch (error) {
      if (res.headersSent) return res.end();
      json(error.code === 'ENOENT' ? 404 : 400, { error: error.message });
    }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  origin = `http://127.0.0.1:${server.address().port}`;
  return { server, url: origin, close: async () => {
    libraryJobs.forEach(controller => controller.abort());
    server.closeAllConnections();
    const closed = new Promise(resolve => server.close(resolve));
    await app.shutdown(); await closed;
  } };
}
