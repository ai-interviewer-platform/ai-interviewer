import { bugStatuses, bugSurfaces, diagnosticLabels } from './bug-report-contract.js';
import { feedbackCategories, feedbackQuestions, feedbackStatuses, pageFeature } from './feedback-questions.js';
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

const option = (value, selected, label = value) => `<option value="${esc(value)}"${value === selected ? ' selected' : ''}>${esc(label)}</option>`;
const select = (id, name, label, values, selected, any) => `<label for="${id}">${label}</label><select id="${id}" name="${name}">${any ? option('', selected, any) : ''}${values.map(value => option(value, selected)).join('')}</select>`;

function feedbackMarkup(records) {
  if (!records.length) return '<p>No feedback matches these filters.</p>';
  return records.map((record, index) => `<form class="triage-record setup-form" data-id="${esc(record.id)}"><p class="small muted">${esc(record.created_at)} · ${esc(record.surface)} · ${esc(record.activity)} · ${esc(record.question_id)} v${esc(record.question_version)}</p>
    <p><strong>${record.answer === null ? 'No answer chosen' : esc(feedbackQuestions[record.feature]?.version === record.question_version ? feedbackQuestions[record.feature].answers[record.answer] : record.answer)}</strong></p>${record.response_text ? `<blockquote>${esc(record.response_text)}</blockquote>` : ''}
    ${select(`feedback-${index}-category`, 'category', 'Category', feedbackCategories, record.category, 'Not categorized')}${select(`feedback-${index}-status`, 'status', 'Status', feedbackStatuses, record.status)}
    <label for="feedback-${index}-resolution">Resolution</label><textarea id="feedback-${index}-resolution" name="resolution" rows="2">${esc(record.resolution ?? '')}</textarea>
    <div class="actions"><button class="button secondary small" type="submit">Save triage</button><p role="status"></p></div></form>`).join('');
}

function bugMarkup(records) {
  if (!records.length) return '<p>No bug reports match these filters.</p>';
  return records.map((record, index) => `<form class="triage-record setup-form" data-id="${esc(record.id)}"><p class="small muted"><strong>${esc(record.reference)}</strong> · ${esc(record.created_at)} · ${esc(record.surface)} · ${esc(record.activity)}</p>
    <dl><dt>Expected</dt><dd>${esc(record.expected)}</dd><dt>Actual</dt><dd>${esc(record.actual)}</dd>${record.steps ? `<dt>Steps</dt><dd>${esc(record.steps)}</dd>` : ''}
      ${Object.entries(record.diagnostics).map(([key, value]) => `<dt>${esc(diagnosticLabels[key] ?? key)}</dt><dd>${esc(Array.isArray(value) ? value.join(', ') || 'none' : value)}</dd>`).join('')}
      <dt>Reply</dt><dd>${record.contact_email ? `${esc(record.contact_email)} (${esc(record.contact_purpose)}) <button class="button quiet small" type="button" data-erase-contact>Erase reply address</button>` : 'No reply address'}</dd></dl>
    ${select(`bug-${index}-status`, 'status', 'Status', bugStatuses, record.status)}
    <label for="bug-${index}-investigation">Investigation</label><textarea id="bug-${index}-investigation" name="investigation" rows="2">${esc(record.investigation ?? '')}</textarea>
    <label for="bug-${index}-resolution">Resolution</label><textarea id="bug-${index}-resolution" name="resolution" rows="2">${esc(record.resolution ?? '')}</textarea>
    <div class="actions"><button class="button secondary small" type="submit">Save triage</button><p role="status"></p></div></form>`).join('');
}

// One triage section: filters that load records, and a form per record that saves its triage.
function mountTriage(root, id, path, markup, payload) {
  root.querySelector(`#${id}-filter-form`).addEventListener('submit', async event => {
    event.preventDefault();
    const status = root.querySelector(`#${id}-load-message`);
    try {
      const { records } = await operatorFetch(`${path}?${new URLSearchParams(new FormData(event.target))}`);
      root.querySelector(`#${id}-records`).innerHTML = markup(records);
      status.textContent = `${records.length} records loaded.`;
    } catch (error) { status.textContent = error.message; }
  });
  root.querySelector(`#${id}-records`).addEventListener('submit', async event => {
    event.preventDefault();
    const form = event.target;
    const status = form.querySelector('[role=status]');
    try {
      await operatorFetch(path, { id: form.dataset.id, ...payload(form.elements) });
      status.textContent = 'Saved.';
    } catch (error) { status.textContent = error.message; }
  });
}
const triageSection = (id, heading, filters, action) => `<section class="operator-triage" aria-labelledby="${id}-triage-heading"><h2 id="${id}-triage-heading">${heading}</h2>
    <form id="${id}-filter-form" class="setup-form operator-form">${filters}<button class="button primary" type="submit">${action}</button><p id="${id}-load-message" role="status"></p></form>
    <div id="${id}-records"></div></section>`;

