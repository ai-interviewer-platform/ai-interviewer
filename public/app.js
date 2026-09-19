import { brandWordmark, startBrandMotion } from './brand.js';
import { exercises, scenes, parseRoute, fixtureResult, initialAttempt, updateAttempt } from './model.js';

import { homeScreen, roadmapScreen, getPracticeLeaf, problemDrawer } from './discovery.js';
import { positionRoadmapConnections } from './roadmap.js';
import { profileScreen } from './profile.js';
import { mountPersonal } from './personal-adapter.js';
import { pageFooter, legalScreen } from './legal.js';

const app = document.querySelector('#app');
const drawer = document.querySelector('#problem-drawer');
const dialog = document.querySelector('#dialog');
const announcement = document.querySelector('#announcement');
const icons = {
  arrow: '<path d="M4 10h12m-5-5 5 5-5 5"/>',
  back: '<path d="M16 10H4m5-5-5 5 5 5"/>',
  chevron: '<path d="m8 5 5 5-5 5"/>',
  close: '<path d="m5 5 10 10M15 5 5 15"/>',
  play: '<path d="m7 4 9 6-9 6Z"/>',
  check: '<path d="m4 10 4 4 8-8"/>',
  map: '<rect x="2" y="7" width="5" height="6" rx="1"/><rect x="13" y="2" width="5" height="5" rx="1"/><rect x="13" y="13" width="5" height="5" rx="1"/><path d="M7 10h3V4.5h3M10 10v5.5h3"/>',
  list: '<path d="M7 5h10M7 10h10M7 15h10M3 5h.1M3 10h.1M3 15h.1"/>',
  clock: '<circle cx="10" cy="10" r="7"/><path d="M10 6v4l3 2"/>',
  settings: '<path d="M3 5h14M3 15h14"/><circle cx="7" cy="5" r="2"/><circle cx="13" cy="15" r="2"/>',
  code: '<path d="m6 5-5 5 5 5m8-10 5 5-5 5m-3-12-2 14"/>',
  message: '<path d="M17 3H3v11h4v4l5-4h5Z"/>',
  mic: '<rect x="7" y="2" width="6" height="10" rx="3"/><path d="M4 9v1a6 6 0 0 0 12 0V9m-6 7v3m-3 0h6"/>',
  expand: '<path d="M3 8V3h5m4 0h5v5M3 12v5h5m4 0h5v-5"/>',
  shield: '<path d="M10 2 3 5v5c0 4 7 8 7 8s7-4 7-8V5Z"/><path d="m6 9 3 3 5-5"/>',
  book: '<path d="M10 5C7 3 4 3 2 4v12c3-1 5-1 8 1 3-2 5-2 8-1V4c-2-1-5-1-8 1Zm0 0v12"/>',
  flag: '<path d="M4 18V3m0 1c4-3 8 3 12 0v8c-4 3-8-3-12 0"/>',
};
const icon = (name) => `<svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] ?? icons.arrow}</svg>`;
const esc = (value) => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
const button = (label, action, style = '', glyph = '') => `<button type="button" class="button ${style}" data-action="${action}">${glyph ? icon(glyph) : ''}<span>${label}</span></button>`;
const link = (label, path, style = '', glyph = '') => `<a class="button ${esc(style)}" href="#${esc(path)}">${glyph ? icon(glyph) : ''}<span>${esc(label)}</span></a>`;
const badge = (label, style = '') => `<span class="badge ${style}">${label}</span>`;
let route = parseRoute(location.hash);
let origin = 'roadmap?topic=sets';
let lastTrigger;
let messages = [];
let typed = '';
let mapScroll = 0;
const state = {
  personal: initialAttempt(), sample: initialAttempt('duplicate'), retry: null,
  input: 'text', audio: false, consent: true, goal: 'Internship interviews', concern: '', studied: 'Arrays, loops, sets',
  conversation: 'compact', muted: false, guide: true, caseIndex: 2, checkpoint: 'run',
  leftTab: 'findings', mobilePane: 'problem', historyDeleted: false, reduce: false,
  theme: 'dark', sessionFilter: 'All', layout: 40, codeSize: 14, reviewState: '', sampleRoute: 'sample', replaying: false, replayPosition: 78, reviewOpened: false,
};
try {
  const saved = JSON.parse(sessionStorage.getItem('interview-prototype') ?? 'null');
  if (saved) {
    if (['dark', 'light', 'system'].includes(saved.theme)) state.theme = saved.theme;
    state.reduce = saved.reduce === true;
    for (const kind of ['personal', 'sample']) {
      const record = saved[kind];
      if (!record) continue;
      for (const key of ['fixed', 'ran', 'assisted', 'finished', 'disputed', 'draft']) state[kind][key] = record[key] === true;
      if (kind === 'personal' && ['tags', 'alert', 'runs'].includes(record.problem)) state.personal.problem = record.problem;
    }
    state.historyDeleted = saved.historyDeleted === true;
    state.reviewOpened = saved.reviewOpened === true;
    if (['sample', 'review?source=sample', 'retry?source=sample', 'complete?source=sample'].includes(saved.sampleRoute)) state.sampleRoute = saved.sampleRoute;
    if (saved.retry && ['duplicate', 'tags', 'alert', 'runs'].includes(saved.retry.problem)) {
      state.retry = initialAttempt(saved.retry.problem);
      for (const key of ['fixed', 'ran', 'assisted', 'finished', 'disputed', 'draft']) state.retry[key] = saved.retry[key] === true;
    }
  }
} catch { /* Prototype stays usable if session storage is blocked or corrupt. */ }
function persist() {
  try {
    sessionStorage.setItem('interview-prototype', JSON.stringify({ theme: state.theme, reduce: state.reduce, personal: state.personal, sample: state.sample, retry: state.retry, sampleRoute: state.sampleRoute, historyDeleted: state.historyDeleted, reviewOpened: state.reviewOpened }));
    return true;
  } catch { return false; }
}
function notify(message) { announcement.textContent = message; }
function go(path) { if (location.hash === `#${path}`) render(true); else location.hash = path; }
// Sample routes keep their own attempt state. Every prototype route is visibly
// labeled as fictional; the real data adapter is isolated behind #personal.
function isSample() { return route.page === 'sample' || route.params.get('source') === 'sample'; }
function activeAttempt() {
  if (route.page === 'retry' || route.page === 'complete') {
    const problem = isSample() ? 'duplicate' : state.personal.problem;
    if (!state.retry || state.retry.problem !== problem) state.retry = { ...initialAttempt(problem), assisted: true };
    return state.retry;
  }
  return isSample() ? state.sample : state.personal;
}
function mutateAttempt(action) {
  const attempt = activeAttempt();
  const next = updateAttempt(attempt, action);
  if (attempt === state.retry) state.retry = next;
  else if (isSample()) state.sample = next;
  else state.personal = next;
  persist();
}
function sourceQuery() { return isSample() ? '?source=sample' : ''; }
function replayTime(seconds) { return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`; }
function currentExercise() { return exercises[activeAttempt().problem]; }

function chrome(content, workspace = false) {
  const navItem = (label, path) => {
    const current = route.page === path || (path === 'sessions' && workspace);
    return link(label, path, `nav-link ${current ? 'current' : ''}`).replace('href=', `${current ? 'aria-current="page" ' : ''}href=`);
  };
  return `<div class="app-shell" data-nav="top"><div class="floating-nav"><header class="app-header">
    ${brandWordmark()}
    <nav class="nav-primary" aria-label="Primary">${navItem('Home', 'welcome')}${navItem('Roadmap', 'roadmap')}${navItem('Sessions', 'sessions')}</nav>
    <nav class="nav-account" aria-label="Account">${navItem('Preferences', 'preferences')}${navItem('Design system', 'system')}<a class="avatar" href="#profile" aria-label="Open profile" ${route.page === 'profile' ? 'aria-current="page"' : ''}>${esc((state.profile?.name || 'Alex').charAt(0).toUpperCase())}</a></nav>
  </header></div><div class="app-content"><main id="main" tabindex="-1" class="${workspace ? 'workspace-main' : 'page-main'}">${content}</main>
  ${pageFooter()}</div></div>`;
}

function syncNavbar() {
  document.documentElement.dataset.scrolled = String(window.scrollY > 0);
}
function measureNavbar() {
  const footer = document.querySelector('.page-footer');
  if (footer) document.documentElement.style.setProperty('--footer-height', `${footer.getBoundingClientRect().height}px`);
  const header = document.querySelector('.floating-nav .app-header');
  if (!header) return;
  const style = getComputedStyle(header);
  const children = [...header.children];
  const contentWidth = children.reduce((width, child) => width + child.getBoundingClientRect().width, 0);
  const width = contentWidth + parseFloat(style.columnGap) * (children.length - 1) + parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
  header.style.setProperty('--nav-compact-width', `${Math.ceil(width)}px`);
  document.documentElement.style.setProperty('--navbar-height', `${header.parentElement.getBoundingClientRect().height}px`);
  syncNavbar();
}
const navbarObserver = new ResizeObserver(measureNavbar);
const roadmapObserver = new ResizeObserver(positionRoadmapConnections);
window.addEventListener('scroll', syncNavbar, { passive: true });
window.addEventListener('resize', measureNavbar);
document.fonts.ready.then(measureNavbar);

const discoveryUI = { link, button, icon, badge, esc };
function profile() { return profileScreen(state, discoveryUI); }
function welcome() { return homeScreen(state, route, discoveryUI); }
function roadmap() { return roadmapScreen(state, route, discoveryUI); }
function closeProblems() {
  const selection = getPracticeLeaf(route);
  if (!selection) return;
  const view = route.params.get('view') ?? (matchMedia('(max-width: 48rem)').matches ? 'list' : 'map');
  go(`roadmap?topic=${selection.topic.id}&view=${view}&return=${selection.leaf.id}`);
}
function syncProblemDrawer() {
  const selection = route.page === 'roadmap' ? getPracticeLeaf(route) : null;
  if (!selection) { if (drawer.open) drawer.close(); return; }
  drawer.innerHTML = problemDrawer(selection, discoveryUI);
  if (!drawer.open) drawer.showModal();
}
drawer.addEventListener('cancel', (event) => { event.preventDefault(); closeProblems(); });
function outsideDrawer(event) {
  const bounds = drawer.getBoundingClientRect();
  return event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom;
}
let drawerPointerStartedOutside = false;
drawer.addEventListener('pointerdown', event => { drawerPointerStartedOutside = outsideDrawer(event); });
drawer.addEventListener('pointercancel', () => { drawerPointerStartedOutside = false; });
drawer.addEventListener('click', event => {
  if (drawerPointerStartedOutside && outsideDrawer(event)) closeProblems();
  drawerPointerStartedOutside = false;
});

function sessionRow(title, detail, mode, status, path, action) {
  return `<div class="session-row"><div class="session-title">${icon('code')}<span><strong>${title}</strong><small>${detail}</small></span></div><span>${mode}</span><span>${badge(status, status === 'Review ready' ? 'accent' : '')}</span>${link(action, path, 'secondary session-action', 'arrow')}</div>`;
}
function emptyState(title, text, actions, glyph = 'book') {
  return `<section class="empty-state">${icon(glyph)}<h2>${title}</h2><p>${text}</p><div class="actions">${actions}</div></section>`;
}
function sessions() {
  const mode = route.params.get('state');
  const filter = route.params.get('filter') || 'All';
  const empty = state.historyDeleted || mode === 'empty';
  return `<div class="page-title"><div><p class="eyebrow">Practice history</p><h1>Sessions</h1></div>${link('Start an interview', 'setup', 'primary session-action', 'play')}</div>
  ${state.retry?.draft && state.retry.problem !== 'duplicate' ? `<div class="notice">${icon('clock')}Checkpoint retry · ${exercises[state.retry.problem].title} · Draft saved ${link('Resume retry', 'retry', 'secondary')}</div>` : ''}
  <div class="notice">${icon('book')} These are fictional session records. No personal recording is stored.</div>
  ${mode === 'error' ? emptyState('Session history couldn’t load', 'Your saved work is not marked as lost. Try loading the history again, or explore the guided sample.', link('Try loading again', 'sessions', 'primary') + link('Try the sample', 'sample', 'secondary'), 'clock') : empty ? emptyState('Your first session starts here', 'Practice a problem, then return to its conversation, code, and review.', link('Try a guided sample', 'sample', 'primary'), 'message') : `<nav class="session-filters segmented" aria-label="Filter sessions">${['All', 'Review ready', 'Draft saved', 'Review pending'].map(label => link(label, `sessions?filter=${encodeURIComponent(label)}`, filter === label ? 'selected' : '')).join('')}</nav><div class="session-table" data-filter="${esc(filter)}"><div class="table-heading"><span>Problem / activity</span><span>Mode</span><span>Status</span><span></span></div>${sessionRow(exercises[state.personal.problem].title, 'Fictional session · Today, 10:42', 'Mock', state.personal.draft ? 'Draft saved' : 'Review ready', state.personal.draft ? 'interview' : 'review', state.personal.draft ? 'Resume' : 'Open review')}${sessionRow('First threshold alert', 'Fictional session · Yesterday', 'Mock', 'Draft saved', 'interview?problem=alert', 'Resume')}${sessionRow('First consecutive pair', 'Fictional session · Earlier', 'Mock', 'Review pending', 'review?state=pending&problem=runs', 'View attempt')}</div><div class="history-bottom">${icon('shield')} A review describes an attempt. It doesn’t predict an interview outcome.</div>`}`;
}

function setup() {
  const problem = route.params.get('problem') ?? state.personal.problem;
  const exercise = exercises[problem] ?? exercises.tags;
  const micError = route.params.get('state') === 'mic';
  return `<a class="back-link" href="#${esc(origin)}">${icon('back')}Back to roadmap</a><div class="setup-grid"><section><p class="eyebrow">Before you begin</p><h1>Make room to think.</h1><div class="setup-problem">${icon('code')}<div><span class="small muted">Selected problem</span><h2>${exercise.title}</h2><p>${exercise.topic} · Python · English</p></div></div><div class="detail-note">This is a preview of personal setup. The next screen uses a prepared attempt, not a live AI interview.</div></section>
  <form id="setup-form" class="setup-form"><h2>Session preferences</h2><label for="goal">What are you preparing for?</label><select id="goal" name="goal">${['Internship interviews', 'New-grad interviews', 'General coding practice'].map((goal) => `<option ${state.goal === goal ? 'selected' : ''}>${goal}</option>`).join('')}</select><label for="studied">Topics you have studied</label><input id="studied" name="studied" value="${esc(state.studied)}" autocomplete="off"><label for="concern">Anything you want to work on? <span class="muted">Optional</span></label><input id="concern" name="concern" value="${esc(state.concern)}" placeholder="Explaining why my approach works" autocomplete="off">
  <fieldset><legend>How would you like to respond?</legend><div class="choice-pair"><label class="choice"><input type="radio" name="input" value="text" ${state.input === 'text' ? 'checked' : ''}>${icon('message')}<span>Text<small>No microphone needed</small></span></label><label class="choice"><input type="radio" name="input" value="voice" ${state.input === 'voice' ? 'checked' : ''}>${icon('mic')}<span>Voice<small>Preview only</small></span></label></div></fieldset>
  ${micError ? `<div class="inline-alert">Microphone unavailable in this preview. Continue with text; spoken delivery won’t be assessed.${button('Use text instead', 'use-text', 'quiet')}</div>` : state.input === 'voice' ? `<div class="notice">No microphone is accessed in the prototype. ${button('Preview microphone check', 'mic-check', 'quiet')}</div>` : ''}
  <label class="check-row"><input type="checkbox" name="audio" ${state.audio ? 'checked' : ''}><span>Save audio for replay<small>Optional in the product. Separate from live voice processing.</small></span></label>
  <label class="check-row"><input type="checkbox" name="consent" ${state.consent ? 'checked' : ''}><span>Allow transcript, code, and session records for review<small>The product will explain retention before collecting anything. This prototype collects no session data.</small></span></label>
  <div class="form-error" id="consent-error" ${state.consent ? 'hidden' : ''}>Personal review needs session records. You can use the guided sample without them.</div><div class="actions"><button class="button primary" type="submit">${icon('play')}Start interview preview</button>${link('Use the sample instead', 'sample', 'quiet')}</div></form></div>`;
}

function workspace() {
  const review = route.page === 'review';
  const retry = route.page === 'retry';
  const sample = isSample();
  const attempt = activeAttempt();
  const exercise = currentExercise();
  const condition = route.params.get('state') ?? state.reviewState;
  const label = review ? 'Review' : retry ? 'Coach · checkpoint retry' : sample ? 'Guided sample · not scored' : 'Mock preview';
  const fixed = review ? condition === 'clear' : attempt.fixed;
  const code = review && state.checkpoint === 'start' ? `${exercise.original.split('\n')[0]}\n    pass` : fixed ? exercise.repaired : exercise.original;
  return `<div class="session-header"><div class="actions">${link('Sessions', 'sessions', 'quiet small', 'back')}<h1>${exercise.title}</h1>${badge(label, sample ? 'accent' : '')}</div><div class="actions"><span class="small muted">${review ? 'Fictional saved attempt' : 'No recording · prepared code'}</span>${review ? link('Back to roadmap', origin, 'secondary small') : button('Save & exit', 'save-exit', 'quiet small')}${retry ? link('View original', `review${sourceQuery()}`, 'quiet small') : ''}${review ? '' : button(retry ? 'Finish retry' : sample ? 'Review this moment' : 'Finish interview', retry ? 'finish-retry' : 'finish', 'secondary small')}</div></div>

  ${condition === 'offline' ? `<div class="inline-alert workspace-alert">Connection interrupted. The prepared draft is still here. ${button('Reconnect preview', 'recover', 'quiet small')}${button('Continue in text', 'offline-text', 'quiet small')}</div>` : ''}
  <div class="mobile-switch segmented" aria-label="Workspace view">${['problem', 'code', 'conversation'].map((pane) => `<button type="button" class="button ${state.mobilePane === pane ? 'selected' : ''}" data-action="pane-${pane}" aria-pressed="${state.mobilePane === pane}">${pane === 'problem' && review ? 'Findings' : pane[0].toUpperCase() + pane.slice(1)}</button>`).join('')}</div>
  <div class="workspace" data-pane="${state.mobilePane}" style="--left-width:${state.layout}%;--code-size:${state.codeSize}px"><div class="left-column ${condition === 'expanded' ? 'expanded' : state.conversation}"><section class="problem-pane pane"><div class="panel-top">${review ? tabs('left', ['Findings', 'Problem'], state.leftTab) : `<span>${icon('book')}Problem</span><span class="small muted">Original exercise</span>`}</div>${sample && state.guide ? `<div class="sample-guide"><span class="guide-symbol">${icon('book')}</span><div><strong>${review ? 'Inspect the moment, not a score.' : retry ? 'What happens immediately after finding a repeat?' : 'Follow a candidate’s attempt.'}</strong><span>${review ? 'The transcript, highlighted line, and test describe the same checkpoint.' : retry ? 'Choose the prepared repair, then run the sample tests again.' : 'Read the plan below, run the prepared sample tests, then open the review.'}</span></div>${button('Hide guidance', 'hide-guide', 'quiet small')}</div>` : ''}<div class="problem-scroll" ${review ? `role="tabpanel" aria-labelledby="left-${state.leftTab}"` : ''}>${review && state.leftTab === 'findings' ? findings(condition) : problemContent(exercise)}</div></section>
  ${conversation(review, retry, sample, condition)}</div>
  <div class="splitter" role="separator" tabindex="0" aria-label="Problem and code width" aria-orientation="vertical" aria-valuemin="30" aria-valuemax="60" aria-valuenow="${state.layout}" data-splitter="columns"></div>
  <div class="right-column"><section class="editor-pane pane"><div class="panel-top"><span>${icon('code')}${review ? 'Checkpoint code' : 'Code'}</span><div class="actions">${review ? `<label class="sr-only" for="checkpoint">Saved checkpoint</label><select id="checkpoint"><option value="run" ${state.checkpoint === 'run' ? 'selected' : ''}>04:26 · Test run</option><option value="start" ${state.checkpoint === 'start' ? 'selected' : ''}>00:00 · Starter code</option></select>` : '<span class="small muted">Python</span>'}${button('Layout', 'layout', 'quiet small', 'settings')}</div></div><div class="editor-subbar"><span class="mono">${exercise.function}.py</span><span>${review ? 'Read-only evidence' : 'Prepared code · read-only preview'}</span></div>
  <div class="code-scroll" tabindex="0" aria-label="${review ? 'Recorded' : 'Prepared'} Python code">${codeBlock(code, review && state.checkpoint === 'run' && condition !== 'clear' ? (attempt.problem === 'runs' || attempt.problem === 'alert' ? 5 : 6) : 0)}</div><div class="editor-footer"><span>${review ? state.checkpoint === 'run' ? `Checkpoint: test run · revision ${fixed ? 2 : 1}` : 'Checkpoint: starter · no run yet' : attempt.fixed ? 'Prepared repair · revision 2' : 'Prepared draft · revision 1'}</span><span>UTF-8 · Python</span></div></section>
  <section class="test-pane pane"><div class="panel-top"><span>${icon('check')}Tests & results</span>${!review ? button(sample ? 'Run sample tests' : 'Run prepared tests', 'run', 'primary small', 'play') : badge('Simulated result')}</div><div id="test-body" class="test-body">${testContent(review, condition, fixed)}</div></section></div></div>`;
}

function tabs(group, names, selected) {
  return `<div class="tabs" role="tablist" aria-label="${group === 'left' ? 'Review content' : 'Test cases'}">${names.map((name) => `<button type="button" id="${group}-${name.toLowerCase()}" role="tab" aria-selected="${selected === name.toLowerCase()}" tabindex="${selected === name.toLowerCase() ? 0 : -1}" data-action="${group}-${name.toLowerCase()}">${name}</button>`).join('')}</div>`;
}
function problemContent(exercise) {
  return `<div class="problem-heading"><p class="eyebrow">${exercise.topic}</p><h2>${exercise.title}</h2></div><p class="problem-lead">${exercise.lead}</p><p>${exercise.body}</p><h3>Example</h3><div class="example"><div><span>Input</span><code>${esc(exercise.input)}</code></div><div><span>Output</span><code>${exercise.expected}</code></div></div><p>${esc(exercise.explanation)}</p><h3>Keep in mind</h3><ul class="requirements"><li>The input may be empty.</li><li>Scan in the order given; don’t sort the input.</li><li>Return a value instead of printing it.</li></ul><details><summary>Clarifying the requirement</summary><p>“First” means the earliest qualifying position in a left-to-right scan. Ask about an ambiguity before choosing your approach.</p></details>`;
}
function codeBlock(code, highlight = 0) {
  const colorCode = (line) => esc(line).replace(/\b(def|return|if|for|in|None|pass)\b/g, '<span class="syntax-keyword">$1</span>').replace(/\b(set|enumerate|range|len)\b/g, '<span class="syntax-function">$1</span>');
  return `<pre class="code-lines"><code>${code.split('\n').map((line, index) => `<span class="code-line ${index + 1 === highlight ? 'evidence-line' : ''}"><span class="line-number" aria-hidden="true">${index + 1}</span><span>${colorCode(line) || ' '}</span>${index + 1 === highlight ? '<span class="line-marker" aria-label="Evidence line">←</span>' : ''}</span>`).join('')}</code></pre>`;
}
function testContent(review, condition, fixed) {
  const attempt = activeAttempt();
  if (condition === 'runner') return `<div class="test-empty"><strong>Runner unavailable</strong><p>Your prepared draft is unchanged. This is an infrastructure error, not a failing test.</p>${button('Retry prepared run', 'recover-run', 'secondary')}</div>`;
  if (condition === 'running') return `<div class="test-empty" aria-busy="true"><strong>Running tests…</strong><p>Pending-state preview. No process is running.</p>${button('Show simulated result', 'recover-run', 'secondary')}</div>`;
  if (review && state.checkpoint === 'start' || !review && !attempt.ran) return `<div class="test-empty">${icon('play')}<strong>${review ? 'No run at this checkpoint' : 'Give your approach a test'}</strong><p>${review ? 'Select the test-run checkpoint to inspect its result.' : 'Run the prepared cases to see the result for this exact code.'}</p></div>`;
  const result = fixtureResult(attempt.problem, fixed, state.caseIndex);
  return `<div class="test-summary"><strong class="${fixed ? 'success-text' : 'error-text'}">${fixed ? 'Prepared cases pass' : 'A case needs another look'}</strong><span class="small muted">Simulated result · ${fixed ? 'revision 2' : 'revision 1'}</span></div><div class="case-buttons" aria-label="Test cases">${[0, 1, 2].map((index) => `<button type="button" class="button small ${state.caseIndex === index ? 'selected' : 'quiet'}" data-action="case-${index}" aria-pressed="${state.caseIndex === index}">${index === 2 && !fixed ? '<span class="error-dot" aria-hidden="true"></span>' : ''}Case ${index + 1}</button>`).join('')}</div><dl class="result-values"><div><dt>Input</dt><dd><code>${esc(result.input)}</code></dd></div><div><dt>Expected</dt><dd><code>${esc(result.expected)}</code></dd></div><div><dt>Actual ${result.passed ? '✓' : '≠'}</dt><dd class="${result.passed ? 'success-text' : 'error-text'}"><code>${esc(result.actual)}</code></dd></div></dl>`;
}

function conversation(review, retry, sample, condition) {
  const exercise = currentExercise();
  const attempt = activeAttempt();
  return `<section class="conversation-pane pane"><div class="panel-top"><span>${icon('message')}${review ? 'Transcript' : retry ? 'Coach' : 'Interviewer'}${!review ? '<span class="status-dot" aria-hidden="true"></span>' : ''}</span><div class="actions"><span class="small muted">${review ? 'Fictional record' : state.input === 'voice' ? state.muted ? 'Muted · preview' : 'Voice preview' : 'Text preview'}</span>${state.input === 'voice' && !review ? button(state.muted ? 'Unmute' : 'Mute', 'mute', 'quiet small') : ''}<button class="icon-button" type="button" data-action="expand-conversation" aria-label="${state.conversation === 'expanded' ? 'Compact conversation' : 'Expand conversation'}" aria-expanded="${state.conversation === 'expanded'}">${icon('expand')}</button><button class="icon-button" type="button" data-action="collapse-conversation" aria-label="${state.conversation === 'collapsed' ? 'Show conversation' : 'Collapse conversation'}" aria-expanded="${state.conversation !== 'collapsed'}">${state.conversation === 'collapsed' ? '+' : '−'}</button></div></div>
  <div class="conversation-body" ${state.conversation === 'collapsed' ? 'hidden' : ''}><div class="messages" id="messages" tabindex="0" role="region" aria-label="Conversation messages"><div class="message"><div class="speaker">${sample ? 'Sample candidate' : 'Demo candidate'}<time>00:42</time></div><p>Does “first” mean the earliest matching position as I scan from left to right?</p></div><div class="message"><div class="speaker">Interviewer<time>00:49</time></div><p>Yes. ${exercise.lead}</p></div>${condition === 'missing' ? '<div class="message"><p>01:18 · Candidate explanation unavailable in this scene.</p></div>' : `<div class="message ${review && state.checkpoint === 'run' ? 'selected-message' : ''}"><div class="speaker">${sample ? 'Sample candidate' : 'Demo candidate'}<time>01:18</time></div><p>I’ll track what I’ve seen and stop when I find the first match.</p></div>`}${retry || attempt.assisted ? '<div class="message coach-message"><div class="speaker">Coach · guidance<time>Prepared reply</time></div><p>What happens immediately after finding a match? Compare continuing the loop with returning at that point.</p></div>' : ''}${!sample && !review ? messages.map((message) => `<div class="message"><div class="speaker">You · local preview</div><p>${esc(message)}</p></div>`).join('') : ''}</div>
  ${review ? `<div class="transcript-footer">${condition === 'audio' ? `${button(state.replaying ? 'Pause replay preview' : 'Play replay preview', 'replay', 'quiet small', 'play')}<label for="replay-position">Example audio position <output id="replay-time">${replayTime(state.replayPosition)}</output></label><input id="replay-position" type="range" min="0" max="266" value="${state.replayPosition}" aria-valuetext="${replayTime(state.replayPosition)}"><span>Playback controls only · no audio file. Checkpoint selection is separate.</span>` : condition === 'missing' ? 'Transcript incomplete · cause not assessed' : 'Text record only · spoken delivery not assessed'}</div>` : sample || retry ? `<div class="conversation-actions">${retry && !attempt.fixed ? button('Return immediately', 'repair', 'secondary small', 'code') : button('Ask for help', 'help', 'quiet small', 'message')}<span class="small muted">${sample ? 'Prepared sample' : 'Guided practice preview'}</span></div>` : `<form id="message-form" class="composer"><label class="sr-only" for="message">Message the interviewer</label><input id="message" value="${esc(typed)}" placeholder="Explain your approach…" autocomplete="off"><button type="submit" class="icon-button" aria-label="Send preview message">${icon('arrow')}</button></form><div class="composer-note"><span>Local text only. No AI is connected.</span>${messages.length ? button('New messages', 'latest-message', 'quiet small') : ''}${button('Ask for help', 'help', 'quiet small')}</div>`}</div></section>`;
}

function findings(condition) {
  const exercise = currentExercise();
  const disputed = condition === 'disputed' || activeAttempt().disputed;
  if (condition === 'pending' || condition === 'error') return `<div class="finding-head"><p class="eyebrow">Review ${condition === 'pending' ? 'pending' : 'unavailable'}</p><h2>${condition === 'pending' ? 'Your attempt is here.' : 'Your work is still here.'}</h2><p>${condition === 'pending' ? 'The review is being prepared in this scene. You can inspect the saved code and transcript, or return later.' : 'The review couldn’t be prepared. Your code and conversation are still available.'}</p><p class="small muted">Fictional processing state. No evaluation job is running.</p><div class="actions">${button(condition === 'pending' ? 'Show ready review' : 'Retry review preview', 'recover-review', 'primary')}${link('Return to sessions', 'sessions', 'quiet')}</div></div>`;
  if (condition === 'clear') return `<div class="finding-head"><p class="eyebrow">What the evidence supports</p><h2>No clear weakness to flag.</h2><p>The prepared code returns at the first qualifying event. Its shown cases pass.</p><div class="observation"><h3>Keep doing this</h3><p>Your explanation and implementation use the same stopping condition.</p></div><p>These observations describe this attempt. They don’t establish mastery or predict how another interview will go.</p>${link('Choose another problem', 'roadmap', 'primary', 'arrow')}</div>`;
  return `<div class="finding-head"><p class="eyebrow">A moment to revisit</p><h2>${condition === 'missing' ? 'The code keeps scanning.' : 'Your plan stops.<br>Your code keeps going.'}</h2><p class="finding-summary">${condition === 'missing' ? 'The code replaces the answer when another match appears. The transcript is incomplete, so the cause can’t be assessed.' : 'You described stopping at the first match. The implementation continues scanning and overwrites the answer.'}</p>
  <div class="evidence-link">${button('04:26 · Inspect test-run evidence', 'evidence', 'quiet', 'flag')}</div>
  <div class="observation"><h3>${icon('check')}Verified in the prepared example</h3><p>For <code>${esc(exercise.input)}</code>, this code returns <code>${exercise.actual}</code>. The expected result is <code>${exercise.expected}</code>.</p></div>
  <h3>${condition === 'missing' ? 'Not enough evidence' : 'What it may mean'}</h3><p>${condition === 'missing' ? 'No judgment about the candidate’s reasoning or communication is available from this incomplete record.' : 'The implementation differs from the stated plan. This may be an overlooked early return; it doesn’t establish conceptual confusion.'}</p>
  <div class="next-focus"><span class="eyebrow">Try next</span><p>Change what happens when the first match is found.</p>${disputed ? `${badge('Finding disputed')}<p class="small">This finding won’t drive suggested practice. Its original evidence stays visible.</p>${link('Choose another focus', 'roadmap', 'secondary')}` : `${button('Retry from here', 'start-retry', 'primary', 'arrow')}<p class="small muted">Fresh Coach practice from this checkpoint.</p>`}</div>
  ${button(disputed ? 'View correction' : 'Disagree with this feedback', 'disagree', 'quiet small')}${activeAttempt().assisted ? '<p class="small muted">Guidance was used. This is not independent performance.</p>' : ''}</div>`;
}

function complete() {
  const sample = isSample();
  const passed = route.params.get('state') === 'passed' || activeAttempt().fixed && activeAttempt().ran;
  return `<div class="completion"><p class="eyebrow">${sample ? 'Guided sample complete' : 'Checkpoint retry complete'}</p><h1>${passed ? 'A small change.<br>A different result.' : 'A useful place to pause.'}</h1><p class="intro">${passed ? 'Returning at the first match fixes the demonstrated case. You used guidance, so this is practice—not evidence of independent performance.' : 'This retry is saved as a fictional practice attempt. Finish the prepared repair to inspect a different result.'}</p><div class="comparison"><div><span class="small muted">Original checkpoint</span><code>answer = ${activeAttempt().problem === 'duplicate' ? 'value' : 'index'}</code><p>Kept scanning after a match</p></div>${icon('arrow')}<div><span class="small muted">${passed ? 'Guided repair' : 'Next possible change'}</span><code>return ${activeAttempt().problem === 'duplicate' ? 'value' : 'index'}</code><p>Stop at the first qualifying event</p></div></div><div class="actions">${sample ? link('Start my interview', 'setup', 'primary', 'arrow') : link('Explore related practice', 'related', 'primary', 'arrow')}${link('Revisit the review', `review${sourceQuery()}`, 'secondary')}</div><p class="small muted">${sample ? 'Nothing from this sample contributes to personal activity.' : 'Passing these cases does not establish lasting mastery.'}</p></div>`;
}
function related() {
  if (route.params.get('state') === 'empty') return `<h1>Related practice</h1>${emptyState('No matching exercise yet', 'There isn’t an authored follow-up for this moment. You can choose ordinary practice without treating it as a matched check.', link('Browse the roadmap', 'roadmap', 'primary') + link('Return to review', 'review', 'secondary'))}`;
  return `<a class="back-link" href="#complete">${icon('back')}Back to retry</a><div class="related-page"><p class="eyebrow">An optional next step</p><h1>Same decision.<br>A different problem.</h1><p class="intro">Practice stopping at the first qualifying event in a new setting.</p><section class="related-card"><div>${badge('Author-linked exercise')}<h2>First threshold alert</h2><p>Find the earliest reading above a threshold, rather than the earliest repeated tag.</p><div class="detail-note"><strong>Why it’s related</strong><p>Both tasks ask you to stop at the first match. This is an authored connection, not a claim that the exercises have equal difficulty.</p></div></div>${icon('code')}</section><fieldset class="familiar"><legend>Have you seen this problem before?</legend><label><input type="radio" name="familiar" value="no" checked>Not that I remember</label><label><input type="radio" name="familiar" value="yes">Yes, it’s familiar</label></fieldset><div class="actions">${link('Set up this practice', 'setup?problem=alert', 'primary', 'arrow')}${link('Finish for now', 'sessions', 'quiet')}</div><p id="familiar-note" class="small muted">Prior familiarity and any guidance will be noted in the product.</p></div>`;
}
function preferences() {
  return `<div class="page-title"><div><p class="eyebrow">Preferences</p><h1>Recording preferences</h1></div></div><div class="preferences-grid"><nav aria-label="Preference sections"><a class="selected" href="#preferences">Recording & data</a><a href="#system">Design & motion preview</a></nav><section class="preferences-content"><div class="notice">${icon('shield')}Nothing here accesses your microphone or uploads data. These controls preview the intended product choices.</div><h2>Voice and audio</h2><label class="setting-row"><span><strong>Use voice for interviews</strong><small>Live speech processing is separate from saving audio. Text is always available.</small></span><input type="checkbox" name="voice-pref" ${state.input === 'voice' ? 'checked' : ''}></label><label class="setting-row"><span><strong>Save audio for replay</strong><small>Optional audio alongside the transcript. Off by default.</small></span><input type="checkbox" name="audio-pref" ${state.audio ? 'checked' : ''}></label><h2>Session records</h2><p>Personal review needs the transcript, code checkpoints, run results, and feedback. The product’s retention policy must be defined before real recording begins.</p><div class="detail-note">No webcam analysis. No training-data collection. A typed session doesn’t assess spoken delivery.</div><h2>Export or remove a session</h2><div class="actions">${button('Export example record', 'export', 'secondary')}${button('Delete demo sessions', 'delete', 'danger')}${button('Explore screens', 'scenes', 'quiet')}</div><p class="small muted">Deletion affects this prototype tab’s demo history only.</p><h2 id="appearance">Motion and appearance</h2><label class="setting-row"><span><strong>Theme</strong></span><select name="theme" aria-label="Theme">${['dark', 'light', 'system'].map(value => `<option value="${value}" ${state.theme === value ? 'selected' : ''}>${value[0].toUpperCase() + value.slice(1)}</option>`).join('')}</select></label><label class="setting-row"><span><strong>Reduce motion in this preview</strong><small>Your operating-system preference is always respected.</small></span><input type="checkbox" name="reduce" ${state.reduce ? 'checked' : ''}></label></section></div>`;
}
function system() {
  return `<div class="page-title"><div><p class="eyebrow">Prototype foundation</p><h1>Graphite. Chalk. Annotation.</h1><p>A lit desk. Teal for action, amber for evidence, lilac for the coach.</p></div>${link('Explore the workspace', 'interview', 'secondary', 'arrow')}</div><section class="system-materials"><article class="plane"><h2>Working plane</h2><p>A top light and contact shadow bring the work forward.</p><div class="recess">Recess · code and evidence stay still</div></article><article class="plane-quiet"><h2>Quiet plane</h2><p>Conversation and supporting context.</p><div class="annotation">Annotation · a location, never a verdict</div></article><article class="float"><h2>Floating surface</h2><p>Dialogs and drawers carry the ambient shadow.</p>${button('Inspect floating surface', 'motion-dialog', 'secondary')}</article></section><section class="system-section"><div><h2>Color with a purpose</h2><p>Accent means action or selection. Error and success belong to specific results, never a person.</p></div><div class="swatches">${[['Canvas', 'canvas'], ['Surface', 'surface'], ['Raised', 'raised'], ['Accent', 'accent'], ['Success', 'success'], ['Error', 'error']].map(([label, token]) => `<div><span style="background:var(--${token})"></span><small>${label}</small></div>`).join('')}</div></section><section class="system-section"><div><h2>Readable at work</h2><p>Gabarito headings, Geist interface text, and Geist Mono code, with local platform fallbacks.</p></div><div><h2 class="type-specimen">Look closer. Try again.</h2><p>A review connects what you said with what your code did.</p><code class="type-code">return first_match</code><p class="small muted">Supporting text · revision 1 · 04:26</p></div></section><section class="system-section"><div><h2>Small, deliberate feedback</h2><p>Try pointer press and keyboard focus. Motion is removed for keyboard input and reduced-motion preferences.</p></div><div class="actions">${button('Primary action', 'specimen', 'primary')}${button('Secondary action', 'specimen', 'secondary')}${button('Open disclosure', 'motion-dialog', 'quiet')}</div></section><section class="system-section"><div><h2>Evidence, not verdicts</h2><p>State and uncertainty have words. A color is never the only explanation.</p></div><div class="actions">${badge('Review ready', 'accent')}${badge('Draft saved')}${badge('Finding disputed')}${badge('Runner unavailable', 'error')}</div></section><section class="system-section"><div><h2>Motion tokens</h2><p>No looping decoration, delayed results, or animated typing.</p></div><dl class="token-list"><div><dt>Feedback</dt><dd>200 ms · state feedback</dd></div><div><dt>Disclosure</dt><dd>350 ms entrance · 450 ms pane · 120 ms exit</dd></div><div><dt>Ease</dt><dd>Enter: cubic-bezier(.16, 1, .3, 1)</dd></div><div><dt>Pressed surface</dt><dd>1px travel · 150 ms · pointer only</dd></div></dl></section>`;
}

function render(navigation = false) {
  const focused = document.activeElement;
  const focusId = focused?.id;
  const focusAction = focused?.getAttribute('data-action');
  const messagesTop = document.querySelector('#messages')?.scrollTop;
  const problemTop = document.querySelector('.problem-scroll')?.scrollTop;
  const oldMap = document.querySelector('.map-scroll');
  if (oldMap) mapScroll = oldMap.scrollLeft;
  route = parseRoute(location.hash);
  document.documentElement.dataset.reduce = String(state.reduce);
  document.documentElement.dataset.theme = state.theme === 'system' ? (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark') : state.theme;
  if (route.page === 'personal') {
    if (drawer.open) drawer.close();
    navbarObserver.disconnect();
    roadmapObserver.disconnect();
    app.innerHTML = `<div class="app-shell"><div class="app-content"><div id="personal-app" aria-live="polite"></div>${pageFooter()}</div></div>`;
    document.title = 'Coursay';
    mountPersonal(app.querySelector('#personal-app'));
    return;
  }
  if (isSample()) { state.sampleRoute = location.hash.slice(1) || 'sample'; persist(); }
  const requestedProblem = route.params.get('problem');
  if (requestedProblem && ['tags', 'alert', 'runs'].includes(requestedProblem) && requestedProblem !== state.personal.problem && route.page !== 'setup') state.personal = initialAttempt(requestedProblem);
  if (route.page === 'review' && !isSample()) { state.reviewOpened = true; persist(); }
  const screens = { profile, welcome, roadmap, sessions, setup, sample: workspace, interview: workspace, review: workspace, retry: workspace, complete, related, preferences, system, terms: () => legalScreen('terms'), privacy: () => legalScreen('privacy'), cookies: () => legalScreen('cookies') };
  const workspacePage = ['sample', 'interview', 'review', 'retry'].includes(route.page);
  if (drawer.open && (route.page !== 'roadmap' || !getPracticeLeaf(route))) drawer.close();
  navbarObserver.disconnect();
  roadmapObserver.disconnect();
  app.innerHTML = chrome((screens[route.page] ?? welcome)(), workspacePage);
  if (navigation) document.querySelectorAll('.home-layout > section, .profile-panel, .session-row, .setup-grid > *, .preferences-content').forEach((element, index) => { element.classList.add('enter'); element.style.setProperty('--i', index); });
  document.querySelector('#main').classList.toggle('roadmap-main', route.page === 'roadmap');
  const graph = document.querySelector('.road-grid');
  if (graph) { positionRoadmapConnections(); roadmapObserver.observe(graph); }
  navbarObserver.observe(document.querySelector('.floating-nav'));
  navbarObserver.observe(document.querySelector('.page-footer'));
  measureNavbar();
  const sessionFilter = route.params.get('filter');
  if (route.page === 'sessions' && sessionFilter && sessionFilter !== 'All') document.querySelectorAll('.session-row').forEach(row => { row.hidden = row.querySelector('.badge')?.textContent !== sessionFilter; });
  document.title = `${document.querySelector('h1')?.textContent ?? 'Welcome'} · Coursay`;
  document.querySelector('.map-scroll')?.scrollTo({ left: mapScroll });
  syncProblemDrawer();
  if (navigation && !drawer.open) {
    const returnNode = route.params.get('return');
    const target = returnNode ? document.getElementById(`leaf-${returnNode}`) ?? document.getElementById(`topic-${returnNode}`) : document.querySelector('#topic-title') ?? document.querySelector('h1');
    if (target?.tagName !== 'A') target?.setAttribute('tabindex', '-1');
    target?.focus({ preventScroll: true });
    if (!workspacePage && route.page !== 'roadmap') window.scrollTo(0, 0);
  } else {
    if (focusId) document.getElementById(focusId)?.focus({ preventScroll: true });
    else if (focusAction) document.querySelector(`[data-action="${focusAction}"]`)?.focus({ preventScroll: true });
    if (messagesTop !== undefined) document.querySelector('#messages')?.scrollTo(0, messagesTop);
    if (problemTop !== undefined) document.querySelector('.problem-scroll')?.scrollTo(0, problemTop);
  }
  bindSplitter();
}
function showDialog(title, content, trigger = document.activeElement) {
  lastTrigger = trigger;
  dialog.innerHTML = `<div class="dialog-heading"><h2 id="dialog-title">${title}</h2><button class="icon-button" type="button" data-action="close-dialog" aria-label="Close dialog">${icon('close')}</button></div>${content}`;
  dialog.showModal();
}
function closeDialog() { dialog.close(); }
dialog.addEventListener('close', () => {
  if (lastTrigger?.isConnected) lastTrigger.focus({ preventScroll: true });
  else document.querySelector('h1')?.focus({ preventScroll: true });
});
function scenePicker() {
  showDialog('Explore the prototype', `<p>Jump to any screen or recovery state. All sessions, code, and results are fictional.</p><div class="scene-grid">${scenes.map(([title, path, description]) => `<a href="#${path}" class="scene-link"><strong>${title}</strong><small>${description}</small>${icon('arrow')}</a>`).join('')}</div><div class="dialog-footer">${button('Reset demo history', 'reset', 'quiet')}<span class="small muted">This resets only the prototype’s fixture state.</span></div>`);
}
function handleAction(action) {
  if (action.startsWith('thread-stage-')) {
    const stage = Number(action.slice(-1));
    if (document.querySelector('.v2-home') && [0, 1, 2].includes(stage)) { state.homeStage = stage; render(); return; }
    const track = document.querySelector('.stage-track');
    if (!track || ![0, 1, 2].includes(stage)) return;
    track.dataset.stage = stage;
    track.querySelectorAll('button').forEach((item, index) => { item.classList.toggle('selected', index === stage); item.setAttribute('aria-pressed', String(index === stage)); });
    document.querySelectorAll('.thread-steps li').forEach((item, index) => { if (index === stage) item.setAttribute('aria-current', 'step'); else item.removeAttribute('aria-current'); });
    return;
  }
  if (action.startsWith('case-')) { state.caseIndex = Number(action.slice(5)); render(); return; }
  if (action.startsWith('pane-')) { state.mobilePane = action.slice(5); render(); return; }
  if (action.startsWith('left-')) { state.leftTab = action.slice(5); render(); return; }
  switch (action) {
    case 'close-problems': closeProblems(); break;
    case 'pan-left': case 'pan-right': { const map = document.querySelector('.map-scroll'); map?.scrollBy({ left: map.clientWidth * (action === 'pan-left' ? -1 : 1) }); break; }
    case 'edit-profile': showDialog('Edit profile', `<form id="profile-form"><label>Display name<input name="profile-name" required value="${esc(state.profile?.name || 'Alex')}"></label><label>Bio<textarea name="profile-bio" rows="3">${esc(state.profile?.bio || '')}</textarea></label><p class="small muted">Changes stay in this preview until you reload.</p><div class="actions"><button type="submit" class="button primary">Save profile</button>${button('Cancel', 'close-dialog', 'secondary')}</div></form>`); break;
    case 'scenes': scenePicker(); break;
    case 'restart-sample': state.sample = initialAttempt('duplicate'); state.retry = null; state.sampleRoute = 'sample'; state.guide = true; persist(); go('sample'); break;
    case 'close-dialog': closeDialog(); break;
    case 'map-help': showDialog('Choose a direction, not a score', '<p>Connections suggest a learning order. They never lock a topic.</p><p>Select a topic to see its exercises. Use the list if you prefer a linear view. Recorded activity means practice took place—not mastery.</p><p>The prototype catalog is illustrative, with original prepared exercises.</p>'); break;
    case 'use-text': state.input = 'text'; go('setup'); break;
    case 'mic-check': go('setup?state=mic'); break;
    case 'replay': state.replaying = !state.replaying; render(); notify('Playback state preview only. No audio file is loaded.'); break;
    case 'latest-message': document.querySelector('#messages')?.scrollTo({ top: document.querySelector('#messages').scrollHeight }); break;
    case 'hide-guide': state.guide = false; render(); break;
    case 'expand-conversation': state.conversation = state.conversation === 'expanded' ? 'compact' : 'expanded'; render(); break;
    case 'collapse-conversation': state.conversation = state.conversation === 'collapsed' ? 'compact' : 'collapsed'; render(); break;
    case 'mute': state.muted = !state.muted; render(); notify(state.muted ? 'Muted in the preview. No microphone is connected.' : 'Voice preview unmuted. No microphone is connected.'); break;
    case 'run': mutateAttempt('run'); render(); notify('Simulated result available for the prepared code.'); break;
    case 'repair': mutateAttempt('repair'); render(); notify('Prepared early-return repair applied. Run its tests to inspect the result.'); break;
    case 'help': showDialog('Would you like a hint?', `<p>I can point out what happens after a match, without replacing the entire approach.</p><p class="small muted">Accepting help keeps this attempt open. Guidance is identified in the review. This is a prepared reply.</p><div class="actions">${button('Keep thinking', 'close-dialog', 'secondary')}${button('Show the hint', 'accept-help', 'primary')}</div>`); break;
    case 'accept-help': closeDialog(); mutateAttempt('help'); render(); notify('Prepared hint added. The attempt continues with assistance noted.'); break;
    case 'finish': mutateAttempt('finish'); state.leftTab = 'findings'; state.checkpoint = 'run'; state.reviewState = ''; go(`review${sourceQuery()}`); break;
    case 'start-retry': state.retry = { ...initialAttempt(activeAttempt().problem), assisted: true }; go(`retry${sourceQuery()}`); break;
    case 'finish-retry': mutateAttempt('finish'); go(`complete${sourceQuery()}`); break;
    case 'save-exit': {
      mutateAttempt('save'); const saved = persist(); go(isSample() ? 'welcome' : 'sessions'); notify(saved ? 'Prepared position saved in this prototype tab. No personal content was saved.' : 'Storage is unavailable. This prepared state will last only while the page stays open.'); break;
    }
    case 'evidence': state.checkpoint = 'run'; state.caseIndex = 2; render(); document.querySelector('.line-marker')?.classList.add('locate-marker'); document.querySelector('.evidence-line')?.scrollIntoView({ block: 'nearest' }); notify('Test-run checkpoint, related transcript, and matching result selected.'); break;
    case 'disagree': showDialog('Disagree with this feedback', `<p>The original evidence stays visible. A disputed finding won’t drive suggested practice.</p><label for="correction">What would you change? <span class="muted">Optional · not saved</span></label><textarea id="correction" placeholder="The transcript missed an explanation…"></textarea><div class="actions">${button('Cancel', 'close-dialog', 'secondary')}${button('Mark example disputed', 'confirm-dispute', 'primary')}</div><p class="small muted">No real dispute is submitted and no human response is promised.</p>`); break;
    case 'confirm-dispute': closeDialog(); mutateAttempt('dispute'); render(); notify('Example finding marked disputed. Original evidence remains available.'); break;
    case 'recover-review': state.reviewState = ''; go(`review${sourceQuery()}`); break;
    case 'recover': go('interview'); break;
    case 'offline-text': state.input = 'text'; go('interview'); break;
    case 'recover-run': mutateAttempt('run'); go('interview'); break;
    case 'layout': showDialog('Workspace layout', `<label for="pane-width">Problem column width <span class="muted">${state.layout}%</span></label><input type="range" id="pane-width" min="30" max="60" value="${state.layout}"><p class="small muted">The range keeps both example panes readable on the desktop layout.</p><label for="code-size">Code text size</label><select id="code-size">${[[14, 'Standard'], [17, 'Larger'], [20, 'Largest']].map(([value, label]) => `<option value="${value}" ${state.codeSize === value ? 'selected' : ''}>${label}</option>`).join('')}</select><div class="actions">${button('Reset layout', 'reset-layout', 'secondary')}${button('Apply layout', 'apply-layout', 'primary')}</div>`); break;
    case 'reset-layout': state.layout = 40; state.codeSize = 14; closeDialog(); render(); break;
    case 'apply-layout': state.layout = Number(document.querySelector('#pane-width').value); state.codeSize = Number(document.querySelector('#code-size').value); closeDialog(); render(); break;
    case 'export': exportRecord(); break;
    case 'delete': showDialog('Delete demo sessions?', `<p>This removes the fictional session history in this prototype tab. It does not delete real account data. You can restore the fixtures from Explore screens.</p><div class="actions">${button('Cancel', 'close-dialog', 'secondary')}${button('Delete demo sessions', 'confirm-delete', 'danger')}</div>`); dialog.querySelector('[data-action="close-dialog"]').focus(); break;
    case 'confirm-delete': state.historyDeleted = true; state.reviewOpened = false; state.personal = initialAttempt(); state.retry = null; persist(); closeDialog(); render(); notify('Demo sessions removed. Restore them from Explore screens.'); break;
    case 'reset': state.personal = initialAttempt(); state.sample = initialAttempt('duplicate'); state.retry = null; state.sampleRoute = 'sample'; state.historyDeleted = false; state.reviewOpened = false; messages = []; typed = ''; persist(); closeDialog(); go('welcome'); break;
    case 'specimen': notify('Preview action selected. No external action was performed.'); break;
    case 'motion-dialog': showDialog('A quiet disclosure', '<p>This dialog uses a short opacity and transform transition. Keyboard navigation and reduced motion open it immediately.</p><p>The browser handles focus containment and Escape. Closing returns you to the trigger.</p>'); break;
    default: break;
  }
}
function exportRecord() {
  const blob = new Blob([JSON.stringify({ fictional: true, kind: 'prototype-fixture', attempt: state.personal, code: exercises[state.personal.problem].original }, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const download = document.createElement('a');
  download.href = url; download.download = 'interview-trainer-example.json'; download.click(); URL.revokeObjectURL(url);
  notify('Fictional example record exported. No personal transcript included.');
}
function bindSplitter() {
  const splitter = document.querySelector('[data-splitter]');
  if (!splitter) return;
  splitter.addEventListener('keydown', (event) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    state.layout = event.key === 'Home' ? 30 : event.key === 'End' ? 60 : Math.min(60, Math.max(30, state.layout + (event.key === 'ArrowLeft' ? -1 : 1)));
    document.querySelector('.workspace').style.setProperty('--left-width', `${state.layout}%`);
    splitter.setAttribute('aria-valuenow', String(state.layout));
  });
  splitter.addEventListener('pointerdown', (event) => {
    if (!event.isPrimary) return;
    splitter.setPointerCapture(event.pointerId);
    const move = (pointer) => {
      const bounds = document.querySelector('.workspace').getBoundingClientRect();
      state.layout = Math.min(60, Math.max(30, Math.round((pointer.clientX - bounds.left) / bounds.width * 100)));
      document.querySelector('.workspace').style.setProperty('--left-width', `${state.layout}%`);
      splitter.setAttribute('aria-valuenow', String(state.layout));
    };
    const end = () => { splitter.removeEventListener('pointermove', move); };
    splitter.addEventListener('pointermove', move);
    splitter.addEventListener('pointerup', end, { once: true });
    splitter.addEventListener('pointercancel', end, { once: true });
  });
}
document.addEventListener('pointerdown', () => { document.documentElement.dataset.input = 'pointer'; });
document.addEventListener('keydown', (event) => {
  document.documentElement.dataset.input = 'keyboard';
  const tabList = event.target.closest('[role="tablist"]');
  if (tabList && ['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
    event.preventDefault();
    const buttons = [...tabList.querySelectorAll('[role="tab"]')];
    const index = buttons.indexOf(event.target);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length;
    const nextId = buttons[next].id;
    handleAction(buttons[next].dataset.action);
    document.getElementById(nextId)?.focus();
  }
});
document.addEventListener('click', (event) => {
  const action = event.target.closest('[data-action]');
  if (action) handleAction(action.dataset.action);
  const anchor = event.target.closest('a[href^="#"]');
  if (anchor?.getAttribute('href') === '#setup') {
    event.preventDefault();
    go('welcome');
    return;
  }
  if (anchor && drawer.contains(anchor)) origin = location.hash.slice(1);
  if (anchor && dialog.open) {
    if (anchor.classList.contains('scene-link')) {
      state.leftTab = 'findings'; state.checkpoint = 'run'; state.reviewState = ''; state.retry = null; state.guide = true;
      if (anchor.getAttribute('href') === '#complete') state.retry = { ...initialAttempt(), fixed: true, ran: true, assisted: true, finished: true };
    }
    closeDialog();
  }
  if (anchor?.getAttribute('href') === '#main') { event.preventDefault(); document.querySelector('#main').focus(); }
  if (anchor?.getAttribute('href').startsWith('#setup') && route.page === 'roadmap') origin = location.hash.slice(1);
});
document.addEventListener('input', (event) => {
  if (event.target.id === 'message') typed = event.target.value;
  if (event.target.id === 'replay-position') { state.replayPosition = Number(event.target.value); document.querySelector('#replay-time').textContent = replayTime(state.replayPosition); event.target.setAttribute('aria-valuetext', replayTime(state.replayPosition)); }
  if (event.target.id === 'concern') state.concern = event.target.value;
  if (event.target.id === 'studied') state.studied = event.target.value;
});
document.addEventListener('change', (event) => {
  const input = event.target;
  if (input.name === 'theme') { state[input.name] = input.value; persist(); render(); }
  if (input.name === 'input') { state.input = input.value; render(); }
  if (input.name === 'goal') state.goal = input.value;
  if (['audio', 'audio-pref'].includes(input.name)) state.audio = input.checked;
  if (input.name === 'consent') { state.consent = input.checked; document.querySelector('#consent-error').hidden = input.checked; input.removeAttribute('aria-invalid'); }
  if (input.name === 'voice-pref') state.input = input.checked ? 'voice' : 'text';
  if (input.name === 'reduce') { state.reduce = input.checked; document.documentElement.dataset.reduce = String(state.reduce); persist(); notify(state.reduce ? 'Reduced motion enabled.' : 'Operating-system motion preference is used.'); }
  if (input.id === 'checkpoint') { state.checkpoint = input.value; render(); notify('Saved checkpoint changed. Code and results now match the selected checkpoint.'); }
  if (input.name === 'familiar') document.querySelector('#familiar-note').textContent = input.value === 'yes' ? 'Familiarity noted for this preview. This won’t be described as unseen work.' : 'Prior familiarity and any guidance will be noted in the product.';
});
document.addEventListener('submit', (event) => {
  event.preventDefault();
  if (event.target.id === 'profile-form') {
    const form = new FormData(event.target);
    state.profile = { name: String(form.get('profile-name')).trim() || 'Alex', bio: String(form.get('profile-bio')).trim() };
    closeDialog(); render(); notify('Profile updated for this preview.');
  }
  if (event.target.id === 'setup-form') {
    if (!state.consent) { const consent = event.target.querySelector('[name="consent"]'); consent.setAttribute('aria-invalid', 'true'); consent.setAttribute('aria-describedby', 'consent-error'); consent.focus(); return; }
    const problem = route.params.get('problem') ?? state.personal.problem;
    state.personal = initialAttempt(['tags', 'alert', 'runs'].includes(problem) ? problem : 'tags');
    state.historyDeleted = false; messages = []; typed = ''; state.reviewState = ''; persist(); go('interview');
  }
  if (event.target.id === 'message-form' && typed.trim()) {
    messages.push(typed.trim()); typed = ''; render(); document.querySelector('#message')?.focus();
    notify('Preview message displayed locally. No AI received it.');
  }
});
window.addEventListener('hashchange', () => render(true));
render();
startBrandMotion();

matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => { if (state.theme === 'system') render(); });
