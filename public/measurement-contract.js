// The measurement allowlist, shared by the browser (public/measurement.js) and the server
// (src/measurement.ts), which checks it again because the browser is not trusted.
export const eventNames = ['landing_exposed', 'cta_selected', 'landing_click', 'page_viewed', 'waitlist_request_accepted', 'waitlist_withdrawal_accepted', 'practice_started', 'practice_completed', 'review_opened', 'retry_started', 'experiment_exposed'];
// Events that can be an experiment outcome: everything a landing document does after it lands.
export const outcomeNames = eventNames.filter(name => !['landing_exposed', 'landing_click', 'page_viewed', 'experiment_exposed'].includes(name));
// Why an `experiment_exposed` document is or is not counted in the comparison.
export const eligibilities = ['eligible', 'automation', 'internal'];
// Every rendered page and its activity. A new page is added here only.
export const pageActivity = { landing: 'none', welcome: 'sample', roadmap: 'sample', sessions: 'sample', sample: 'sample', interview: 'sample', review: 'sample', retry: 'sample', complete: 'sample', related: 'sample', preferences: 'sample', system: 'sample', 'demo-profile': 'sample', terms: 'none', privacy: 'none', cookies: 'none', personal: 'personal' };
export const activities = ['none', 'sample', 'personal'];
export const actions = ['none', 'sample', 'waitlist', 'personal_practice'];
export const authorities = ['client', 'server'];
// The landing heatmap: `data-heat-zone` values and a square grid of `heatGridSize` cells per side.
export const heatZones = ['hero', 'sample-evidence', 'loop', 'fit', 'waitlist', 'other'];
export const heatGridSize = 20;
export const viewports = ['narrow', 'wide'];
// Events held in the browser while the server decides whether measurement is on.
export const queueLimit = 50;
