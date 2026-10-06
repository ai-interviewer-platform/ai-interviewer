import { assignVariant } from './experiment.js';
import { heatGridSize } from './measurement-contract.js';
import { documentExposureId, measure, measurementOptedOut } from './measurement.js';
import { siteConfig } from './site-config.js';

const esc = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
let exposureEmitted = false;
let experimentEmitted = false;

export function landingScreen() {
  return `<div class="landing">
    <section class="landing-hero enter" aria-labelledby="landing-title" data-heat-zone="hero">
      <div><p class="eyebrow" data-copy-slot="eyebrow">For students &amp; new grads preparing for SWE interviews</p>
      <h1 id="landing-title" data-copy-slot="headline">Make your thinking<br>part of the answer.</h1>
      <p class="intro" data-copy-slot="intro">You know enough Python to attempt the problem. Now practice explaining your approach, testing it, and revising what didn’t work.</p>
      <div class="actions" id="landing-actions"><a class="button secondary pressable" href="#sample" data-launch-action="sample">Explore the guided sample</a></div>
      <p class="small" id="landing-availability" role="status">Checking personal practice availability…</p><button class="button quiet small" type="button" data-check-personal hidden>Check again</button></div>
      <aside class="landing-evidence" aria-label="Fictional review example" data-heat-zone="sample-evidence"><div class="landing-evidence-label">Fictional sample · evidence, not a verdict</div>
        <pre><code>for index, tag in enumerate(tags):
    if tag in seen:
        answer = index
    seen.add(tag)</code></pre>
        <div class="landing-finding"><span class="eyebrow">At checkpoint 04:26</span><h2>You said “the first match.”</h2><p>The saved code keeps scanning and overwrites the answer. Inspect that difference, then try another approach.</p><a class="text-link" href="#review?source=sample">Inspect the sample review →</a></div>
      </aside>
    </section>
    <section class="landing-loop" aria-labelledby="landing-loop-title" data-heat-zone="loop"><div class="section-heading"><h2 id="landing-loop-title">An attempt is a starting point.</h2><span class="small muted">Practice → review → retry</span></div>
      <ol><li><span class="eyebrow">Practice</span><h3>Explain. Write. Test.</h3><p>Work through a Python problem with the AI interviewer. Try interview conditions or guided coach mode.</p></li><li><span class="eyebrow">Review</span><h3>Follow the evidence.</h3><p>Findings cite recorded work and state their limits. They don’t infer what you never showed.</p></li><li><span class="eyebrow">Retry</span><h3>Revise with a purpose.</h3><p>Start again from a saved checkpoint in coach mode. Test whether your change fixes the problem.</p></li></ol>
    </section>
    <div class="landing-bottom"><section aria-labelledby="landing-fit" data-heat-zone="fit"><p class="eyebrow">Before you begin</p><h2 id="landing-fit">Bring Python fundamentals.<br>Leave room to get it wrong.</h2><p>This is coding-interview practice, not a beginner Python course or a hiring assessment. C++, JavaScript and TypeScript are not supported.</p>
      <details><summary>What does voice require?</summary><p>Personal voice requires an enabled service, a supported browser and microphone permission. Text practice does not require a microphone. The sample never records audio.</p></details>
      <details><summary>What is real in the sample?</summary><p>The code, conversations and findings are authored examples. They create no personal attempt records and do not measure your performance.</p></details>
      <details><summary>What gets saved in personal practice?</summary><p>When enabled, Coursay saves code, transcripts, test results and evidence-linked reviews. AI findings can be wrong. Read the <a href="#privacy">privacy notice</a> before starting. No interview outcome is guaranteed.</p></details>
    </section>
    <section class="landing-waitlist" aria-labelledby="waitlist-title" data-heat-zone="waitlist"><p class="eyebrow">Keep in touch</p><h2 id="waitlist-title">Join the waitlist</h2><p id="waitlist-unavailable" role="status">Checking whether the waitlist is open…</p>
      <div id="waitlist-policy" hidden></div>
      <form id="waitlist-form" hidden novalidate><label for="waitlist-email">Email address</label><input id="waitlist-email" name="email" type="email" autocomplete="email" required aria-describedby="waitlist-error"><label class="landing-consent"><input id="waitlist-consent" type="checkbox" required><span id="waitlist-purpose"></span></label><button class="button primary pressable" type="submit">Join the waitlist</button><p id="waitlist-error" role="alert"></p></form>
      <div id="waitlist-success" hidden><p role="status">Request saved. If this address was already registered, its existing record stays unchanged. Joining is not a practice attempt.</p><label for="waitlist-receipt">Withdrawal receipt — save your first receipt</label><textarea id="waitlist-receipt" readonly rows="2"></textarea><p class="small">Only the receipt from your original signup can remove that record. No confirmation email is sent.</p></div>
      <details id="waitlist-withdrawal"><summary>Withdraw waitlist interest</summary><form id="waitlist-withdraw-form"><label for="withdraw-receipt">Original withdrawal receipt</label><input id="withdraw-receipt" required autocomplete="off"><button class="button secondary" type="submit">Withdraw interest</button><p id="withdraw-status" role="status"></p></form></details>
    </section></div>
  </div>`;
}

