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

const icon = (path) => `<svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`;
const chevronIcon = icon('<path d="m8 5 5 5-5 5"/>');
const codeIcon = icon('<path d="m6 5-5 5 5 5m8-10 5 5-5 5m-3-12-2 14"/>');
const sentenceCase = (value) => { const text = String(value ?? ""); return text.charAt(0).toUpperCase() + text.slice(1); };
const dateLabel = (value) => (value ? new Date(value).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : "");

function authForm(state) {
  if (state.resetToken) return `<form id="personal-reset-form" class="auth-form"><h2>Choose a new password</h2><div class="field"><label for="reset-password">New password</label><input id="reset-password" name="password" type="password" autocomplete="new-password" minlength="8" required aria-describedby="reset-password-hint"><p id="reset-password-hint" class="field-hint">Use at least 8 characters. Other signed-in devices are signed out.</p></div><button class="button primary" type="submit">Save new password</button></form>`;
  if (state.authView === "forgot") return `<form id="personal-forgot-form" class="auth-form"><h2>Reset your password</h2><p class="field-hint">Enter the email for your account. We send a reset link that works for one hour.</p><div class="field"><label for="forgot-email">Email</label><input id="forgot-email" name="email" type="email" autocomplete="email" required></div><button class="button primary" type="submit">Send reset link</button><button class="button quiet" type="button" data-auth-view="sign-in">Back to sign in</button></form>`;
  return `<div class="segmented auth-switch" role="group" aria-label="Sign in or create an account"><button class="button selected" type="button" data-auth-view="sign-in" aria-pressed="true">Sign in</button><button class="button" type="button" data-auth-view="sign-up" aria-pressed="false">Create account</button></div><form id="personal-auth-form" class="auth-form"><div class="field" data-signup-name hidden><label for="auth-name">Display name</label><input id="auth-name" name="name" autocomplete="name"></div><div class="field"><label for="auth-email">Email</label><input id="auth-email" name="email" type="email" autocomplete="email" placeholder="you@example.com" required></div><div class="field"><label for="auth-password">Password</label><input id="auth-password" name="password" type="password" autocomplete="current-password" required aria-describedby="auth-password-hint"><p id="auth-password-hint" class="field-hint" data-signup-hint hidden>Use at least 8 characters.</p></div><button class="button primary" type="submit">Sign in</button>${state.emailEnabled ? `<button class="button quiet small" type="button" data-auth-view="forgot">Forgot password?</button>` : ""}</form>`;
}

function authMarkup(state, message = "") {
  return `<main id="main" class="page-main personal-entry"><section class="entry-intro"><span class="eyebrow">Practice, inspect, retry</span><h1>Keep the evidence with the work.</h1><p>Use the guided sample without an account, or sign in to record a personal Python practice attempt.</p><a class="button secondary" href="#sample">Try the guided sample</a></section><section class="auth-card" aria-label="Your account">${message ? `<p class="form-error" role="status">${escapeHtml(message)}</p>` : ""}${authForm(state)}</section></main>`;
}

function collectionUnavailableMarkup() {
  return `<main id="main" class="page-main personal-entry"><section class="empty-state"><span class="eyebrow">Personal practice unavailable</span><h1>Records are not being collected.</h1><p>The owner has not enabled the approved personal-data collection policy for this deployment. Nothing is saved from this screen.</p><div class="actions"><a class="button secondary" href="#sample">Try the guided sample</a></div></section></main>`;
}

const RECENT_SESSIONS = 3;

function sessionRow(attempt, index) {
  const title = escapeHtml(attempt.title);
  const meta = [sentenceCase(attempt.mode), attempt.input_mode === "voice" ? "Voice" : "Text", dateLabel(attempt.updated_at)].filter(Boolean).map(escapeHtml).join(" · ");
  const review = attempt.review_status ? `<span class="muted"> · Review ${escapeHtml(attempt.review_status)}</span>` : "";
  return `<li class="session-line enter" style="--i:${index}"><span class="session-icon">${codeIcon}</span><span class="session-text"><strong>${title}</strong><small>${meta}</small></span><span class="session-status" data-status="${escapeHtml(attempt.status)}"><i aria-hidden="true"></i>${escapeHtml(sentenceCase(attempt.status))}${review}</span><button class="button secondary small session-open" type="button" data-open-attempt="${escapeHtml(attempt.id)}">${attempt.status === "active" ? "Resume" : "Open"}<span class="sr-only"> ${title}</span>${chevronIcon}</button></li>`;
}

