import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { research } from './research.mjs';
import { taxonomy } from './research-providers.mjs';

export async function serve(options) {
  const app = research(options);
  let origin;
  const files = { '/': ['index.html', 'text/html'], '/app.js': ['app.js', 'text/javascript'], '/style.css': ['style.css', 'text/css'] };
  const server = createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    const json = (status, value) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(value)); };
    if (req.headers.host !== new URL(origin).host || (req.headers.origin && req.headers.origin !== origin)
      || (req.method !== 'GET' && req.headers.origin !== origin)) return json(403, { error: 'Local origin required' });
    try {
      const pathname = new URL(req.url, origin).pathname;
      if (req.method === 'GET' && Object.hasOwn(files, pathname)) {
        const [name, type] = files[pathname];
        res.writeHead(200, { 'Content-Type': `${type}; charset=utf-8` });
        return res.end(await readFile(new URL(`./ui/${name}`, import.meta.url)));
      }
      if (req.method === 'GET' && pathname === '/api/context') return json(200, { context: await app.getContext(), taxonomy });
      if (req.method === 'GET' && pathname === '/api/runs') return json(200, await app.list());
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
    server.closeAllConnections();
    const closed = new Promise(resolve => server.close(resolve));
    await app.shutdown(); await closed;
  } };
}