export function mountLanding(root) {
  let active = true;
  let policy;
  const form = root.querySelector('#waitlist-form');
  const email = root.querySelector('#waitlist-email');
  const consent = root.querySelector('#waitlist-consent');
  const error = root.querySelector('#waitlist-error');
  const withdrawal = root.querySelector('#withdraw-receipt');
  try { withdrawal.value = JSON.parse(sessionStorage.getItem('coursay-waitlist-receipt') || 'null')?.receipt || ''; } catch { /* Receipt remains manually usable. */ }
  if (!exposureEmitted) { measure('landing_exposed'); exposureEmitted = true; }
  root.addEventListener('click', event => {
    if (event.target.closest('[data-check-personal]')) checkPersonal(true);
    const link = event.target.closest('[data-launch-action]');
    if (link) measure('cta_selected', { action: link.dataset.launchAction });
    // Heatmap cells over the landing. Clicks in text fields are masked. A keyboard
    // activation has no pointer position (detail 0), so it counts at the control's centre.
    if (event.target.closest('input, textarea, select')) return;
    const bounds = root.getBoundingClientRect();
    const target = event.target.getBoundingClientRect();
    const [x, y] = event.detail === 0 ? [target.left + target.width / 2, target.top + target.height / 2] : [event.clientX, event.clientY];
    const cell = (offset, size) => Math.min(heatGridSize - 1, Math.max(0, Math.floor((offset / size) * heatGridSize)));
    measure('landing_click', { zone: event.target.closest('[data-heat-zone]')?.dataset.heatZone ?? 'other', cellX: cell(x - bounds.left, bounds.width), cellY: cell(y - bounds.top, bounds.height), viewport: innerWidth < 768 ? 'narrow' : 'wide' });
  });
  const api = async (url, body) => {
    const response = await fetch(url, body === undefined ? { signal: AbortSignal.timeout(10000) } : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const data = await response.json();
    if (!response.ok) throw Error(data.error || 'Unable to save. Check your connection and try again.');
    return data;
  };
  const landingConfig = api('/api/landing-config').catch(() => null);
  const actions = root.querySelector('#landing-actions');
  // Personal availability has its own check, so a failed check offers a retry.
  const checkPersonal = (retried = false) => {
    const status = root.querySelector('#landing-availability');
    const retry = root.querySelector('[data-check-personal]');
    status.textContent = 'Checking personal practice availability…';
    Promise.all([landingConfig, api('/api/personal-availability').catch(() => null)]).then(([config, personal]) => {
      if (!active) return;
      retry.hidden = Boolean(personal);
      if (!personal) { status.textContent = 'Personal practice availability could not be checked.'; return; }
      const ready = personal.collectionEnabled && personal.mvpReady;
      status.textContent = ready ? `Personal practice is enabled. ${personal.voiceEnabled ? 'Voice and text modes available.' : 'Text mode available; voice is unavailable.'}` : 'Personal practice is not open yet. Explore the fictional sample without an account.';
      // A primary waitlist button stays first.
      const waitlistButton = actions.querySelector('button[data-launch-action="waitlist"]');
      if (ready && !actions.querySelector('[data-launch-action="personal_practice"]')) (waitlistButton ?? actions).insertAdjacentHTML(waitlistButton ? 'afterend' : 'afterbegin', `<a class="button ${config?.primaryAction === 'personal_practice' ? 'primary' : 'secondary'} pressable" href="#personal" data-launch-action="personal_practice">Start personal practice</a>`);
      // The retry button is gone, so focus moves to the first action.
      if (retried) actions.querySelector('a, button')?.focus();
    });
  };
  checkPersonal();
  Promise.all([landingConfig, siteConfig()]).then(([config, site]) => {
    if (!active) return;
    policy = config?.policy;
    // A running experiment assigns this document a variant. Opted-out browsers keep the control and send nothing.
    if (config?.experiment && !measurementOptedOut()) {
      const variant = assignVariant(config.experiment, documentExposureId);
      for (const [slot, copy] of Object.entries(variant.copy ?? {})) { const target = root.querySelector(`[data-copy-slot="${slot}"]`); if (target) target.textContent = copy; }
      if (!experimentEmitted) {
        const internal = new URLSearchParams(location.hash.split('?')[1]).has('internal');
        measure('experiment_exposed', { experiment: config.experiment.id, variant: variant.id, variantVersion: variant.version, eligibility: navigator.webdriver ? 'automation' : internal ? 'internal' : 'eligible' });
        experimentEmitted = true;
      }
    }
    // An unreachable site configuration keeps the form for a published notice; the server still refuses a closed waitlist.
    if (policy && (site ? site.waitlistEnabled : true)) {
      root.querySelector('#waitlist-unavailable').hidden = true;
      const notice = root.querySelector('#waitlist-policy');
      notice.hidden = false;
      notice.innerHTML = `<p>${esc(policy.contactPurpose)}</p><p class="small">Operator: ${esc(policy.operator)}. Contact: ${esc(policy.contact)}. Retention: ${esc(policy.retention)}. Processors: ${esc(policy.processors)}. Deletion: ${esc(policy.deletion)}.</p><p class="small">Server confirmation with a withdrawal receipt; no email is sent. Email ownership is not verified. No account or practice record is created.</p>`;
      root.querySelector('#waitlist-purpose').textContent = `I agree to this contact purpose: ${policy.contactPurpose}`;
      form.hidden = false;
      if (config.primaryAction === 'waitlist') {
        const button = document.createElement('button'); button.type = 'button'; button.className = 'button primary pressable'; button.dataset.launchAction = 'waitlist'; button.textContent = 'Join the waitlist';
        button.addEventListener('click', () => email.focus()); actions.prepend(button);
      }
    } else root.querySelector('#waitlist-unavailable').textContent = 'The waitlist is not accepting email addresses yet. Contact and data-policy decisions are pending.';
  });
  form.addEventListener('submit', async event => {
    event.preventDefault();
    email.removeAttribute('aria-invalid'); consent.removeAttribute('aria-invalid'); error.textContent = '';
    if (!email.validity.valid) { error.textContent = 'Enter an email address, such as name@example.com.'; email.setAttribute('aria-invalid', 'true'); email.focus(); return; }
    if (!consent.checked) { error.textContent = 'Agree to the stated contact purpose to join.'; consent.setAttribute('aria-invalid', 'true'); consent.setAttribute('aria-describedby', 'waitlist-error'); consent.focus(); return; }
    const button = form.querySelector('button'); button.disabled = true; form.setAttribute('aria-busy', 'true');
    try {
      const result = await api('/api/waitlist', { email: email.value, consent: true, policyVersion: policy.version });
      if (!active) return;
      let receipt = result.receipt;
      try {
        const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(email.value.trim().toLowerCase()));
        const emailHash = Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
        const previous = JSON.parse(sessionStorage.getItem('coursay-waitlist-receipt') || 'null');
        if (previous?.emailHash === emailHash) receipt = previous.receipt;
        sessionStorage.setItem('coursay-waitlist-receipt', JSON.stringify({ emailHash, receipt }));
      } catch { /* Display the receipt even without storage. */ }
      root.querySelector('#waitlist-receipt').value = receipt; withdrawal.value = receipt;
      root.querySelector('#waitlist-success').hidden = false; form.hidden = true;
      root.querySelector('#waitlist-receipt').focus();
      measure('waitlist_request_accepted', { authority: 'server', action: 'waitlist' });
    } catch (failure) { error.textContent = failure.message; }
    finally { button.disabled = false; form.removeAttribute('aria-busy'); }
  });
  root.querySelector('#waitlist-withdraw-form').addEventListener('submit', async event => {
    event.preventDefault(); const status = root.querySelector('#withdraw-status'); const button = event.target.querySelector('button'); button.disabled = true;
    try {
      await api('/api/waitlist/withdraw', { receipt: withdrawal.value.trim() });
      status.textContent = 'Withdrawal processed. Any record matching this receipt has been deleted. If you lost your original receipt, use the published contact channel.';
      try { sessionStorage.removeItem('coursay-waitlist-receipt'); } catch { /* No effect on server withdrawal. */ }
      root.querySelector('#waitlist-success').hidden = true;
      measure('waitlist_withdrawal_accepted', { authority: 'server', action: 'waitlist' });
    } catch (failure) { status.textContent = failure.message; }
    finally { button.disabled = false; }
  });
  return () => { active = false; };
}