function sessionsSection(state, { page }) {
  const attempts = page ? state.attempts : state.attempts.slice(0, RECENT_SESSIONS);
  const heading = page
    ? `<div class="page-title"><h1>Your sessions</h1></div>`
    : `<div class="section-heading"><h2>Recent sessions</h2>${state.attempts.length > RECENT_SESSIONS ? `<a class="button quiet small" href="#personal?page=sessions">View all sessions</a>` : ""}</div>`;
  const body = attempts.length
    ? `<ol class="session-list">${attempts.map(sessionRow).join("")}</ol>${page && state.historyMore ? `<button class="button quiet" type="button" data-more-attempts>Load more sessions</button>` : ""}`
    : `<div class="empty-panel"><p><strong>No sessions yet</strong></p><p>Each practice attempt keeps its code, test runs, and conversation here.</p><button class="button primary small" type="button" data-personal-page="catalog">Choose a problem</button></div>`;
  return `<section class="home-history">${heading}${body}</section>`;
}

function catalogSection(state, { page }) {
  const filter = state.catalogFilter;
  const matching = state.catalog.filter((problem) => (!filter.topic || problem.topic === filter.topic) && (!filter.difficulty || problem.difficulty === filter.difficulty));
  const option = (value, selected) => `<option value="${escapeHtml(value)}" ${value === selected ? "selected" : ""}>${escapeHtml(value)}</option>`;
  const topics = [...new Set(state.catalog.map((problem) => problem.topic))].sort();
  const filtered = filter.topic || filter.difficulty;
  const filters = `<div class="catalog-filters"><label class="field">Topic <select data-catalog-filter="topic"><option value="">All topics</option>${topics.map((topic) => option(topic, filter.topic)).join("")}</select></label><label class="field">Difficulty <select data-catalog-filter="difficulty"><option value="">Any difficulty</option>${["Easy", "Medium", "Hard"].map((level) => option(level, filter.difficulty)).join("")}</select></label><span class="catalog-count" role="status">${matching.length} of ${state.catalog.length} problems</span>${filtered ? `<button class="button quiet small" type="button" data-clear-filters>Clear filters</button>` : ""}</div>`;
  const problems = matching.slice(0, filter.limit).map((problem) => `<li><span class="catalog-text"><strong>${escapeHtml(problem.title)}</strong><small>${escapeHtml(problem.topic)}</small></span><span class="difficulty">${escapeHtml(problem.difficulty)}</span><button class="button secondary small" type="button" data-start-problem="${escapeHtml(problem.id)}">Set up practice<span class="sr-only"> for ${escapeHtml(problem.title)}</span></button></li>`).join("");
  const heading = page
    ? `<div class="page-title"><h1>Practice roadmap</h1></div>`
    : `<div class="section-heading"><h2>Available practice</h2><a class="button quiet small" href="#personal?page=catalog">Open roadmap</a></div>`;
  const list = problems
    ? `<ol class="catalog-list">${problems}</ol>${matching.length > filter.limit ? `<button class="button quiet" type="button" data-more-problems>Show more problems</button>` : ""}`
    : `<div class="empty-panel"><p><strong>No problems match these filters</strong></p><button class="button secondary small" type="button" data-clear-filters>Clear filters</button></div>`;
  return `<section class="home-route">${heading}${filters}${list}</section>`;
}

