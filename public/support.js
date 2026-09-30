// Sitewide Feedback and Report a problem controls. They load separately from app.js, so they
// stay usable when a feature or the measurement service fails. They read only the page name
// from the URL.
import { bugContactPurpose, bugSurfaces, bugTextLimit, diagnosticErrorLimit, diagnosticLabels, diagnosticValues, operatorContact as contact } from './bug-report-contract.js';
import { pageActivity } from './measurement-contract.js';

const esc = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
const currentPage = () => location.hash.replace(/^#\/?/, '').split('?')[0] || 'landing';
const surfaceOf = page => (bugSurfaces.includes(page) ? page : 'other');

// Error names only, for bug-report diagnostics. Messages and stacks are never read.
const recentErrors = [];
const rememberError = name => { recentErrors.push(diagnosticValues.errors.includes(name) ? name : 'Error'); if (recentErrors.length > diagnosticErrorLimit) recentErrors.shift(); };
addEventListener('error', event => rememberError(event.target === window ? event.error?.name : 'ResourceLoadError'), true);
addEventListener('unhandledrejection', () => rememberError('UnhandledRejection'));

async function send(path, body) {
  let response;
  try { response = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); }
  catch { throw Error('The connection failed, so nothing was sent. Your text is still here; try again.'); }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(Error(data.error || 'The request could not be saved. Your text is still here; try again.'), { field: data.field });
  return data;
}

const dock = document.createElement('div');
dock.className = 'site-support';
dock.id = 'site-support';
dock.innerHTML = '<div class="support-panels"></div><div class="support-toggles"></div>';
document.body.append(dock);
const disclosures = [];

// A collapsed control that expands one panel. `render` fills the panel when it has no draft;
// `heading` names the panel for the page where its draft started.
function disclosure(id, label, { render, heading = () => label, available = () => true }) {
  dock.querySelector('.support-toggles').insertAdjacentHTML('beforeend', `<button type="button" class="button secondary support-toggle" id="${id}-toggle" aria-expanded="false" aria-controls="${id}-panel">${label}</button>`);
  dock.querySelector('.support-panels').insertAdjacentHTML('beforeend', `<section class="support-panel" id="${id}-panel" aria-labelledby="${id}-heading" hidden><h2 id="${id}-heading"></h2><div id="${id}-body"></div></section>`);
  const toggle = dock.querySelector(`#${id}-toggle`);
  const panel = dock.querySelector(`#${id}-panel`);
  const body = dock.querySelector(`#${id}-body`);
  // A draft has a choice or text. Collapsing or changing page keeps it; only Cancel discards it.
  const hasDraft = () => Boolean(body.querySelector('form input[type=radio]:checked') || [...body.querySelectorAll('form textarea, form input[type=email]')].some(field => field.value.trim()));
  const control = {
    toggle, panel, body, page: undefined,
    collapse() {
      if (panel.contains(document.activeElement)) toggle.focus();
      panel.hidden = true;
      toggle.setAttribute('aria-expanded', 'false');
    },
    expand() {
      for (const other of disclosures) if (other !== control) other.collapse();
      if (!hasDraft()) { control.page = currentPage(); render(control); }
      dock.querySelector(`#${id}-heading`).textContent = heading(control.page === currentPage());
      panel.hidden = false;
      toggle.setAttribute('aria-expanded', 'true');
      body.querySelector('input:not([type=checkbox]), textarea, [tabindex]')?.focus();
    },
  };
  toggle.addEventListener('click', () => (panel.hidden ? control.expand() : control.collapse()));
  panel.addEventListener('click', event => { if (event.target.closest('[data-support-cancel]')) { body.innerHTML = ''; control.collapse(); toggle.focus(); } });
  // An untouched form or a saved message belongs to its page. Pages where the control does not apply hide it.
  const sync = () => {
    toggle.hidden = !available(currentPage());
    if (currentPage() !== control.page && !hasDraft()) { body.innerHTML = ''; control.collapse(); }
    if (toggle.hidden) control.collapse();
  };
  addEventListener('hashchange', sync);
  sync();
  disclosures.push(control);
  return control;
}
dock.addEventListener('keydown', event => {
  const open = disclosures.find(item => !item.panel.hidden);
  if (event.key === 'Escape' && open) { open.collapse(); open.toggle.focus(); }
});

