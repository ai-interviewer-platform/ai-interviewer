// Sitewide feedback control. It loads separately from app.js, so it stays usable when a
// feature or the measurement service fails. It reads only the page name from the URL.
import { feedbackTextLimit, questionFor } from './feedback-questions.js';

const esc = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
const currentPage = () => location.hash.replace(/^#\/?/, '').split('?')[0] || 'landing';

async function send(path, body) {
  let response;
  try { response = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); }
  catch { throw Error('The connection failed, so nothing was sent. Your text is still here; try again.'); }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw Error(data.error || 'The request could not be saved. Your text is still here; try again.');
  return data;
}

function mountFeedback(dock) {
  dock.insertAdjacentHTML('beforeend', `<button type="button" class="button secondary support-toggle" id="feedback-toggle" aria-expanded="false" aria-controls="feedback-panel">Feedback</button>
    <section class="support-panel" id="feedback-panel" aria-labelledby="feedback-heading" hidden><h2 id="feedback-heading">Feedback on this page</h2><div id="feedback-body"></div></section>`);
  const toggle = dock.querySelector('#feedback-toggle');
  const panel = dock.querySelector('#feedback-panel');
  const body = dock.querySelector('#feedback-body');
  let page;
  // A draft has an answer or text. Collapsing or changing page keeps it; only Cancel discards it.
  const hasDraft = () => Boolean(body.querySelector('form input:checked') || body.querySelector('form textarea')?.value.trim());
  const collapse = () => {
    if (panel.contains(document.activeElement)) toggle.focus();
    panel.hidden = true;
    toggle.setAttribute('aria-expanded', 'false');
  };
  const expand = () => {
    if (!hasDraft()) {
      page = currentPage();
      const question = questionFor(page);
      body.innerHTML = `<form id="feedback-form" novalidate><fieldset><legend>${esc(question.question)}</legend>${Object.entries(question.answers).map(([value, label]) => `<label class="support-choice"><input type="radio" name="answer" value="${esc(value)}"><span>${esc(label)}</span></label>`).join('')}</fieldset>
        <label for="feedback-text">Anything to add? <span class="muted">Optional</span></label><textarea id="feedback-text" rows="3" maxlength="${feedbackTextLimit}" aria-describedby="feedback-hint"></textarea>
        <p class="small muted" id="feedback-hint">Do not include code, transcripts, passwords or contact details. Feedback is anonymous and no reply is sent.${question.feature === 'review' ? ' This does not change a finding. To dispute a review finding, use “Disagree with this feedback” on the finding.' : ''}</p>
        <p id="feedback-error" role="alert"></p><div class="actions"><button class="button primary small" type="submit">Send feedback</button><button class="button quiet small" type="button" data-support-cancel>Cancel</button></div></form>`;
    }
    dock.querySelector('#feedback-heading').textContent = page === currentPage() ? 'Feedback on this page' : 'Feedback on the page where you started it';
    panel.hidden = false;
    toggle.setAttribute('aria-expanded', 'true');
    body.querySelector('input, textarea').focus();
  };
  toggle.addEventListener('click', () => (panel.hidden ? expand() : collapse()));
  dock.addEventListener('keydown', event => { if (event.key === 'Escape' && !panel.hidden) { collapse(); toggle.focus(); } });
  panel.addEventListener('click', event => { if (event.target.closest('[data-support-cancel]')) { body.innerHTML = ''; collapse(); toggle.focus(); } });
  panel.addEventListener('submit', async event => {
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
      const question = questionFor(page);
      await send('/api/feedback', { questionId: question.id, questionVersion: question.version, surface: page, answer, text });
      body.innerHTML = '<p role="status" tabindex="-1">Thank you. Your feedback was saved.</p>';
      body.querySelector('p').focus();
    } catch (failure) {
      error.textContent = failure.message;
      button.disabled = false; button.textContent = 'Send feedback'; form.removeAttribute('aria-busy');
    }
  });
  // Pages without a question hide the control. An untouched form or a saved message belongs to its page.
  const sync = () => {
    toggle.hidden = !questionFor(currentPage());
    if (currentPage() !== page && !hasDraft()) { body.innerHTML = ''; collapse(); }
    if (toggle.hidden) collapse();
  };
  addEventListener('hashchange', sync);
  sync();
}

const dock = document.createElement('div');
dock.className = 'site-support';
dock.id = 'site-support';
document.body.append(dock);
// An unreachable configuration shows the control; the server still refuses when feedback is off.
fetch('/api/site-config').then(response => response.json()).catch(() => ({ feedbackEnabled: true })).then(config => {
  if (config.feedbackEnabled) mountFeedback(dock);
});