function dashboardMarkup(state) {
  if (state.page === "sessions") return `<main id="main" class="page-main">${sessionsSection(state, { page: true })}</main>`;
  if (state.page === "catalog") return `<main id="main" class="page-main">${catalogSection(state, { page: true })}</main>`;
  return `<main id="main" class="page-main"><section class="focus-work"><div class="focus-top"><span class="eyebrow">Your practice</span><span class="badge accent">Signed in</span></div><div class="focus-body"><p class="small">Python · English</p><h1>Start with the work.<br>Keep the evidence.</h1><p>Personal attempts preserve your code, exact test results, and text conversation. The guided sample remains separate.</p><div class="actions"><button class="button primary" type="button" data-personal-page="catalog">Choose a problem</button><a class="button quiet" href="#sample">Explore the sample</a></div></div></section>${sessionsSection(state, { page: false })}${catalogSection(state, { page: false })}</main>`;
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

const testCall = (detail, test) => `${detail.problem.entry_point}(${(test?.input_data?.args ?? []).map(pythonValue).join(", ")})`;
const passIcon = icon('<path d="m5 10.5 3.5 3.5 6.5-8"/>');
const failIcon = icon('<path d="m6 6 8 8m0-8-8 8"/>');

// Run results follow the HackerRank pattern: a summary, a vertical list of
// sample test cases, and the input and outputs of the selected case.
function runResultsMarkup(detail, run) {
  const byId = new Map((detail.visibleTests ?? []).map((test) => [test.id, test]));
  const results = run.test_results ?? [];
  const failed = results.filter((result) => result.outcome !== "passed").length;
  const heading = run.status === "runner_error" ? "Runner error" : failed ? "Wrong answer" : "All sample tests passed";
  const summary = run.runner_error || (failed ? `${failed} of ${results.length} sample tests did not pass.` : `${results.length} of ${results.length} sample tests passed. Submit your code when you are ready.`);
  const selected = Math.max(0, results.findIndex((result) => result.outcome !== "passed"));
  const tabs = results.map((result, index) => `<button type="button" role="tab" class="test-case ${escapeHtml(result.outcome)}" id="case-tab-${index}" aria-controls="case-${index}" aria-selected="${index === selected}" tabindex="${index === selected ? 0 : -1}">${result.outcome === "passed" ? passIcon : failIcon}Test case ${index}<span class="sr-only"> ${escapeHtml(result.outcome)}</span></button>`).join("");
  const panels = results.map((result, index) => {
    const test = byId.get(result.testId);
    const actual = Object.hasOwn(result, "actualOutput") ? pythonValue(result.actualOutput) : "No output";
    return `<div class="case-detail" role="tabpanel" id="case-${index}" aria-labelledby="case-tab-${index}" tabindex="0" ${index === selected ? "" : "hidden"}><dl><dt>Input</dt><dd><pre>${escapeHtml(testCall(detail, test))}</pre></dd><dt>Your output</dt><dd><pre>${escapeHtml(actual)}</pre></dd><dt>Expected output</dt><dd><pre>${escapeHtml(pythonValue(test?.expected_output))}</pre></dd>${result.error ? `<dt>Error</dt><dd><pre>${escapeHtml(result.error)}</pre></dd>` : ""}</dl></div>`;
  }).join("");
  const output = [["Standard output", run.stdout], ["Standard error", run.stderr]].filter(([, text]) => text).map(([name, text]) => `<details><summary>${name}</summary><pre>${escapeHtml(text)}</pre></details>`).join("");
  const cases = results.length ? `<div class="case-layout"><div class="case-list" role="tablist" aria-orientation="vertical" aria-label="Sample test cases">${tabs}</div><div class="case-details">${panels}</div></div>` : "";
  return `<div class="run-summary" data-outcome="${failed || run.status === "runner_error" ? "failed" : "passed"}" role="status"><strong>${heading}</strong><span>${escapeHtml(summary)}</span></div>${cases}${output}`;
}

function runHistoryMarkup(detail) {
  if (!detail.runs.length) return `<p class="small muted">No runs yet. Run your code to check it against the sample tests.</p>`;
  const rows = detail.runs.map((run, index) => {
    const time = run.created_at ? new Date(run.created_at).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }) : "";
    const total = run.tests_passed + run.tests_failed;
    return `<li><span class="session-status" data-status="${escapeHtml(run.status)}"><i aria-hidden="true"></i>${escapeHtml(sentenceCase(run.status.replace("_", " ")))}</span><span>${escapeHtml(run.tests_passed)}/${escapeHtml(total)} sample tests</span><span class="small muted">Run ${index + 1}${time ? ` · ${escapeHtml(time)}` : ""}</span><button class="button quiet small" type="button" data-show-run="${index}">View<span class="sr-only"> run ${index + 1}</span></button></li>`;
  }).reverse().join("");
  return `<ol class="run-history">${rows}</ol>`;
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