function mountFeedback({ feedbackTextLimit, questionFor }) {
  const feedback = disclosure('feedback', 'Feedback', {
    heading: samePage => (samePage ? 'Feedback on this page' : 'Feedback on the page where you started it'),
    available: page => Boolean(questionFor(page)),
    render({ body, page }) {
      const question = questionFor(page);
      body.innerHTML = `<form id="feedback-form" novalidate><fieldset><legend>${esc(question.question)}</legend>${Object.entries(question.answers).map(([value, label]) => `<label class="support-choice"><input type="radio" name="answer" value="${esc(value)}"><span>${esc(label)}</span></label>`).join('')}</fieldset>
        <label for="feedback-text">Anything to add? <span class="muted">Optional</span></label><textarea id="feedback-text" rows="3" maxlength="${feedbackTextLimit}" aria-describedby="feedback-hint"></textarea>
        <p class="small muted" id="feedback-hint">Do not include code, transcripts, passwords or contact details. Feedback is anonymous and no reply is sent.${question.feature === 'review' ? ' This does not change a finding. To dispute a review finding, use “Disagree with this feedback” on the finding.' : ''}</p>
        <p id="feedback-error" role="alert"></p><div class="actions"><button class="button primary small" type="submit">Send feedback</button><button class="button quiet small" type="button" data-support-cancel>Cancel</button></div></form>`;
    },
  });
  feedback.panel.addEventListener('submit', async event => {
    event.preventDefault();
    const form = event.target;
    const error = form.querySelector('#feedback-error');
    const answer = form.querySelector('input[name=answer]:checked')?.value ?? null;
    const text = form.querySelector('#feedback-text').value;
    error.textContent = '';
    if (!answer && !text.trim()) { error.textContent = 'Choose an answer or add a comment.'; form.querySelector('input').focus(); return; }
    const button = form.querySelector('[type=submit]');
    button.disabled = true; button.textContent = 'Sending…'; form.setAttribute('aria-busy', 'true');
    try {
      const question = questionFor(feedback.page);
      await send('/api/feedback', { questionId: question.id, questionVersion: question.version, surface: feedback.page, answer, text });
      feedback.body.innerHTML = '<p role="status" tabindex="-1">Thank you. Your feedback was saved.</p>';
      feedback.body.querySelector('p').focus();
    } catch (failure) {
      error.textContent = failure.message;
      button.disabled = false; button.textContent = 'Send feedback'; form.removeAttribute('aria-busy');
    }
  });
}

// Allowlisted, coarse details only. A failure here sends fewer details and never blocks the report.
function diagnostics() {
  const found = {};
  try {
    const agent = navigator.userAgent;
    found.browser = /Edg\//.test(agent) ? 'Edge' : /Firefox\//.test(agent) ? 'Firefox' : /Chrome\/|CriOS\//.test(agent) ? 'Chrome' : /Safari\//.test(agent) ? 'Safari' : 'Other';
    found.os = /Windows/.test(agent) ? 'Windows' : /iPhone|iPad/.test(agent) ? 'iOS' : /Mac OS X/.test(agent) ? 'macOS' : /Android/.test(agent) ? 'Android' : /CrOS/.test(agent) ? 'ChromeOS' : /Linux/.test(agent) ? 'Linux' : 'Other';
    found.viewport = innerWidth < 768 ? 'narrow' : 'wide';
    found.viewportWidth = Math.round(innerWidth / 100) * 100;
    found.online = navigator.onLine;
    found.errors = [...recentErrors];
  } catch { /* Report without the remaining details. */ }
  return found;
}

