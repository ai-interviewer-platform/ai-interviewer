const el = id => document.getElementById(id);
let current, stream, taxonomy, historyVersion = 0;
async function api(path, body) {
  const response = await fetch(path, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const result = await response.json(); if (!response.ok) throw new Error(result.error); return result;
}
function node(tag, text) { const result = document.createElement(tag); result.textContent = text; return result; }
function action(text, callback) {
  const button = node('button', text); button.type = 'button';
  button.onclick = async () => { button.disabled = true; try { await callback(); } catch (error) { el('message').textContent = error.message; } finally { button.disabled = false; } };
  return button;
}
function inspect(run) {
  stream?.close();
  stream = new EventSource(`/api/events/${run.id}`);
  stream.onmessage = event => { current = JSON.parse(event.data); render(); if (current.status !== 'running') { stream.close(); void history(); } };
  stream.onerror = () => { stream.close(); el('message').textContent = 'Connection ended. Reopen the run to inspect saved progress.'; };
}
async function history() {
  const version = ++historyVersion;
  const runs = await api('/api/runs');
  if (version !== historyVersion) return;
  const rows = runs.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(run => {
    const row = node('p', `${run.status} · ${run.query} `);
    row.append(action('Inspect', () => inspect(run))); return row;
  });
  el('history').replaceChildren(...rows);
}
function label(source, field) { return source.corrections?.findLast(item => item.field === field)?.choice ?? source.classification?.answers[field]?.choice ?? 'unknown'; }
function render() {
  if (!current) return;
  el('message').textContent = `${current.status} · ${current.stage ?? 'stopped'} · requested ${current.numResults} sources · ${current.error ?? ''}`;
  el('results').replaceChildren();
  const controls = node('div', ''); controls.className = 'row';
  controls.append(action('Cancel run', async () => { current = await api(`/api/runs/${current.id}/cancel`, {}); render(); }));
  controls.append(action('Resume failed stages', async () => { await api(`/api/runs/${current.id}/resume`, {}); inspect(current); }));
  controls.append(action('Export run JSON', () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(current, null, 2)], { type: 'application/json' }));
    const link = node('a', ''); link.href = url; link.download = `${current.id}.json`; link.click(); URL.revokeObjectURL(url);
  }));
  el('results').append(controls);
  const sort = el('sort').value;
  const sources = [...current.sources].filter(source => !el('filter').value || label(source, 'hook') === el('filter').value)
    .sort((a, b) => String(sort === 'hook' ? label(a, 'hook') : a[sort] ?? '').localeCompare(String(sort === 'hook' ? label(b, 'hook') : b[sort] ?? '')));
  for (const source of sources) {
    const card = node('article', ''); card.className = 'card';
    card.append(node('h3', source.title), node('p', `${source.status ?? 'pending'} · ${source.evidence?.coverage ?? 'media unverified'} · ${source.error ?? ''}`));
    if (source.url) { const link = node('a', 'Open original source'); link.href = source.url; link.target = '_blank'; link.rel = 'noopener noreferrer'; card.append(link); }
    card.append(node('p', Object.keys(taxonomy).map(field => `${field}: ${label(source, field)}`).join(' · ')));
    const details = node('details', ''); details.append(node('summary', 'Evidence, provenance, usage & correction history'), node('pre', JSON.stringify(source, null, 2))); card.append(details);
    if (source.jevAttempted && !source.jevRunId && current.status !== 'running') {
      const form = node('form', '');
      const input = document.createElement('input'); input.required = true; input.setAttribute('aria-label', 'Monid run ID'); input.placeholder = 'Run ID from Monid history';
      form.append(input, node('button', 'Attach existing Jev run'));
      form.onsubmit = async event => { event.preventDefault(); try { current = await api(`/api/runs/${current.id}/reconcile`, { sourceId: source.id, runId: input.value }); render(); } catch (error) { el('message').textContent = error.message; } };
      card.append(form);
    }
    if (source.classification && current.status !== 'running') {
      const form = node('form', '');
      const field = document.createElement('select'), choice = document.createElement('select');
      field.setAttribute('aria-label', 'Judgment field'); choice.setAttribute('aria-label', 'Corrected label');
      Object.keys(taxonomy).forEach(key => field.add(new Option(key, key)));
      const choices = () => choice.replaceChildren(...taxonomy[field.value].map(value => new Option(value, value))); field.onchange = choices; choices();
      const reviewer = document.createElement('input'); reviewer.placeholder = 'Reviewer'; reviewer.setAttribute('aria-label', 'Reviewer'); reviewer.required = true;
      const reason = document.createElement('input'); reason.placeholder = 'Reference evidence / rationale'; reason.setAttribute('aria-label', 'Correction rationale'); reason.required = true;
      const submit = node('button', 'Save human judgment'); form.append(field, choice, reviewer, reason, submit);
      form.onsubmit = async event => { event.preventDefault(); try { current = await api(`/api/runs/${current.id}/correct`, { sourceId: source.id, field: field.value, choice: choice.value, reviewer: reviewer.value, reason: reason.value }); render(); } catch (error) { el('message').textContent = error.message; } };
      card.append(form);
    }
    el('results').append(card);
  }
}
el('sort').onchange = render; el('filter').onchange = render;
el('import').onsubmit = async event => {
  event.preventDefault(); event.submitter.disabled = true;
  try { inspect(await api('/api/import', { url: el('source-url').value, kind: el('source-kind').value })); await history(); }
  catch (error) { el('message').textContent = error.message; }
  finally { event.submitter.disabled = false; }
};
el('search').onsubmit = async event => {
  event.preventDefault(); const button = event.submitter; button.disabled = true;
  try {
    await api('/api/context', { context: el('context').value });
    const run = await api('/api/runs', { query: el('query').value, numResults: Number(el('count').value) });
    inspect(run); await history();
  } catch (error) { el('message').textContent = error.message; } finally { button.disabled = false; }
};
try { const config = await api('/api/context'); el('context').value = config.context; taxonomy = config.taxonomy; taxonomy.hook.forEach(value => el('filter').add(new Option(value, value))); await history(); }
catch (error) { el('message').textContent = error.message; }
