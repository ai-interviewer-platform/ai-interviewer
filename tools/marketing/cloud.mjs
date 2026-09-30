import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const digest = data => createHash('sha256').update(data).digest('hex');
const schema = 'CREATE TABLE IF NOT EXISTS research_files (path TEXT PRIMARY KEY, sha256 TEXT NOT NULL, size INTEGER NOT NULL, payload TEXT, object_key TEXT, saved_at TEXT NOT NULL)';
let pending = Promise.resolve();

async function client({ env = process.env, fetch = globalThis.fetch }) {
  const account = env.MARKETING_CLOUDFLARE_ACCOUNT_ID, database = env.MARKETING_D1_DATABASE_ID, bucket = env.MARKETING_R2_BUCKET;
  if (![account, database, bucket].every(value => typeof value === 'string' && /^[a-zA-Z0-9_-]+$/.test(value))) throw new Error('Configure MARKETING_CLOUDFLARE_ACCOUNT_ID, MARKETING_D1_DATABASE_ID and MARKETING_R2_BUCKET');
  let token = env.CLOUDFLARE_API_TOKEN;
  if (!token && env.MARKETING_CLOUDFLARE_WRANGLER_AUTH === 'true') {
    // Capture credentials in memory; never inherit the child output or print it.
    const cli = fileURLToPath(new URL('../../node_modules/wrangler/bin/wrangler.js', import.meta.url));
    try {
      const { stdout } = await promisify(execFile)(process.execPath, [cli, 'auth', 'token', '--json'], { windowsHide: true });
      token = JSON.parse(stdout).token;
    } catch { throw new Error('Wrangler authentication unavailable; run npx wrangler login'); }
  }
  if (!token) throw new Error('Cloudflare API token or explicit Wrangler authentication required');
  const base = `https://api.cloudflare.com/client/v4/accounts/${account}`;
  const request = async (path, options = {}) => {
    const response = await fetch(`${base}${path}`, { ...options, headers: { Authorization: `Bearer ${token}`, ...options.headers }, redirect: 'error' });
    if (!response.ok) throw new Error(`Cloudflare archive HTTP ${response.status}`);
    return response;
  };
  return {
    async query(sql, params = []) {
      const response = await request(`/d1/database/${database}/query`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sql, params }) });
      const body = await response.json();
      if (!body.success || !body.result?.every(item => item.success)) throw new Error('Cloudflare database rejected archive query');
      return body.result.flatMap(item => item.results);
    },
    async put(key, bytes) {
      const response = await request(`/r2/buckets/${bucket}/objects/${key}`, { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream' }, body: bytes });
      if (!(await response.json()).success) throw new Error('Cloudflare media upload rejected');
    },
    async get(key) {
      if (!/^[a-f0-9]{64}$/.test(key)) throw new Error('Invalid cloud media key');
      return Buffer.from(await (await request(`/r2/buckets/${bucket}/objects/${key}`)).arrayBuffer());
    },
  };
}

async function inventory(directory, prefix = '') {
  let entries;
  try { entries = await readdir(directory, { withFileTypes: true }); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  const files = [];
  for (const entry of entries) {
    if (entry.name.startsWith('.') || entry.name.endsWith('.pending')) continue;
    const name = `${prefix}${entry.name}`, path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await inventory(path, `${name}/`));
    else if (entry.isFile() && /\.(json|txt|upload|mp4|jpg)$/.test(entry.name)) files.push({ name, path });
  }
  return files;
}

export function syncResearch(options) {
  // ponytail: serialize this process's archives; use cross-process locking if multiple writers share a corpus.
  const job = pending.catch(() => {}).then(() => sync(options));
  pending = job;
  return job;
}

async function sync({ directory, ...options }) {
  const api = await client(options);
  await api.query(schema);
  const existing = new Map((await api.query('SELECT path, sha256 FROM research_files')).map(row => [row.path, row.sha256]));
  const files = [...await inventory(directory), ...await inventory(join(dirname(directory), 'embeddings'), 'legacy-embeddings/')];
  let uploaded = 0, verified = 0, bytes = 0;
  for (const file of files) {
    const data = await readFile(file.path), hash = digest(data);
    bytes += data.length;
    if (existing.get(file.name) === hash) { verified++; continue; }
    const payload = /\.(json|txt)$/.test(file.name) ? data.toString('utf8') : null;
    const objectKey = payload === null ? hash : null;
    if (objectKey) {
      await api.put(objectKey, data);
      if (digest(await api.get(objectKey)) !== hash) throw new Error(`Cloud media verification failed: ${file.name}`);
    }
    await api.query('INSERT INTO research_files (path, sha256, size, payload, object_key, saved_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(path) DO UPDATE SET sha256=excluded.sha256, size=excluded.size, payload=excluded.payload, object_key=excluded.object_key, saved_at=excluded.saved_at', [file.name, hash, data.length, payload, objectKey, new Date().toISOString()]);
    const [saved] = await api.query('SELECT * FROM research_files WHERE path = ?', [file.name]);
    if (!saved || saved.sha256 !== hash || saved.size !== data.length || (payload !== null && digest(Buffer.from(saved.payload)) !== hash)) throw new Error(`Cloud record verification failed: ${file.name}`);
    uploaded++; verified++;
  }
  return { files: files.length, uploaded, verified, bytes, verifiedAt: new Date().toISOString() };
}

export async function restoreResearch({ directory, ...options }) {
  // Never overwrite an existing local corpus during recovery.
  try { if ((await readdir(directory)).length) throw new Error('Restore requires an empty destination'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const api = await client(options);
  const rows = await api.query('SELECT * FROM research_files');
  for (const row of rows) {
    const destination = resolve(directory, row.path);
    if (!destination.startsWith(resolve(directory) + sep)) throw new Error('Unsafe archive path');
    const bytes = row.payload === null ? await api.get(row.object_key) : Buffer.from(row.payload);
    if (digest(bytes) !== row.sha256 || bytes.length !== row.size) throw new Error(`Cloud restore verification failed: ${row.path}`);
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, bytes, { flag: 'wx' });
  }
  return { restored: rows.length };
}

export async function syncIfConfigured({ directory, env = process.env, ...options }) {
  if (!env.MARKETING_D1_DATABASE_ID) return null;
  let receipt;
  try { receipt = { status: 'saved', ...await syncResearch({ directory, env, ...options }) }; }
  catch (error) { receipt = { status: 'pending', error: error.message, attemptedAt: new Date().toISOString() }; }
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, '.cloud-sync.json'), JSON.stringify(receipt));
  return receipt;
}