const operatorFetch = async (path, body) => {
  const response = await fetch(path, { headers: { authorization: `Bearer ${view.token}`, ...(body ? { 'content-type': 'application/json' } : {}) }, ...(body ? { method: 'POST', body: JSON.stringify(body) } : {}) });
  const data = await response.json();
  if (!response.ok) throw Error(data.error || 'The request failed.');
  return data;
};

export function operatorScreen() {
  return `<div class="page-title"><div><p class="eyebrow">Private operator</p><h1>Operator reports</h1><p>Reports and triage load only with the private operator token. The token stays in this tab’s memory.</p></div></div>
  <div id="operator"><div class="setup-form operator-form"><label for="operator-token">Operator token</label><input id="operator-token" type="password" autocomplete="off" value="${esc(view.token)}"></div>
  <form id="operator-form" class="setup-form operator-form"><h2>Measurement report</h2>
    <label for="operator-start">Window start</label><input id="operator-start" type="datetime-local" required value="${esc(view.start)}">
    <label for="operator-end">Window end</label><input id="operator-end" type="datetime-local" required value="${esc(view.end)}">
    <p class="small muted">Times use this browser’s time zone. Choose the window explicitly; there is no default.</p>
    <button class="button primary" type="submit">Load report</button><p id="operator-status" role="status"></p></form>
  <div id="operator-report">${view.report ? reportMarkup(view.report) : ''}</div>
  ${triageSection('feedback', 'Feedback triage', `${select('feedback-filter-status', 'status', 'Feedback status', feedbackStatuses, '', 'Any status')}${select('feedback-filter-feature', 'feature', 'Feedback feature', Object.keys(feedbackQuestions), '', 'Any feature')}${select('feedback-filter-surface', 'surface', 'Feedback page', Object.keys(pageFeature), '', 'Any page')}`, 'Load feedback')}
  ${triageSection('bug', 'Bug report triage', `${select('bug-filter-status', 'status', 'Bug status', bugStatuses, '', 'Any status')}${select('bug-filter-surface', 'surface', 'Bug page', bugSurfaces, '', 'Any page')}${select('bug-filter-feature', 'feature', 'Bug feature', [...new Set(Object.values(pageFeature)), 'other'], '', 'Any feature')}`, 'Load bug reports')}</div>`;
}

export function mountOperator(root) {
  root.querySelector('#operator-token').addEventListener('input', event => { view.token = event.target.value; });
  mountTriage(root, 'feedback', '/api/feedback/records', feedbackMarkup, fields => ({ category: fields.category.value || null, status: fields.status.value, resolution: fields.resolution.value }));
  mountTriage(root, 'bug', '/api/bug-reports/records', bugMarkup, fields => ({ status: fields.status.value, investigation: fields.investigation.value, resolution: fields.resolution.value }));
  root.querySelector('#bug-records').addEventListener('click', async event => {
    const button = event.target.closest('[data-erase-contact]');
    if (!button) return;
    const status = button.closest('form').querySelector('[role=status]');
    try {
      await operatorFetch('/api/bug-reports/records', { action: 'erase-contact', id: button.closest('form').dataset.id });
      button.parentElement.textContent = 'No reply address';
      status.textContent = 'Reply address erased.';
    } catch (error) { status.textContent = error.message; }
  });
  root.querySelector('#operator-form').addEventListener('submit', async event => {
    event.preventDefault();
    const status = root.querySelector('#operator-status');
    view.start = root.querySelector('#operator-start').value;
    view.end = root.querySelector('#operator-end').value;
    status.textContent = 'Loading…';
    try {
      const query = new URLSearchParams({ start: new Date(view.start).toISOString(), end: new Date(view.end).toISOString() });
      const data = await operatorFetch(`/api/measure/report?${query}`);
      view.report = data;
      root.querySelector('#operator-report').innerHTML = reportMarkup(data);
      status.textContent = 'Report loaded.';
    } catch (error) { status.textContent = error instanceof RangeError ? 'Choose a valid start and end.' : error.message; }
  });
}