function mountBugReports(config) {
  const fields = { expected: 'bug-expected', actual: 'bug-actual', steps: 'bug-steps', contactEmail: 'bug-contact', contactConsent: 'bug-consent' };
  let details;
  const bugs = disclosure('bug', 'Report a problem', { render({ body, page }) {
    if (config.enabled === false) {
      body.innerHTML = `<p tabindex="-1">Bug reports are not collected here yet. Email <a href="mailto:${contact}">${contact}</a> with what you expected and what happened.</p>`;
      return;
    }
    details = diagnostics();
    const surface = surfaceOf(page);
    const rows = [['Page', surface], ['Activity', pageActivity[surface] ?? 'none'], [diagnosticLabels.browser, details.browser], [diagnosticLabels.os, details.os], [diagnosticLabels.viewport, details.viewport && `${details.viewport}, about ${details.viewportWidth} px`], [diagnosticLabels.online, details.online === undefined ? undefined : details.online ? 'yes' : 'no'], [diagnosticLabels.errors, details.errors?.join(', ') || 'none']];
    const textarea = (name, label, optional) => `<label for="${fields[name]}">${label}${optional ? ' <span class="muted">Optional</span>' : ''}</label><textarea id="${fields[name]}" name="${name}" rows="2" maxlength="${bugTextLimit}" aria-describedby="${fields[name]}-error"></textarea><p class="field-error" id="${fields[name]}-error"></p>`;
    body.innerHTML = `<form id="bug-form" novalidate><p class="small" id="bug-hint">Reports are private: they are not posted publicly. Do not paste code, transcripts, passwords or keys; anything shaped like a key or token is removed.</p>
      ${textarea('expected', 'What did you expect?')}${textarea('actual', 'What happened instead?')}${textarea('steps', 'Steps to reproduce', true)}
      <fieldset><legend>Details sent with the report</legend><dl id="bug-diagnostics">${rows.filter(([, value]) => value !== undefined).map(([name, value]) => `<dt>${name}</dt><dd>${esc(value)}</dd>`).join('')}</dl>
        <label class="support-choice"><input type="checkbox" id="bug-include" checked><span>Include these details</span></label>
        <p class="small muted">These details never include code, transcripts, audio, error messages or logs.</p></fieldset>
      <label for="bug-contact">Reply address <span class="muted">Optional</span></label><input id="bug-contact" name="contactEmail" type="email" autocomplete="email" aria-describedby="bug-contact-error"><p class="field-error" id="bug-contact-error"></p>
      <label class="support-choice"><input type="checkbox" id="bug-consent" name="contactConsent" aria-describedby="bug-consent-error"><span>${esc(bugContactPurpose)}</span></label><p class="field-error" id="bug-consent-error"></p>
      <p id="bug-error" role="alert"></p><div class="actions"><button class="button primary small" type="submit">Send report</button><button class="button quiet small" type="button" data-support-cancel>Cancel</button></div></form>`;
  } });
  const { panel, body } = bugs;
  const markInvalid = (form, field, message) => {
    const input = form.querySelector(`#${fields[field]}`);
    input.setAttribute('aria-invalid', 'true');
    form.querySelector(`#${input.id}-error`).textContent = message;
    input.focus();
  };
  panel.addEventListener('submit', async event => {
    event.preventDefault();
    const form = event.target;
    const error = form.querySelector('#bug-error');
    const value = name => form.elements[name].value;
    error.textContent = '';
    form.querySelectorAll('[aria-invalid]').forEach(input => input.removeAttribute('aria-invalid'));
    form.querySelectorAll('.field-error').forEach(message => { message.textContent = ''; });
    const email = value('contactEmail').trim();
    const consent = form.elements.contactConsent.checked;
    if (!value('expected').trim()) return markInvalid(form, 'expected', 'Describe what you expected.');
    if (!value('actual').trim()) return markInvalid(form, 'actual', 'Describe what happened instead.');
    if (email && !consent) return markInvalid(form, 'contactConsent', 'Agree to the reply purpose, or remove the reply address.');
    if (!email && consent) return markInvalid(form, 'contactEmail', 'Enter the reply address, or clear the reply checkbox.');
    const button = form.querySelector('[type=submit]');
    button.disabled = true; button.textContent = 'Sending…'; form.setAttribute('aria-busy', 'true');
    try {
      const { reference } = await send('/api/bug-reports', { surface: surfaceOf(bugs.page), expected: value('expected'), actual: value('actual'), steps: value('steps'), diagnostics: form.querySelector('#bug-include').checked ? details : {}, contactEmail: email, contactConsent: consent });
      body.innerHTML = `<div id="bug-saved" role="status" tabindex="-1"><p>Report saved. Reference <strong>${esc(reference)}</strong>.</p><p>Reports are private and are not posted publicly. ${email ? 'Jack Cao may email you about this report only.' : 'No reply will be sent.'}</p></div>`;
      body.querySelector('#bug-saved').focus();
    } catch (failure) {
      if (fields[failure.field]) markInvalid(form, failure.field, failure.message);
      else error.innerHTML = `${esc(failure.message)} You can also email <a href="mailto:${contact}">${contact}</a>.`;
      button.disabled = false; button.textContent = 'Send report'; form.removeAttribute('aria-busy');
    }
  });
}

// The bug path appears at once and waits for neither configuration nor the feedback module.
// An unreachable configuration keeps both controls; the server still refuses collection that is off.
const bugConfig = { enabled: undefined };
mountBugReports(bugConfig);
fetch('/api/site-config').then(response => response.json()).catch(() => ({ feedbackEnabled: true, bugReportsEnabled: true })).then(config => {
  bugConfig.enabled = config.bugReportsEnabled !== false;
  if (config.feedbackEnabled) import('./feedback-questions.js').then(mountFeedback).catch(() => { /* The bug path stays available. */ });
});
