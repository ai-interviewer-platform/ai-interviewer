import { heatGridSize } from './measurement-contract.js';

// Private operator views. Data loads only with the operator token, which stays in this tab's memory.
const esc = value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
const view = { token: '', start: '', end: '', report: null };

const table = (caption, columns, rows) => `<table class="operator-table"><caption>${esc(caption)}</caption><thead><tr>${columns.map(([, label]) => `<th scope="col">${esc(label)}</th>`).join('')}</tr></thead><tbody>${rows.length ? rows.map(row => `<tr>${columns.map(([key]) => `<td>${esc(row[key])}</td>`).join('')}</tr>`).join('') : `<tr><td colspan="${columns.length}">No records in this window.</td></tr>`}</tbody></table>`;

function heatmap(cells) {
  const viewports = [...new Set(cells.map(cell => cell.viewport))];
  if (!viewports.length) return '<p>No landing clicks in this window.</p>';
  return viewports.map(viewport => {
    const counts = new Map();
    for (const cell of cells.filter(item => item.viewport === viewport)) counts.set(`${cell.x}:${cell.y}`, (counts.get(`${cell.x}:${cell.y}`) ?? 0) + cell.clicks);
    const most = Math.max(...counts.values());
    const grid = Array.from({ length: heatGridSize ** 2 }, (_, index) => {
      const clicks = counts.get(`${index % heatGridSize}:${Math.floor(index / heatGridSize)}`);
      return clicks ? `<span class="heat-cell" data-clicks="${clicks}" style="--heat:${(clicks / most).toFixed(2)}" title="${clicks} clicks"></span>` : '<span class="heat-cell"></span>';
    }).join('');
    const total = [...counts.values()].reduce((sum, clicks) => sum + clicks, 0);
    return `<figure class="heat-figure"><div class="heat-grid" style="--grid:${heatGridSize}" role="img" aria-label="${esc(viewport)} viewport: ${total} clicks across ${counts.size} cells of a ${heatGridSize} by ${heatGridSize} grid over the landing page">${grid}</div><figcaption>${esc(viewport)} viewport · ${total} clicks. The top row is the top of the landing page.</figcaption></figure>`;
  }).join('') + table('Clicks by landing zone', [['viewport', 'Viewport'], ['zone', 'Zone'], ['clicks', 'Clicks']], Object.values(cells.reduce((zones, cell) => {
    const key = `${cell.viewport}:${cell.zone}`;
    zones[key] ??= { viewport: cell.viewport, zone: cell.zone, clicks: 0 };
    zones[key].clicks += cell.clicks;
    return zones;
  }, {})));
}

function reportMarkup(report) {
  return `<h2>Landing funnel</h2><p>${report.landing.documents} landing documents in ${esc(report.window.start)} – ${esc(report.window.end)} (${esc(report.window.clock)}). Each step counts landing documents that reached it after landing; that count is the denominator. ${report.landing.unattributedDocuments} other documents sent events without a landing exposure (attribution unknown).</p>
    ${table('Landing document steps', [['name', 'Step'], ['activity', 'Activity'], ['action', 'Action'], ['documents', 'Documents']], report.landing.steps)}
    <h2>Personal practice cohort</h2><p>Persisted personal Attempts started in the window, observed until its end. Open Attempts are incomplete, not failed. Retried counts reviewed Attempts with at least one Retry.</p>
    ${table('Server cohort', [['started', 'Started'], ['completed', 'Completed'], ['openAtEnd', 'Open at end'], ['reviewsReady', 'Reviews ready'], ['reviewedRetried', 'Reviewed and retried']], [report.personalCohort])}
    ${table('Waitlist outcomes', [['joined', 'Joined'], ['withdrawn', 'Withdrawn']], [report.waitlist])}
    <h2>Landing heatmap</h2>${heatmap(report.heatmap)}
    <h2>All events</h2>${table('Events by name and surface', [['name', 'Event'], ['surface', 'Surface'], ['activity', 'Activity'], ['action', 'Action'], ['authority', 'Authority'], ['events', 'Events'], ['documents', 'Documents'], ['duplicates', 'Duplicates'], ['withoutDocument', 'Without document']], report.events)}
    <h2>Limitations</h2><ul>${report.limitations.map(line => `<li>${esc(line)}</li>`).join('')}</ul>`;
}

export function operatorScreen() {
  return `<div class="page-title"><div><p class="eyebrow">Private operator</p><h1>Operator reports</h1><p>Reports load only with the private operator token. The token stays in this tab’s memory.</p></div></div>
  <div id="operator"><form id="operator-form" class="setup-form operator-form"><label for="operator-token">Operator token</label><input id="operator-token" type="password" autocomplete="off" required value="${esc(view.token)}">
    <label for="operator-start">Window start</label><input id="operator-start" type="datetime-local" required value="${esc(view.start)}">
    <label for="operator-end">Window end</label><input id="operator-end" type="datetime-local" required value="${esc(view.end)}">
    <p class="small muted">Times use this browser’s time zone. Choose the window explicitly; there is no default.</p>
    <button class="button primary" type="submit">Load report</button><p id="operator-status" role="status"></p></form>
  <div id="operator-report">${view.report ? reportMarkup(view.report) : ''}</div></div>`;
}

export function mountOperator(root) {
  root.querySelector('#operator-form').addEventListener('submit', async event => {
    event.preventDefault();
    const status = root.querySelector('#operator-status');
    view.token = root.querySelector('#operator-token').value;
    view.start = root.querySelector('#operator-start').value;
    view.end = root.querySelector('#operator-end').value;
    status.textContent = 'Loading…';
    try {
      const query = new URLSearchParams({ start: new Date(view.start).toISOString(), end: new Date(view.end).toISOString() });
      const response = await fetch(`/api/measure/report?${query}`, { headers: { authorization: `Bearer ${view.token}` } });
      const data = await response.json();
      if (!response.ok) throw Error(data.error || 'The report could not load.');
      view.report = data;
      root.querySelector('#operator-report').innerHTML = reportMarkup(data);
      status.textContent = 'Report loaded.';
    } catch (error) { status.textContent = error instanceof RangeError ? 'Choose a valid start and end.' : error.message; }
  });
}