function resultsMarkup(state) {
  const detail = state.attempt;
  const run = detail.runs[state.runIndex ?? detail.runs.length - 1];
  const review = detail.review ? `<p class="small">Review: <strong>${escapeHtml(detail.review.status)}</strong>${detail.review.failure_reason ? ` · ${escapeHtml(detail.review.failure_reason)}` : ""} <button class="button quiet small" type="button" data-open-review>Inspect review</button></p>` : "";
  return `${submissionCheckMarkup(detail.submissionCheck)}${review}${run ? runResultsMarkup(detail, run) : ""}`;
}

const WORKSPACE_TABS = [["problem", "Problem"], ["voice", "Voice"], ["discussion", "Discussion"], ["submissions", "Submissions"]];

function workspaceMarkup(state) {
  const detail = state.attempt;
  const problem = detail.problem;
  const transcript = detail.transcripts.map((segment) => `<div class="message"><div class="speaker">${escapeHtml(segment.speaker)}<time>${escapeHtml(segment.end_offset_ms)} ms</time></div><p>${escapeHtml(segment.text)}</p></div>`).join("") || `<p class="small muted">No conversation messages recorded yet.</p>`;
  const disabled = detail.attempt.status === "completed" ? "disabled" : "";
  const isVoice = detail.attempt.input_mode === "voice";
  const tabs = WORKSPACE_TABS.filter(([id]) => id !== "voice" || isVoice);
  const current = tabs.some(([id]) => id === state.leftTab) ? state.leftTab : "problem";
  const rail = `<div class="workspace-rail" role="tablist" aria-orientation="vertical" aria-label="Workspace panels">${tabs.map(([id, label]) => `<button type="button" role="tab" id="tab-${id}" aria-controls="panel-${id}" aria-selected="${id === current}" tabindex="${id === current ? 0 : -1}" data-workspace-tab="${id}">${label}</button>`).join("")}</div>`;
  const panel = (id, body) => `<div class="workspace-panel" role="tabpanel" id="panel-${id}" aria-labelledby="tab-${id}" ${id === current ? "" : "hidden"}>${body}</div>`;
  const samples = (detail.visibleTests ?? []).map((test, index) => `<div class="example"><strong class="small">Sample test ${index}</strong><dl><dt>Input</dt><dd><code>${escapeHtml(testCall(detail, test))}</code></dd><dt>Expected output</dt><dd><code>${escapeHtml(pythonValue(test.expected_output))}</code></dd></dl></div>`).join("");
  const problemPanel = panel("problem", `<div class="problem-scroll"><h2>${escapeHtml(problem.title)}</h2><p class="small muted">${[problem.topic, problem.difficulty].filter(Boolean).map(escapeHtml).join(" · ")}</p><p class="problem-prompt">${escapeHtml(problem.prompt)}</p><p class="small muted">Entry point: <code>${escapeHtml(problem.entry_point)}</code></p>${samples ? `<h3>Sample tests</h3>${samples}` : ""}</div>`);
  const voicePanel = isVoice ? panel("voice", `<div class="voice-panel"><p class="eyebrow">Voice interviewer</p><p id="voice-status" role="status">Voice ready</p><button class="button primary" type="button" data-voice-toggle ${disabled}>Start voice</button><p class="small muted">Deepgram handles listening and speech. ${escapeHtml(state.thinkingModel)} produces the interviewer response. Raw audio is not saved. The conversation appears in Discussion.</p></div>`) : "";
  const discussionPanel = panel("discussion", `<div class="panel-top"><span>Discussion</span><button class="button quiet small" type="button" data-help ${disabled}>Request help</button></div><div class="conversation-body"><div class="messages" tabindex="0" role="region" aria-label="Recorded conversation">${transcript}</div><form id="personal-message-form" class="composer"><label class="sr-only" for="personal-message">Message the interviewer</label><input id="personal-message" name="message" placeholder="${isVoice ? "Speak, or type while voice is active…" : "Explain your approach…"}" autocomplete="off" ${disabled}><button class="icon-button" type="submit" aria-label="Send message" ${disabled}>→</button></form><p class="composer-note">${isVoice ? "Typed messages go to the live voice interviewer." : "Messages are stored as text evidence."}</p></div>`);
  const submissionsPanel = panel("submissions", `<div class="problem-scroll"><h2>Submissions</h2>${detail.submissionCheck ? `<p><strong>${escapeHtml(submissionCheckSentence(detail.submissionCheck))}</strong></p>` : ""}${runHistoryMarkup(detail)}</div>`);
  const hasResults = detail.runs.length || detail.submissionCheck || detail.review;
  const editor = `<section class="editor-pane pane"><div class="panel-top"><span>Language <span class="language-pill">Python 3</span></span><div class="actions"><button class="icon-button" type="button" data-reset-code aria-label="Reset to starter code" title="Reset to starter code" ${disabled}>${icon('<path d="M4 10a6 6 0 1 0 1.8-4.3M4 4v3.5h3.5"/>')}</button></div></div><div class="code-host" id="code-host"></div><div class="editor-status"><span>Esc then Tab leaves the editor</span><span data-cursor>Line: 1 Col: 1</span></div></section>`;
  const actions = `<div class="editor-actions"><button class="button secondary" type="button" data-run ${disabled}>Run code</button><button class="button primary" type="button" data-finish ${disabled}>Submit code</button></div>`;
  const results = `<section class="tests-pane pane" aria-label="Test results" ${hasResults ? "" : "hidden"}><div class="test-body">${resultsMarkup(state)}</div></section>`;
  return `<main id="main" class="workspace-main personal-workspace"><div class="session-header"><div class="actions"><button class="button quiet small" type="button" data-personal-page="sessions">← Sessions</button><h1>${escapeHtml(problem.title)}</h1><span class="badge">${escapeHtml(detail.attempt.mode)} · ${escapeHtml(detail.attempt.status)}</span></div><div class="actions"><span class="small muted">${isVoice ? "Deepgram voice" : "Text"} evidence · revision ${escapeHtml(detail.attempt.draft_revision)}</span><button class="button quiet small" type="button" data-save-draft ${disabled}>Save & exit</button></div></div><div class="coding-workspace" style="--left-width:${state.leftWidth}%">${rail}<section class="workspace-left pane">${problemPanel}${voicePanel}${discussionPanel}${submissionsPanel}</section><div class="splitter" role="separator" tabindex="0" aria-label="Problem and code width" aria-orientation="vertical" aria-valuemin="25" aria-valuemax="65" aria-valuenow="${Math.round(state.leftWidth)}" data-splitter></div><div class="workspace-right">${editor}${actions}${results}</div></div>${state.attempt.hasMore ? `<button class="button quiet" data-more-evidence>Load more evidence</button>` : ""}</main>`;
}

