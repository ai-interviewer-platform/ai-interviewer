// Bug reports (#22), shared by the browser (public/support.js, public/operator.js) and the server (src/bug-reports.ts).
import { pageActivity } from './measurement-contract.js';

export const operatorContact = 'jack.cao@utdallas.edu';
// Every app page, plus `other` for a page outside the app (for example a broken route).
export const bugSurfaces = [...Object.keys(pageActivity), 'other'];
export const bugStatuses = ['new', 'investigating', 'fixed', 'cannot_reproduce', 'declined'];
// Closing a report needs a recorded resolution and erases its reply address.
export const closedBugStatuses = ['fixed', 'cannot_reproduce', 'declined'];
export const bugTextLimit = 4000;
export const bugContactPurpose = 'Jack Cao may email this address only about this report. The address is erased when the report is closed.';
// The only diagnostics a report can carry. Each is shown before submission; nothing else is sent.
export const diagnosticValues = {
  browser: ['Edge', 'Chrome', 'Firefox', 'Safari', 'Other'],
  os: ['Windows', 'macOS', 'iOS', 'Android', 'ChromeOS', 'Linux', 'Other'],
  viewport: ['narrow', 'wide'],
  // Error names only: never messages, stacks, file names or logs.
  errors: ['Error', 'TypeError', 'ReferenceError', 'SyntaxError', 'RangeError', 'UnhandledRejection', 'ResourceLoadError'],
};
export const diagnosticErrorLimit = 5;
export const diagnosticLabels = { browser: 'Browser', os: 'Operating system', viewport: 'Viewport', viewportWidth: 'Viewport width', online: 'Online', errors: 'Recent errors' };
// Report text is free text, so anything shaped like a key, token or password assignment is
// replaced before it is stored.
export const secretPattern = /\b(?:sk|pk|rk|ghp|gho|ghs|xox[abpr])[-_][A-Za-z0-9_-]{8,}|\bBearer\s+[^\s]+|\b(?:password|passwd|secret|token|api[_-]?key)\s*[:=]\s*[^\s]+|\b[A-Za-z0-9+/_-]{32,}={0,2}(?![A-Za-z0-9])/gi;
