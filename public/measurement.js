// Shared, opt-in adapter seam. No transport, cookies, identity or tracking storage.
let adapter;
const names = new Set(['landing_exposed', 'cta_selected', 'waitlist_request_accepted', 'waitlist_withdrawal_accepted', 'practice_started', 'practice_completed', 'review_opened', 'retry_started']);
export function setMeasurementAdapter(value) { adapter = typeof value === 'function' ? value : undefined; }
export function measure(name, { surface = 'landing', activity = 'none', action = 'none', authority = 'client', exposureId = null } = {}) {
  if (!names.has(name)) return;
  const event = {
    version: 'coursay-outcomes-v1', id: crypto.randomUUID(), name, occurredAt: new Date().toISOString(),
    surface: ['landing', 'sample', 'personal'].includes(surface) ? surface : 'unknown',
    activity: ['none', 'sample', 'personal'].includes(activity) ? activity : 'none',
    action: ['none', 'sample', 'waitlist', 'personal_practice'].includes(action) ? action : 'none',
    authority: authority === 'server' ? 'server' : 'client', attribution: 'unknown',
    exposureId: typeof exposureId === 'string' && /^[a-f\d-]+$/i.test(exposureId) ? exposureId : null,
  };
  try { Promise.resolve(adapter?.(event)).catch(() => {}); } catch { /* Measurement never gates product work. */ }
}