function reviewMarkup(state) {
  const review = state.review?.review;
  const findings = state.review?.findings ?? [];
  const evidence = (finding) => (finding.evidence ?? []).map((item) => `<li><code>${escapeHtml(item.eventId)}</code>${item.locator ? ` · ${escapeHtml(JSON.stringify(item.locator))}` : ""}</li>`).join("") || "<li>No evidence references were published.</li>";
  return `<main id="main" class="page-main"><button class="back-link button quiet" type="button" data-personal-page="workspace">← Back to attempt</button><section class="finding-head"><p class="eyebrow">Recorded review</p><h1>${review ? `Review ${escapeHtml(review.status)}` : "Review unavailable"}</h1>${submissionCheckMarkup(state.attempt?.submissionCheck)}<p>${escapeHtml(review?.failure_reason || "This review is limited to its recorded evidence; it does not measure lasting ability.")}</p>${findings.map((finding) => `<article class="observation"><h2>${escapeHtml(finding.observation)}</h2><p>${escapeHtml(finding.interpretation || finding.limitations)}</p><p class="small muted">${escapeHtml(finding.limitations)}</p><h3>Evidence</h3><ul>${evidence(finding)}</ul>${finding.is_disputed ? `<p class="badge">Finding disputed</p>` : `<form class="finding-correction-form" data-finding-id="${escapeHtml(finding.id)}"><label>Correct this finding<input name="reason" required></label><button class="button quiet small" type="submit">Submit correction</button></form>`}${finding.retry_checkpoint_id ? `<button class="button primary small" type="button" data-retry-checkpoint="${escapeHtml(finding.retry_checkpoint_id)}">Retry from this checkpoint</button>` : ""}</article>`).join("") || `<p class="empty-inline">No findings were published. Your attempt and evidence remain available.</p>`}<div class="actions"><button class="button secondary" type="button" data-open-related>Explore related practice</button></div></section></main>`;
}

