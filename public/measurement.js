import { actions, activities, eventNames, pageActivity, queueLimit } from './measurement-contract.js';

// Shared, opt-in adapter seam. No cookies, identity or browser storage.
// The first-party transport runs only when the server enables measurement and the
// browser sends neither Global Privacy Control nor Do Not Track.
let adapter;
// Random per page load: links the events of one document, never a person. A reload is a new document.
const documentExposureId = crypto.randomUUID();
export function setMeasurementAdapter(value) { adapter = typeof value === 'function' ? value : undefined; }
export function measure(name, { surface = 'landing', activity = 'none', action = 'none', authority = 'client', zone, cellX, cellY, viewport } = {}) {
  if (!eventNames.includes(name) || !Object.hasOwn(pageActivity, surface)) return;
  const event = {
    version: 'coursay-outcomes-v1', id: crypto.randomUUID(), name, surface,
    activity: activities.includes(activity) ? activity : 'none',
    action: actions.includes(action) ? action : 'none',
    authority: authority === 'server' ? 'server' : 'client', attribution: 'unknown',
    exposureId: documentExposureId,
    ...(name === 'landing_click' ? { zone, cellX, cellY, viewport } : {}),
  };
  try { Promise.resolve(adapter?.(event)).catch(() => {}); } catch { /* Measurement never gates product work. */ }
}
export function startFirstPartyMeasurement() {
  if (navigator.globalPrivacyControl === true || navigator.doNotTrack === '1') return;
  // Events wait for the server decision, then are sent or dropped.
  const queued = [];
  const queue = event => { if (queued.length < queueLimit) queued.push(event); };
  const send = event => fetch('/api/measure', { method: 'POST', keepalive: true, headers: { 'content-type': 'application/json' }, body: JSON.stringify(event) });
  adapter = queue;
  fetch('/api/site-config').then(response => response.json()).catch(() => null).then(config => {
    if (adapter !== queue) return;
    adapter = config?.measurementEnabled ? send : undefined;
    for (const event of queued) Promise.resolve(adapter?.(event)).catch(() => {});
  });
}
