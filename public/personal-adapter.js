import { accountMenu } from './account-menu.js';
import { brandWordmark, beginBrandLoading, setBrandVoice } from './brand.js';
import { createDeepgramVoiceSession, THINKING_MODEL, VOICE_PROVIDER } from "./voice-agent.js";
import { createAttemptSession } from "./attempt-session.js";
import { measure } from "./measurement.js";

const personalOutcome = (name, authority = "server") => measure(name, { surface: "personal", activity: "personal", authority });
const openedReviews = new Set();

const escapeHtml = (value) => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");

async function api(path, options = {}) {
  const finishLoading = beginBrandLoading();
  try {
    const response = await fetch(path, {
      credentials: "same-origin",
      headers: options.body ? { "content-type": "application/json" } : undefined,
      ...options,
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
    const payload = await response.json().catch(() => ({}));
    // App routes send `error`; Better Auth sends `message` (e.g. "Password too short").
    if (!response.ok) throw new Error(payload.error || payload.message || "The request could not be completed.");
    return payload;
  } finally {
    finishLoading();
  }
}

function authForm(state) {
  if (state.resetToken) return `<form id="personal-reset-form"><h2>Choose a new password</h2><label for="reset-password">New password</label><input id="reset-password" name="password" type="password" autocomplete="new-password" minlength="8" required><p class="small muted">Use at least 8 characters. Other signed-in devices are signed out.</p><button class="button primary" type="submit">Save new password</button></form>`;
  if (state.authView === "forgot") return `<form id="personal-forgot-form"><h2>Reset your password</h2><p class="small muted">Enter the email for your account. We send a reset link that works for one hour.</p><label for="forgot-email">Email</label><input id="forgot-email" name="email" type="email" autocomplete="email" required><div class="actions"><button class="button primary" type="submit">Send reset link</button><button class="button quiet" type="button" data-auth-view="sign-in">Back to sign in</button></div></form>`;
  return `<div class="segmented" aria-label="Authentication"><button class="button selected" type="button" data-auth-view="sign-in" aria-pressed="true">Sign in</button><button class="button" type="button" data-auth-view="sign-up" aria-pressed="false">Create account</button></div><form id="personal-auth-form"><div data-signup-name hidden><label for="auth-name">Display name</label><input id="auth-name" name="name" autocomplete="name"></div><label for="auth-email">Email</label><input id="auth-email" name="email" type="email" autocomplete="email" required><label for="auth-password">Password</label><input id="auth-password" name="password" type="password" autocomplete="current-password" required><p class="small muted">Email and password are the only MVP login method.</p><button class="button primary" type="submit">Sign in</button>${state.emailEnabled ? `<button class="button quiet small" type="button" data-auth-view="forgot">Forgot password?</button>` : ""}</form>`;
}

function authMarkup(state, message = "") {
  return `<main id="main" class="page-main personal-entry"><section class="empty-state"><span class="eyebrow">Practice, inspect, retry</span><h1>Keep the evidence<br>with the work.</h1><p>Use the guided sample without an account, or sign in to record a personal Python practice attempt.</p><div class="actions"><a class="button secondary" href="#sample"><span>Try the guided sample</span></a></div>${message ? `<p class="form-error" role="status">${escapeHtml(message)}</p>` : ""}</section><section class="setup-form auth-card">${authForm(state)}</section></main>`;
}

function collectionUnavailableMarkup() {
  return `<main id="main" class="page-main personal-entry"><section class="empty-state"><span class="eyebrow">Personal practice unavailable</span><h1>Records are not being collected.</h1><p>The owner has not enabled the approved personal-data collection policy for this deployment. Nothing is saved from this screen.</p><div class="actions"><a class="button secondary" href="#sample">Try the guided sample</a></div></section></main>`;
}

function dashboardMarkup(state) {
  const attempts = state.attempts.map((attempt) => `<li class="activity-line"><span class="activity-symbol">↳</span><span><strong>${escapeHtml(attempt.title)}</strong><small>${escapeHtml(attempt.mode)} · ${escapeHtml(attempt.status)}${attempt.review_status ? ` · review ${escapeHtml(attempt.review_status)}` : ""}</small></span><button class="button quiet small" type="button" data-open-attempt="${escapeHtml(attempt.id)}">Open</button></li>`).join("");
  const filter = state.catalogFilter;
  const matching = state.catalog.filter((problem) => (!filter.topic || problem.topic === filter.topic) && (!filter.difficulty || problem.difficulty === filter.difficulty));
  const option = (value, selected) => `<option value="${escapeHtml(value)}" ${value === selected ? "selected" : ""}>${escapeHtml(value)}</option>`;
  const topics = [...new Set(state.catalog.map((problem) => problem.topic))].sort();
  const filters = `<div class="actions catalog-filters"><label>Topic <select data-catalog-filter="topic"><option value="">All topics</option>${topics.map((topic) => option(topic, filter.topic)).join("")}</select></label><label>Difficulty <select data-catalog-filter="difficulty"><option value="">Any difficulty</option>${["Easy", "Medium", "Hard"].map((level) => option(level, filter.difficulty)).join("")}</select></label><span class="small muted" role="status">${matching.length} of ${state.catalog.length} problems</span></div>`;
  const problems = matching.slice(0, filter.limit).map((problem) => `<li><strong>${escapeHtml(problem.title)}</strong><span>${escapeHtml(problem.topic)} · ${escapeHtml(problem.difficulty)}</span><button class="button secondary small" type="button" data-start-problem="${escapeHtml(problem.id)}">Set up practice</button></li>`).join("");
  return `<main id="main" class="page-main"><section class="focus-work"><div class="focus-top"><span class="eyebrow">Your practice</span><span class="badge accent">Signed in</span></div><div class="focus-body"><p class="small">Python · English</p><h1>Start with the work.<br>Keep the evidence.</h1><p>Personal attempts preserve your code, exact test results, and text conversation. The guided sample remains separate.</p><div class="actions"><button class="button primary" type="button" data-personal-page="catalog">Choose a problem</button><a class="button quiet" href="#sample">Explore the sample</a></div></div></section><section class="home-history"><div class="section-heading"><h2>Recent sessions</h2></div>${attempts ? `<ol class="session-table">${attempts}</ol>${state.historyMore ? `<button class="button quiet" data-more-attempts>Load more sessions</button>` : ""}` : `<p class="empty-inline">Nothing recorded yet. Choose an authored problem when you are ready.</p>`}</section><section class="home-route"><div class="section-heading"><h2>Available practice</h2><button class="button quiet small" type="button" data-personal-page="catalog">Open roadmap</button></div>${filters}<ol class="drawer-problems">${problems}</ol>${matching.length > filter.limit ? `<button class="button quiet" type="button" data-more-problems>Show more problems</button>` : ""}</section></main>`;
}

function setupMarkup(state, problem) {
  const voiceChoice = state.voiceEnabled
    ? `<label class="choice"><input type="radio" name="inputMode" value="voice" checked><span>Voice<small>Deepgram listens and speaks; ${escapeHtml(state.thinkingModel)} thinks.</small></span></label>`
    : `<label class="choice"><input type="radio" name="inputMode" value="voice" disabled><span>Voice<small>Add the server-side Deepgram key to enable it.</small></span></label>`;
  return `<main id="main" class="page-main"><button class="back-link" type="button" data-personal-page="home">← Back to home</button><div class="setup-grid"><section><p class="eyebrow">Personal setup</p><h1>Make room to think.</h1><p class="intro">Voice is the primary interview path when Deepgram is configured. Text remains available when speaking is not practical.</p><div class="setup-problem"><span aria-hidden="true">⌘</span><div><span class="small muted">Selected problem</span><h2>${escapeHtml(problem.title)}</h2><p>${escapeHtml(problem.topic)} · Python · English</p></div></div><p class="problem-prompt">${escapeHtml(problem.prompt)}</p></section><form id="personal-setup-form" class="setup-form"><h2>Session preferences</h2><input type="hidden" name="problemId" value="${escapeHtml(problem.id)}"><label for="practice-goal">What are you preparing for?</label><input id="practice-goal" name="practiceGoal" value="Coding interviews" required><label for="studied-topics">Topics you have studied</label><input id="studied-topics" name="studiedTopics" autocomplete="off"><label for="concern">Anything you want to work on? <span class="muted">Optional</span></label><input id="concern" name="concern" autocomplete="off"><fieldset><legend>Input</legend><div class="choice-pair">${voiceChoice}<label class="choice"><input type="radio" name="inputMode" value="text" ${state.voiceEnabled ? "" : "checked"}><span>Text<small>Type the conversation without microphone access.</small></span></label></div></fieldset><fieldset><legend>Practice mode</legend><div class="choice-pair"><label class="choice"><input type="radio" name="mode" value="mock" checked><span>Mock<small>Neutral clarification and requested help.</small></span></label><label class="choice"><input type="radio" name="mode" value="coach"><span>Coach<small>Requested guidance is recorded.</small></span></label></div></fieldset><div class="notice">Voice streams audio to Deepgram for transcription and spoken replies. Session transcripts are stored here; raw audio is not retained.</div><label class="check-row"><input type="checkbox" name="consent" required><span>Allow Deepgram processing plus transcript, code-checkpoint, and test-evidence storage for this review.<small>Without personal session records, use the guided sample instead.</small></span></label><div class="actions"><button class="button primary" type="submit">Start interview</button><a class="button quiet" href="#sample">Use the sample instead</a></div></form></div></main>`;
}

// Show JSON test values the way Python prints them.
function pythonValue(value) {
  if (value === null || value === undefined) return "None";
  if (value === true) return "True";
  if (value === false) return "False";
  if (Array.isArray(value)) return `[${value.map(pythonValue).join(", ")}]`;
  if (typeof value === "object") return `{${Object.entries(value).map(([key, item]) => `${JSON.stringify(key)}: ${pythonValue(item)}`).join(", ")}}`;
  return typeof value === "string" ? JSON.stringify(value) : String(value);
}

function testResultsMarkup(detail) {
  const tests = detail.visibleTests ?? [];
  const call = (test) => `${detail.problem.entry_point}(${(test?.input_data?.args ?? []).map(pythonValue).join(", ")})`;
  const latest = detail.runs.at(-1);
  if (!latest) {
    const pending = tests.map((test) => `<li class="test-case"><code>${escapeHtml(call(test))}</code><span class="small muted">Expected <code>${escapeHtml(pythonValue(test.expected_output))}</code></span></li>`).join("");
    return `<p class="small muted">Run the visible tests to create an immutable checkpoint.</p><ol class="test-cases">${pending}</ol>`;
  }
  const byId = new Map(tests.map((test) => [test.id, test]));
  const cases = (latest.test_results ?? []).map((result) => {
    const test = byId.get(result.testId);
    const actual = Object.hasOwn(result, "actualOutput") ? ` · got <code>${escapeHtml(pythonValue(result.actualOutput))}</code>` : "";
    return `<li class="test-case ${escapeHtml(result.outcome)}"><strong>${escapeHtml(result.outcome)}</strong> <code>${escapeHtml(call(test))}</code><span class="small">Expected <code>${escapeHtml(pythonValue(test?.expected_output))}</code>${actual}</span>${result.error ? `<pre>${escapeHtml(result.error)}</pre>` : ""}</li>`;
  }).join("");
  const output = [["stdout", latest.stdout], ["stderr", latest.stderr]].filter(([, text]) => text).map(([name, text]) => `<details><summary>${name}</summary><pre>${escapeHtml(text)}</pre></details>`).join("");
  const history = detail.runs.length > 1 ? `<p class="small muted">${detail.runs.length} runs recorded; showing the latest.</p>` : "";
  return `<p role="status"><strong>${escapeHtml(latest.status)}</strong> · ${escapeHtml(latest.tests_passed)} passed, ${escapeHtml(latest.tests_failed)} failed${latest.runner_error ? ` · ${escapeHtml(latest.runner_error)}` : ""}</p><ol class="test-cases">${cases}</ol>${output}${history}`;
}

// The Submission check of a completed Attempt (CONTEXT.md). Unavailable never shows a count.
function submissionCheckSentence(check) {
  if (check?.state === "checked") return `Submission check: passed ${check.passed} of ${check.total} hidden tests.`;
  if (check?.state === "unavailable") return "The Submission check could not run because the isolated runner was unavailable. Your Submission and its Review are unaffected.";
  if (check?.state === "no hidden tests") return "This Problem has no hidden tests, so no Submission check ran.";
  return "";
}

function submissionCheckMarkup(check) {
  if (!check) return "";
  const failures = check.state === "checked" ? Object.entries(check.failures) : [];
  const list = failures.length ? `<ul class="submission-failures">${failures.map(([category, count]) => `<li>${escapeHtml(category)}: ${escapeHtml(count)} test${count === 1 ? "" : "s"}</li>`).join("")}</ul>` : "";
  const limit = check.state === "checked" ? `<p class="small muted">Hidden tests try other inputs. Passing them all does not prove the solution correct.</p>` : "";
  return `<div class="submission-check" role="group" aria-label="Submission check"><p><strong>${escapeHtml(submissionCheckSentence(check))}</strong></p>${list}${limit}</div>`;
}

function workspaceMarkup(state) {
  const detail = state.attempt;
  const problem = detail.problem;
  const transcript = detail.transcripts.map((segment) => `<div class="message"><div class="speaker">${escapeHtml(segment.speaker)}<time>${escapeHtml(segment.end_offset_ms)} ms</time></div><p>${escapeHtml(segment.text)}</p></div>`).join("") || `<p class="small muted">No conversation messages recorded yet.</p>`;
  const runs = testResultsMarkup(detail);
  const review = detail.review ? `<p class="small">Review: <strong>${escapeHtml(detail.review.status)}</strong>${detail.review.failure_reason ? ` · ${escapeHtml(detail.review.failure_reason)}` : ""} <button class="button quiet small" type="button" data-open-review>Inspect review</button></p>` : "";
  const disabled = detail.attempt.status === "completed" ? "disabled" : "";
  const isVoice = detail.attempt.input_mode === "voice";
  const voiceControl = isVoice ? `<span id="voice-status" class="small muted" role="status">Voice ready</span><button class="button primary small" type="button" data-voice-toggle ${disabled}>Start voice</button>` : "";
  return `<main id="main" class="workspace-main personal-workspace"><div class="session-header"><div class="actions"><button class="button quiet small" type="button" data-personal-page="sessions">← Sessions</button><h1>${escapeHtml(problem.title)}</h1><span class="badge">${escapeHtml(detail.attempt.mode)} · ${escapeHtml(detail.attempt.status)}</span></div><div class="actions"><span class="small muted">${isVoice ? "Deepgram voice" : "Text"} evidence · revision ${escapeHtml(detail.attempt.draft_revision)}</span><button class="button quiet small" type="button" data-save-draft ${disabled}>Save & exit</button><button class="button secondary small" type="button" data-finish ${disabled}>Finish interview</button></div></div><div class="workspace"><div class="left-column"><section class="problem-pane pane"><div class="panel-top"><span>Problem</span><span class="small muted">Original authored revision</span></div><div class="problem-scroll"><p class="problem-prompt">${escapeHtml(problem.prompt)}</p><p class="small muted">Entry point: <code>${escapeHtml(problem.entry_point)}</code></p></div></section><section class="conversation-pane pane"><div class="panel-top"><span>Conversation</span><div class="actions">${voiceControl}<button class="button quiet small" type="button" data-help ${disabled}>Request help</button></div></div><div class="conversation-body"><div class="messages" tabindex="0" role="region" aria-label="Recorded conversation">${transcript}</div><form id="personal-message-form" class="composer"><label class="sr-only" for="personal-message">Message the interviewer</label><input id="personal-message" name="message" placeholder="${isVoice ? "Speak, or type while voice is active…" : "Explain your approach…"}" autocomplete="off" ${disabled}><button class="icon-button" type="submit" aria-label="Send message" ${disabled}>→</button></form><p class="composer-note">${isVoice ? `Deepgram handles listening and speech. ${escapeHtml(state.thinkingModel)} produces the interviewer response. Raw audio is not saved.` : "Messages are stored as text evidence."}</p></div></section></div><div class="right-column"><section class="editor-pane pane"><div class="panel-top"><span>Code</span><div class="actions"><span class="small muted">Python</span><button class="button primary small" type="button" data-run ${disabled}>Run visible tests</button></div></div><label class="sr-only" for="personal-code">Python source code</label><textarea id="personal-code" class="code-editor" spellcheck="false" ${disabled}>${escapeHtml(detail.attempt.draft_source)}</textarea></section><section class="tests-pane pane"><div class="panel-top"><span>Tests / results</span></div><div class="test-body" tabindex="0" role="region" aria-label="Test results">${submissionCheckMarkup(detail.submissionCheck)}${runs}${review}</div></section></div></div>${state.attempt.hasMore ? `<button class="button quiet" data-more-evidence>Load more evidence</button>` : ""}</main>`;
}

function reviewMarkup(state) {
  const review = state.review?.review;
  const findings = state.review?.findings ?? [];
  const evidence = (finding) => (finding.evidence ?? []).map((item) => `<li><code>${escapeHtml(item.eventId)}</code>${item.locator ? ` · ${escapeHtml(JSON.stringify(item.locator))}` : ""}</li>`).join("") || "<li>No evidence references were published.</li>";
  return `<main id="main" class="page-main"><button class="back-link" type="button" data-personal-page="workspace">← Back to attempt</button><section class="finding-head"><p class="eyebrow">Recorded review</p><h1>${review ? `Review ${escapeHtml(review.status)}` : "Review unavailable"}</h1><p>${escapeHtml(review?.failure_reason || "This review is limited to its recorded evidence; it does not measure lasting ability.")}</p>${findings.map((finding) => `<article class="observation"><h2>${escapeHtml(finding.observation)}</h2><p>${escapeHtml(finding.interpretation || finding.limitations)}</p><p class="small muted">${escapeHtml(finding.limitations)}</p><h3>Evidence</h3><ul>${evidence(finding)}</ul>${finding.is_disputed ? `<p class="badge">Finding disputed</p>` : `<form class="finding-correction-form" data-finding-id="${escapeHtml(finding.id)}"><label>Correct this finding<input name="reason" required></label><button class="button quiet small" type="submit">Submit correction</button></form>`}${finding.retry_checkpoint_id ? `<button class="button primary small" type="button" data-retry-checkpoint="${escapeHtml(finding.retry_checkpoint_id)}">Retry from this checkpoint</button>` : ""}</article>`).join("") || `<p class="empty-inline">No findings were published. Your attempt and evidence remain available.</p>`}<div class="actions"><button class="button secondary" type="button" data-open-related>Explore related practice</button></div></section></main>`;
}

function relatedMarkup(state) {
  const related = state.related ?? [];
  return `<main id="main" class="page-main"><button class="back-link" type="button" data-personal-page="review">← Back to review</button><section class="related-page"><p class="eyebrow">Optional next step</p><h1>Related practice</h1>${related.length ? `<ol class="drawer-problems">${related.map((problem) => `<li><strong>${escapeHtml(problem.title)}</strong><span>${escapeHtml(problem.topic)} · ${escapeHtml(problem.relationship_reason)}</span><span class="small muted">${problem.attempted_before ? "Attempted before" : "New to your record"}</span><button class="button primary small" type="button" data-start-related="${escapeHtml(problem.id)}">Set up practice</button></li>`).join("")}</ol>` : `<p class="empty-inline">There is no authored related problem for this attempt.</p>`}</section></main>`;
}

function personalHeader(state) {
  const nav = [['home', 'Home'], ['catalog', 'Roadmap'], ['sessions', 'Sessions']].map(([page, label]) => `<a class="button nav-link ${state.page === page ? 'current' : ''}" href="#personal?page=${page}" ${state.page === page ? 'aria-current="page"' : ''}>${label}</a>`).join('');
  return `<header class="app-header">${brandWordmark().replace('#welcome', '#personal?page=home')}<nav aria-label="Primary">${nav}</nav><nav class="header-end" aria-label="Account"><a class="button quiet" href="#sample">Guided sample</a>${accountMenu(state.user, { personal: true })}</nav></header>`;
}
function accountMarkup(state) {
  if (state.page === 'profile') return `<main id="main" class="page-main"><section class="setup-form"><h1>Your profile</h1><dl><dt>Display name</dt><dd>${escapeHtml(state.user.name)}</dd><dt>Email</dt><dd>${escapeHtml(state.user.email)}</dd></dl><a class="button secondary" href="#personal?page=settings">Account settings</a></section></main>`;
  return `<main id="main" class="page-main"><h1>Account settings</h1><section class="setup-form" aria-labelledby="account-heading"><h2 id="account-heading">Your account</h2><p class="small muted">Download everything recorded for this account, or delete the account and all of its records.</p><div class="actions"><a class="button secondary" href="/api/me/export" download>Download my data</a></div><details><summary>Delete account</summary><form id="delete-account-form"><p>This permanently deletes your account, sessions, code, transcripts, test runs, and reviews. It cannot be undone.</p><label for="delete-password">Current password</label><input id="delete-password" name="password" type="password" autocomplete="current-password" required><label class="check-row"><input type="checkbox" name="confirm" required><span>I understand that this cannot be undone.</span></label><button class="button danger" type="submit">Delete account permanently</button></form></details></section></main>`;
}

export function mountPersonal(root) {
  const state = { user: null, catalog: [], attempts: [], attempt: null, review: null, related: [], collectionEnabled: false, voiceEnabled: false, voiceProvider: VOICE_PROVIDER, thinkingModel: THINKING_MODEL, page: "home", selectedProblemId: null, catalogFilter: { topic: "", difficulty: "", limit: 30 }, emailEnabled: false, authView: "sign-in", resetToken: new URLSearchParams(location.hash.split("?")[1] ?? "").get("reset") };
  const requestedPage = new URLSearchParams(location.hash.split('?')[1] ?? '').get('page');
  if (['home', 'sessions', 'catalog', 'profile', 'settings'].includes(requestedPage)) state.page = requestedPage;
  let disposed = false;
  let authMode = new URLSearchParams(location.hash.split("?")[1] ?? "").get("auth") === "sign-up" ? "sign-up" : "sign-in";
  let voiceSession = null;
  const showError = (message) => { root.querySelector("#personal-error")?.remove(); const target = root.querySelector("main"); if (target) target.insertAdjacentHTML("afterbegin", `<p id="personal-error" class="inline-alert" role="alert">${escapeHtml(message)}</p>`); };
  const setVoiceStatus = (status) => {
    setBrandVoice(status);
    const labels = { connecting: "Connecting…", listening: "Listening", thinking: "Thinking…", speaking: "Speaking", reconnecting: "Reconnecting…", stopped: "Voice ready" };
    const statusNode = root.querySelector("#voice-status");
    if (statusNode) { statusNode.textContent = labels[status] ?? status; statusNode.dataset.voiceState = status; }
    const button = root.querySelector("[data-voice-toggle]");
    if (button) button.textContent = voiceSession?.active ? "Stop voice" : "Start voice";
  };
  const stopVoice = () => {
    voiceSession?.stop();
    voiceSession = null;
    setVoiceStatus("stopped");
  };
  const appendTranscript = ({ role, text, occurrenceOffsetMs }) => {
    const messages = root.querySelector(".messages");
    if (!messages) return;
    if (messages.querySelector(".muted")) messages.innerHTML = "";
    const speaker = role === "user" ? "candidate" : state.attempt.attempt.mode === "coach" ? "coach" : "interviewer";
    messages.insertAdjacentHTML("beforeend", `<div class="message"><div class="speaker">${escapeHtml(speaker)}<time>${escapeHtml(occurrenceOffsetMs)} ms</time></div><p>${escapeHtml(text)}</p></div>`);
    messages.scrollTop = messages.scrollHeight;
  };
  const startVoice = async () => {
    if (!state.attempt || state.attempt.attempt.input_mode !== "voice") throw new Error("This attempt uses text input.");
    if (voiceSession?.active) { stopVoice(); return; }
    voiceSession = createDeepgramVoiceSession({
      attempt: state.attempt.attempt,
      onStatus: setVoiceStatus,
      onError: (error) => showError(error.message),
      onTranscript: async ({ role, text }) => {
        appendTranscript({ role, text, occurrenceOffsetMs: Date.now() - Date.parse(state.attempt.attempt.created_at) });
      },
    });
    await voiceSession.start();
  };
  const render = () => {
    if (disposed) return;
    if (!state.attempt || state.page !== "workspace" || state.selectedProblemId) stopVoice();
    const footer = root.closest('.app-content')?.querySelector('.page-footer');
    if (footer) { footer.hidden = Boolean(state.user && (state.selectedProblemId || ['workspace', 'review', 'related'].includes(state.page))); document.documentElement.style.setProperty('--footer-height', `${footer.getBoundingClientRect().height}px`); }
    if (!state.collectionEnabled) { root.innerHTML = collectionUnavailableMarkup(); return; }
    if (state.resetToken || !state.user) {
      root.innerHTML = authMarkup(state);
      if (!state.resetToken && authMode === 'sign-up') root.querySelector('[data-auth-view="sign-up"]')?.click();
      return;
    }
    let content;
    if (['profile', 'settings'].includes(state.page)) content = accountMarkup(state);
    else if (state.page === "review") {
      content = reviewMarkup(state);
      const review = state.review?.review;
      if (review?.status === "ready" && !openedReviews.has(review.id)) { openedReviews.add(review.id); personalOutcome("review_opened", "client"); }
    }
    else if (state.page === "related") content = relatedMarkup(state);
    else if (state.selectedProblemId) {
      const problem = state.catalog.find((item) => item.id === state.selectedProblemId);
      content = problem ? setupMarkup(state, problem) : dashboardMarkup(state);
    } else content = state.attempt ? workspaceMarkup(state) : dashboardMarkup(state);
    root.innerHTML = personalHeader(state) + content;
    if (state.page === 'sessions' || state.page === 'catalog') {
      root.querySelector('.focus-work')?.remove();
      root.querySelector(state.page === 'sessions' ? '.home-route' : '.home-history')?.remove();
      const heading = root.querySelector('.section-heading h2');
      if (heading) { const title = document.createElement('h1'); title.textContent = state.page === 'sessions' ? 'Your sessions' : 'Practice roadmap'; heading.replaceWith(title); }
    }
  };
  const reload = async () => {
    const availability = await api("/api/personal-availability");
    state.collectionEnabled = availability.collectionEnabled === true;
    state.voiceEnabled = availability.voiceEnabled === true;
    state.voiceProvider = availability.voiceProvider || VOICE_PROVIDER;
    state.thinkingModel = availability.thinkingModel || THINKING_MODEL;
    state.emailEnabled = availability.emailEnabled === true;
    if (!state.collectionEnabled) return;
    const session = await api("/api/auth/get-session");
    if (!session?.user) { state.user = null; return; }
    const [me, catalog, attempts] = await Promise.all([api("/api/me"), api("/api/catalog"), api("/api/attempts")]);
    state.user = { ...session.user, userId: me.userId };
    state.catalog = catalog.problems;
    state.attempts = attempts.attempts; state.historyPage = attempts.page; state.historyMore = attempts.hasMore;
  };
  const session = createAttemptSession({ api, attempt: () => state.attempt?.attempt ?? null, editorSource: () => root.querySelector("#personal-code")?.value });
  const openAttempt = async (attemptId) => {
    stopVoice();
    state.attempt = await session.detail(attemptId);
    if (disposed) return;
    state.review = state.attempt.review ? await session.review(attemptId).catch(() => null) : null;
    state.related = [];
    state.page = "workspace";
    state.selectedProblemId = null;
    render();
  };
  const navigate = async (page) => {
    await session.saveChangedDraft();
    await reload();
    if (disposed) return;
    state.page = page; state.attempt = null; state.selectedProblemId = null;
    history.pushState(null, '', `#personal?page=${page}`);
    render();
    root.querySelector('h1')?.scrollIntoView({ block: 'start' });
  };
  root.addEventListener("click", async (event) => {
    const anchor = event.target.closest('a');
    if (anchor && state.user && !anchor.hasAttribute("download")) {
      event.preventDefault();
      try {
        const href = anchor.getAttribute('href');
        if (href?.startsWith('#personal?page=')) await navigate(new URLSearchParams(href.split('?')[1]).get('page'));
        else {
          await session.saveChangedDraft();
          if (!disposed) location.href = anchor.href;
        }
      } catch (error) { showError(error.message); }
      return;
    }
    const control = event.target.closest("button");
    if (!control) return;
    try {
      if (control.dataset.authView === "forgot" || (control.dataset.authView && state.authView === "forgot")) {
        state.authView = control.dataset.authView; authMode = "sign-in";
        root.innerHTML = authMarkup(state);
        root.querySelector(".auth-card input[type=email]")?.focus();
      } else if (control.dataset.authView) {
        authMode = control.dataset.authView;
        root.querySelector("[data-signup-name]").hidden = authMode !== "sign-up";
        root.querySelector("#auth-password").autocomplete = authMode === "sign-up" ? "new-password" : "current-password";
        // Better Auth's default minimum password length.
        root.querySelector("#auth-password").minLength = authMode === "sign-up" ? 8 : 0;
        root.querySelector("#auth-name").required = authMode === "sign-up";
        root.querySelector("#personal-auth-form button[type=submit]").textContent = authMode === "sign-up" ? "Create account" : "Sign in";
        root.querySelectorAll("[data-auth-view]").forEach((button) => { const selected = button.dataset.authView === authMode; button.classList.toggle("selected", selected); button.setAttribute("aria-pressed", String(selected)); });
      } else if (['home', 'sessions', 'catalog', 'profile', 'settings'].includes(control.dataset.personalPage)) await navigate(control.dataset.personalPage);
      else if (control.dataset.personalPage === "workspace") { state.page = "workspace"; render(); }
      else if (control.dataset.personalPage === "review") { state.page = "review"; render(); }
      else if (control.dataset.startProblem) { state.attempt = null; state.selectedProblemId = control.dataset.startProblem; render(); }
      else if (control.hasAttribute("data-more-problems")) { state.catalogFilter.limit += 30; render(); root.querySelector("[data-more-problems]")?.focus(); }
      else if (control.hasAttribute("data-more-attempts")) {
        const page = await api(`/api/attempts?page=${state.historyPage + 1}`);
        state.attempts.push(...page.attempts); state.historyPage = page.page; state.historyMore = page.hasMore; render();
      }
      else if (control.hasAttribute("data-more-evidence")) {
        const page = await session.detail(state.attempt.attempt.id, state.attempt.page + 1);
        for (const key of ["events", "transcripts", "checkpoints", "runs"]) state.attempt[key].push(...page[key]);
        state.attempt.page = page.page; state.attempt.hasMore = page.hasMore; render();
      }
      else if (control.dataset.openAttempt) await openAttempt(control.dataset.openAttempt);
      else if (control.hasAttribute("data-open-review")) { state.page = "review"; render(); }
      else if (control.hasAttribute("data-open-related")) { state.related = (await session.related()).relatedProblems; state.page = "related"; render(); }
      else if (control.hasAttribute("data-voice-toggle")) { await startVoice(); }
      else if (control.dataset.startRelated) { state.selectedProblemId = control.dataset.startRelated; state.page = "home"; render(); }
      else if (control.dataset.retryCheckpoint) { const result = await session.retry(control.dataset.retryCheckpoint, "Focused retry"); personalOutcome("retry_started"); await openAttempt(result.attemptId); }
      else if (control.hasAttribute("data-sign-out")) { await session.saveChangedDraft(); await api("/api/auth/sign-out", { method: "POST", body: {} }); if (disposed) return; state.user = null; state.attempt = null; state.attempts = []; state.review = null; state.related = []; state.selectedProblemId = null; state.page = "home"; state.authView = "sign-in"; authMode = "sign-in"; history.replaceState(null, "", "#personal"); render(); }
      else if (control.hasAttribute("data-save-draft")) { await navigate("sessions"); }
      else if (control.hasAttribute("data-run")) {
        control.disabled = true; control.textContent = "Running…";
        try {
          const result = await session.run();
          await openAttempt(state.attempt.attempt.id);
          showError(`Run recorded: ${result.testsPassed} passed, ${result.testsFailed} failed.`);
          root.querySelector(".tests-pane")?.scrollIntoView({ block: "nearest" });
        } finally { control.disabled = false; control.textContent = "Run visible tests"; }
      }
      else if (control.hasAttribute("data-finish")) {
        control.disabled = true; control.textContent = "Checking your submission…";
        try {
          const result = await session.finish();
          personalOutcome("practice_completed");
          await openAttempt(state.attempt.attempt.id);
          showError(["Attempt completed.", submissionCheckSentence(result.submissionCheck), `Review dispatch: ${result.dispatch}.`].filter(Boolean).join(" "));
        } finally { control.disabled = false; control.textContent = "Finish interview"; }
      }
      else if (control.hasAttribute("data-help")) { const result = await session.help("hint"); if (result.voiceReady && voiceSession?.active) voiceSession.sendText("I am requesting a hint."); else { if (result.delivered) await openAttempt(state.attempt.attempt.id); showError(result.message); } }
    } catch (error) { showError(error instanceof Error ? error.message : "The request could not be completed."); }
  });
  root.addEventListener("change", (event) => {
    const select = event.target.closest?.("[data-catalog-filter]");
    if (!select) return;
    state.catalogFilter = { ...state.catalogFilter, [select.dataset.catalogFilter]: select.value, limit: 30 };
    render();
    root.querySelector(`[data-catalog-filter="${select.dataset.catalogFilter}"]`)?.focus();
  });
  root.addEventListener("submit", async (event) => {
    const form = event.target;
    if (!(form instanceof HTMLFormElement)) return;
    event.preventDefault();
    try {
      if (form.id === "personal-auth-form") {
        const data = new FormData(form);
        const email = data.get("email"); const password = data.get("password"); const name = data.get("name");
        const result = await api(authMode === "sign-up" ? "/api/auth/sign-up/email" : "/api/auth/sign-in/email", { method: "POST", body: authMode === "sign-up" ? { email, password, name } : { email, password } });
        // With email verification on, sign-up returns no session token.
        if (authMode === "sign-up" && !result.token) { authMode = "sign-in"; root.innerHTML = authMarkup(state, "Check your email for a confirmation link, then sign in."); return; }
        authMode = "sign-in";
        await reload(); render();
      } else if (form.id === "personal-forgot-form") {
        await api("/api/auth/request-password-reset", { method: "POST", body: { email: new FormData(form).get("email") } });
        state.authView = "sign-in";
        root.innerHTML = authMarkup(state, "If an account uses that email, a reset link is on its way. It works for one hour.");
      } else if (form.id === "personal-reset-form") {
        await api("/api/auth/reset-password", { method: "POST", body: { newPassword: new FormData(form).get("password"), token: state.resetToken } });
        if (disposed) return;
        state.resetToken = null; state.user = null; authMode = "sign-in"; state.authView = "sign-in";
        history.replaceState(null, "", "#personal");
        root.innerHTML = authMarkup(state, "Your password was changed. Sign in with the new password.");
      } else if (form.id === "personal-setup-form") {
        const data = new FormData(form);
        const result = await api("/api/attempts", { method: "POST", body: { problemId: data.get("problemId"), mode: data.get("mode"), inputMode: data.get("inputMode"), saveAudio: false, consent: data.get("consent") === "on", familiarity: "unanswered", practiceGoal: data.get("practiceGoal"), setupContext: { studiedTopics: data.get("studiedTopics"), concern: data.get("concern") } } });
        personalOutcome("practice_started");
        await openAttempt(result.attemptId);
      } else if (form.id === "personal-message-form") {
        const message = new FormData(form).get("message");
        if (typeof message !== "string" || !message.trim()) return;
        if (state.attempt.attempt.input_mode === "voice") {
          if (!voiceSession?.active) throw new Error("Start voice before sending a typed message to the live interviewer.");
          await session.saveChangedDraft();
          voiceSession.sendText(message.trim());
          form.reset();
        } else {
          const result = await session.message(message);
          // The reply is stored as a transcript segment, so the reload renders it as escaped text.
          await openAttempt(state.attempt.attempt.id);
          if (result.replyError) showError(`Message saved. ${result.replyError}`);
        }
      } else if (form.id === "delete-account-form") {
        await api("/api/me", { method: "DELETE", body: { password: new FormData(form).get("password") } });
        state.user = null; state.attempts = []; state.attempt = null; state.review = null; state.related = []; state.selectedProblemId = null; state.page = "home"; authMode = "sign-in";
        root.innerHTML = authMarkup(state, "Your account and all of its records were deleted.");
      } else if (form.classList.contains("finding-correction-form")) {
        const reason = new FormData(form).get("reason");
        await session.correctFinding(form.dataset.findingId, reason);
        state.review = await session.review(state.attempt.attempt.id);
        render();
      }
    } catch (error) { showError(error instanceof Error ? error.message : "The request could not be completed."); }
  });
  (async () => { try { await reload(); render(); } catch (error) { if (disposed) return; state.user = null; root.innerHTML = authMarkup(state, state.resetToken ? "" : error instanceof Error ? error.message : "The data service is unavailable."); if (!state.resetToken && authMode === "sign-up") root.querySelector('[data-auth-view="sign-up"]')?.click(); } })();
  return () => { disposed = true; stopVoice(); };
}