function relatedMarkup(state) {
  const related = state.related ?? [];
  return `<main id="main" class="page-main"><button class="back-link" type="button" data-personal-page="review">← Back to review</button><section class="related-page"><p class="eyebrow">Optional next step</p><h1>Related practice</h1>${related.length ? `<ol class="catalog-list">${related.map((problem) => `<li><span class="catalog-text"><strong>${escapeHtml(problem.title)}</strong><small>${escapeHtml(problem.topic)} · ${escapeHtml(problem.relationship_reason)}</small></span><span class="small muted">${problem.attempted_before ? "Attempted before" : "New to your record"}</span><button class="button secondary small" type="button" data-start-related="${escapeHtml(problem.id)}">Set up practice<span class="sr-only"> for ${escapeHtml(problem.title)}</span></button></li>`).join("")}</ol>` : `<p class="empty-inline">There is no authored related problem for this attempt.</p>`}</section></main>`;
}

function personalHeader(state) {
  const nav = [['home', 'Home'], ['catalog', 'Roadmap'], ['sessions', 'Sessions']].map(([page, label]) => `<a class="button nav-link ${state.page === page ? 'current' : ''}" href="#personal?page=${page}" ${state.page === page ? 'aria-current="page"' : ''}>${label}</a>`).join('');
  return `<header class="app-header">${brandWordmark().replace('#welcome', '#personal?page=home')}<nav aria-label="Primary">${nav}</nav><nav class="header-end" aria-label="Account"><a class="button quiet" href="#sample">Guided sample</a>${accountMenu(state.user, { personal: true })}</nav></header>`;
}
function accountMarkup(state) {
  const { user } = state;
  if (state.page === 'profile') {
    const since = dateLabel(user.createdAt);
    const shortcut = (page, label, detail) => `<li><a href="#personal?page=${page}"><span><strong>${label}</strong><small>${detail}</small></span>${chevronIcon}</a></li>`;
    return `<main id="main" class="page-main account-page"><div class="page-title"><h1>Your profile</h1></div><section class="account-card profile-card" aria-label="Account identity"><span class="avatar avatar-large" aria-hidden="true">${escapeHtml((user.name || user.email || '?').charAt(0).toUpperCase())}</span><div class="account-identity"><p class="account-name">${escapeHtml(user.name || 'Your account')}</p><p class="account-email">${escapeHtml(user.email)}</p>${since ? `<p class="account-since">Member since ${escapeHtml(since)}</p>` : ''}</div></section><nav aria-label="Account shortcuts"><ul class="account-links">${shortcut('sessions', 'Your sessions', 'Resume or inspect recorded attempts')}${shortcut('catalog', 'Practice roadmap', 'Choose a problem to practice')}${shortcut('settings', 'Account settings', 'Download your data or delete your account')}</ul></nav></main>`;
  }
  return `<main id="main" class="page-main account-page"><div class="page-title"><h1>Account settings</h1></div><p class="account-signed-in">Signed in as <strong>${escapeHtml(user.email)}</strong></p><section class="account-card" aria-labelledby="export-heading"><div class="account-card-text"><h2 id="export-heading">Download your data</h2><p>Get a copy of everything recorded for this account: sessions, code, transcripts, test runs, and reviews.</p></div><a class="button secondary" href="/api/me/export" download>Download my data</a></section><section class="account-card danger-card" aria-labelledby="delete-heading"><div class="account-card-text"><h2 id="delete-heading">Delete your account</h2><p>Permanently delete your account and all of its records. This cannot be undone.</p></div><details class="danger-disclosure"><summary class="button danger">Delete account</summary><form id="delete-account-form" class="auth-form"><div class="field"><label for="delete-password">Current password</label><input id="delete-password" name="password" type="password" autocomplete="current-password" required></div><label class="check-row"><input type="checkbox" name="confirm" required><span>I understand that this cannot be undone.</span></label><button class="button danger solid" type="submit">Delete account permanently</button></form></details></section></main>`;
}

export function mountPersonal(root) {
  const state = { user: null, catalog: [], attempts: [], attempt: null, review: null, related: [], collectionEnabled: false, voiceEnabled: false, voiceProvider: VOICE_PROVIDER, thinkingModel: THINKING_MODEL, page: "home", selectedProblemId: null, catalogFilter: { topic: "", difficulty: "", limit: 30 }, emailEnabled: false, authView: "sign-in", leftTab: "problem", leftWidth: 40, runIndex: undefined, resetToken: new URLSearchParams(location.hash.split("?")[1] ?? "").get("reset") };
  const requestedPage = new URLSearchParams(location.hash.split('?')[1] ?? '').get('page');
  if (['home', 'sessions', 'catalog', 'profile', 'settings'].includes(requestedPage)) state.page = requestedPage;
  let disposed = false;
  let authMode = new URLSearchParams(location.hash.split("?")[1] ?? "").get("auth") === "sign-up" ? "sign-up" : "sign-in";
  let voiceSession = null;
  let editor = null;
  const showError = (message) => { root.querySelector("#personal-error")?.remove(); const target = root.querySelector("main"); if (target) target.insertAdjacentHTML("afterbegin", `<p id="personal-error" class="inline-alert" role="alert">${escapeHtml(message)}</p>`); };
  const setVoiceStatus = (status) => {
    setBrandVoice(status);
    const labels = { connecting: "Connecting…", listening: "Listening", thinking: "Thinking…", speaking: "Speaking", reconnecting: "Reconnecting…", stopped: "Voice ready" };
    const statusNode = root.querySelector("#voice-status");
    if (statusNode) { statusNode.textContent = labels[status] ?? status; statusNode.dataset.voiceState = status; }
    root.querySelector("#tab-voice")?.toggleAttribute("data-live", Boolean(voiceSession?.active));
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
    editor?.destroy(); editor = null;
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
    if (root.querySelector("#code-host")) mountEditor();
  };
  // The editor bundle loads only when a workspace opens.
  const mountEditor = async () => {
    const host = root.querySelector("#code-host");
    const { createCodeEditor } = await import("./code-editor.js");
    if (!host.isConnected) return;
    const cursor = root.querySelector("[data-cursor]");
    editor = createCodeEditor({ parent: host, doc: state.attempt.attempt.draft_source, readOnly: state.attempt.attempt.status === "completed", label: "Python source code", onCursor: (line, column) => { cursor.textContent = `Line: ${line} Col: ${column}`; } });
  };
  const selectTab = (tab) => {
    for (const other of tab.parentElement.querySelectorAll('[role="tab"]')) {
      const selected = other === tab;
      other.setAttribute("aria-selected", String(selected));
      other.tabIndex = selected ? 0 : -1;
      root.querySelector(`#${other.getAttribute("aria-controls")}`).hidden = !selected;
    }
    if (tab.dataset.workspaceTab) state.leftTab = tab.dataset.workspaceTab;
  };
  const resizeColumns = (percent) => {
    state.leftWidth = Math.min(65, Math.max(25, percent));
    root.querySelector(".coding-workspace")?.style.setProperty("--left-width", `${state.leftWidth}%`);
    root.querySelector("[data-splitter]")?.setAttribute("aria-valuenow", String(Math.round(state.leftWidth)));
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
  const session = createAttemptSession({ api, attempt: () => state.attempt?.attempt ?? null, editorSource: () => editor?.value });
  const openAttempt = async (attemptId) => {
    stopVoice();
    if (state.attempt?.attempt.id !== attemptId) state.leftTab = "problem";
    state.attempt = await session.detail(attemptId);
    state.runIndex = undefined;
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
    if (control.getAttribute("role") === "tab") { selectTab(control); return; }
    try {
      if (control.dataset.authView === "forgot" || (control.dataset.authView && state.authView === "forgot")) {
        state.authView = control.dataset.authView; authMode = "sign-in";
        root.innerHTML = authMarkup(state);
        root.querySelector(".auth-card input[type=email]")?.focus();
      } else if (control.dataset.authView) {
        authMode = control.dataset.authView;
        root.querySelector("[data-signup-name]").hidden = authMode !== "sign-up";
        root.querySelector("[data-signup-hint]").hidden = authMode !== "sign-up";
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
      else if (control.hasAttribute("data-clear-filters")) { state.catalogFilter = { topic: "", difficulty: "", limit: 30 }; render(); root.querySelector('[data-catalog-filter="topic"]')?.focus(); }
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
      else if (control.dataset.showRun) {
        state.runIndex = Number(control.dataset.showRun);
        const pane = root.querySelector(".tests-pane");
        pane.querySelector(".test-body").innerHTML = resultsMarkup(state);
        pane.hidden = false;
        pane.scrollIntoView({ block: "nearest" });
      }
      else if (control.hasAttribute("data-reset-code")) { if (editor && confirm("Reset your code to the starter code? Your current code will be replaced.")) { editor.value = state.attempt.problem.starter_code ?? ""; editor.focus(); } }
      else if (control.hasAttribute("data-run")) {
        control.disabled = true; control.textContent = "Running…";
        try {
          const result = await session.run();
          await openAttempt(state.attempt.attempt.id);
          showError(`Run recorded: ${result.testsPassed} passed, ${result.testsFailed} failed.`);
          root.querySelector(".tests-pane")?.scrollIntoView({ block: "nearest" });
        } finally { control.disabled = false; control.textContent = "Run code"; }
      }
      else if (control.hasAttribute("data-finish")) {
        if (!confirm("Submit your code and finish the interview? You cannot edit the code after you submit.")) return;
        control.disabled = true; control.textContent = "Checking your submission…";
        try {
          const result = await session.finish();
          personalOutcome("practice_completed");
          await openAttempt(state.attempt.attempt.id);
          showError(["Attempt completed.", submissionCheckSentence(result.submissionCheck), `Review dispatch: ${result.dispatch}.`].filter(Boolean).join(" "));
        } finally { control.disabled = false; control.textContent = "Submit code"; }
      }
      else if (control.hasAttribute("data-help")) { const result = await session.help("hint"); if (result.voiceReady && voiceSession?.active) voiceSession.sendText("I am requesting a hint."); else { if (result.delivered) await openAttempt(state.attempt.attempt.id); showError(result.message); } }
    } catch (error) { showError(error instanceof Error ? error.message : "The request could not be completed."); }
  });
  // Arrow keys move between tabs (vertical tab lists) and resize the splitter.
  root.addEventListener("keydown", (event) => {
    const splitter = event.target.closest?.("[data-splitter]");
    if (splitter && ["ArrowLeft", "ArrowRight"].includes(event.key)) { event.preventDefault(); resizeColumns(state.leftWidth + (event.key === "ArrowRight" ? 2 : -2)); return; }
    const tab = event.target.closest?.('[role="tab"]');
    const keys = ["ArrowDown", "ArrowUp", "ArrowRight", "ArrowLeft", "Home", "End"];
    if (!tab || !keys.includes(event.key)) return;
    const tabs = [...tab.parentElement.querySelectorAll('[role="tab"]')];
    const index = tabs.indexOf(tab);
    const next = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : (index + (["ArrowDown", "ArrowRight"].includes(event.key) ? 1 : -1) + tabs.length) % tabs.length;
    event.preventDefault();
    tabs[next].focus();
    selectTab(tabs[next]);
  });
  root.addEventListener("pointerdown", (event) => {
    const splitter = event.target.closest?.("[data-splitter]");
    if (!splitter) return;
    const left = root.querySelector(".workspace-left").getBoundingClientRect().left;
    const width = splitter.parentElement.getBoundingClientRect().width;
    splitter.setPointerCapture(event.pointerId);
    const move = (moveEvent) => resizeColumns(((moveEvent.clientX - left) / width) * 100);
    splitter.addEventListener("pointermove", move);
    splitter.addEventListener("lostpointercapture", () => splitter.removeEventListener("pointermove", move), { once: true });
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
  return () => { disposed = true; stopVoice(); editor?.destroy(); };
}
