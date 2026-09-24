import { brandWordmark, beginBrandLoading, setBrandVoice } from './brand.js';
import { createDeepgramVoiceSession, THINKING_MODEL, VOICE_PROVIDER } from "./voice-agent.js";

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
    if (!response.ok) throw new Error(payload.error || "The request could not be completed.");
    return payload;
  } finally {
    finishLoading();
  }
}

// Offsets share the server's clock origin (attempt creation), like voice
// events, so the timeline orders text, runs, help, and voice consistently.
// They never decrease within a page, even if the local clock is adjusted.
function sourceMetadata(state, name) {
  state.sourceOrder += 1;
  const elapsed = Date.now() - Date.parse(state.attempt.attempt.created_at);
  state.lastOffsetMs = Math.max(state.lastOffsetMs ?? 0, Number.isFinite(elapsed) ? Math.round(elapsed) : 0);
  return {
    sourceId: `${name}:${crypto.randomUUID()}`,
    sourceOrder: state.sourceOrder,
    occurrenceOffsetMs: state.lastOffsetMs,
  };
}

function authMarkup(error = "") {
  return `<main id="main" class="page-main personal-entry"><section class="empty-state"><span class="eyebrow">Practice, inspect, retry</span><h1>Keep the evidence<br>with the work.</h1><p>Use the guided sample without an account, or sign in to record a personal Python practice attempt.</p><div class="actions"><a class="button secondary" href="#sample"><span>Try the guided sample</span></a></div>${error ? `<p class="form-error">${escapeHtml(error)}</p>` : ""}</section><section class="setup-form auth-card"><div class="segmented" aria-label="Authentication"><button class="button selected" type="button" data-auth-view="sign-in" aria-pressed="true">Sign in</button><button class="button" type="button" data-auth-view="sign-up" aria-pressed="false">Create account</button></div><form id="personal-auth-form"><div data-signup-name hidden><label for="auth-name">Display name</label><input id="auth-name" name="name" autocomplete="name"></div><label for="auth-email">Email</label><input id="auth-email" name="email" type="email" autocomplete="email" required><label for="auth-password">Password</label><input id="auth-password" name="password" type="password" autocomplete="current-password" required><p class="small muted">Email and password are the only MVP login method.</p><button class="button primary" type="submit">Sign in</button></form></section></main>`;
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
  return `<main id="main" class="page-main"><header class="app-header">${brandWordmark()}<nav aria-label="Primary"><button class="button nav-link current" type="button" data-personal-page="home">Home</button><button class="button nav-link" type="button" data-personal-page="catalog">Roadmap</button><button class="button nav-link" type="button" data-personal-page="sessions">Sessions</button></nav><div class="header-end"><a class="button quiet" href="#sample">Guided sample</a><button class="button quiet" type="button" data-sign-out>Sign out</button></div></header><section class="focus-work"><div class="focus-top"><span class="eyebrow">Your practice</span><span class="badge accent">Signed in</span></div><div class="focus-body"><p class="small">Python · English</p><h1>Start with the work.<br>Keep the evidence.</h1><p>Personal attempts preserve your code, exact test results, and text conversation. The guided sample remains separate.</p><div class="actions"><button class="button primary" type="button" data-personal-page="catalog">Choose a problem</button><a class="button quiet" href="#sample">Explore the sample</a></div></div></section><section class="home-history"><div class="section-heading"><h2>Recent sessions</h2></div>${attempts ? `<ol class="session-table">${attempts}</ol>${state.historyMore ? `<button class="button quiet" data-more-attempts>Load more sessions</button>` : ""}` : `<p class="empty-inline">Nothing recorded yet. Choose an authored problem when you are ready.</p>`}</section><section class="home-route"><div class="section-heading"><h2>Available practice</h2><button class="button quiet small" type="button" data-personal-page="catalog">Open roadmap</button></div>${filters}<ol class="drawer-problems">${problems}</ol>${matching.length > filter.limit ? `<button class="button quiet" type="button" data-more-problems>Show more problems</button>` : ""}</section></main>`;
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

function workspaceMarkup(state) {
  const detail = state.attempt;
  const problem = detail.problem;
  const transcript = detail.transcripts.map((segment) => `<div class="message"><div class="speaker">${escapeHtml(segment.speaker)}<time>${escapeHtml(segment.end_offset_ms)} ms</time></div><p>${escapeHtml(segment.text)}</p></div>`).join("") || `<p class="small muted">No conversation messages recorded yet.</p>`;
  const runs = testResultsMarkup(detail);
  const review = detail.review ? `<p class="small">Review: <strong>${escapeHtml(detail.review.status)}</strong>${detail.review.failure_reason ? ` · ${escapeHtml(detail.review.failure_reason)}` : ""} <button class="button quiet small" type="button" data-open-review>Inspect review</button></p>` : "";
  const disabled = detail.attempt.status === "completed" ? "disabled" : "";
  const isVoice = detail.attempt.input_mode === "voice";
  const voiceControl = isVoice ? `<span id="voice-status" class="small muted" role="status">Voice ready</span><button class="button primary small" type="button" data-voice-toggle ${disabled}>Start voice</button>` : "";
  return `<main id="main" class="workspace-main personal-workspace"><div class="session-header"><div class="actions"><button class="button quiet small" type="button" data-personal-page="sessions">← Sessions</button><h1>${escapeHtml(problem.title)}</h1><span class="badge">${escapeHtml(detail.attempt.mode)} · ${escapeHtml(detail.attempt.status)}</span></div><div class="actions"><span class="small muted">${isVoice ? "Deepgram voice" : "Text"} evidence · revision ${escapeHtml(detail.attempt.draft_revision)}</span><button class="button quiet small" type="button" data-save-draft ${disabled}>Save & exit</button><button class="button secondary small" type="button" data-finish ${disabled}>Finish interview</button></div></div><div class="workspace"><div class="left-column"><section class="problem-pane pane"><div class="panel-top"><span>Problem</span><span class="small muted">Original authored revision</span></div><div class="problem-scroll"><p class="problem-prompt">${escapeHtml(problem.prompt)}</p><p class="small muted">Entry point: <code>${escapeHtml(problem.entry_point)}</code></p></div></section><section class="conversation-pane pane"><div class="panel-top"><span>Conversation</span><div class="actions">${voiceControl}<button class="button quiet small" type="button" data-help ${disabled}>Request help</button></div></div><div class="conversation-body"><div class="messages" tabindex="0" role="region" aria-label="Recorded conversation">${transcript}</div><form id="personal-message-form" class="composer"><label class="sr-only" for="personal-message">Message the interviewer</label><input id="personal-message" name="message" placeholder="${isVoice ? "Speak, or type while voice is active…" : "Explain your approach…"}" autocomplete="off" ${disabled}><button class="icon-button" type="submit" aria-label="Send message" ${disabled}>→</button></form><p class="composer-note">${isVoice ? `Deepgram handles listening and speech. ${escapeHtml(state.thinkingModel)} produces the interviewer response. Raw audio is not saved.` : "Messages are stored as text evidence."}</p></div></section></div><div class="right-column"><section class="editor-pane pane"><div class="panel-top"><span>Code</span><div class="actions"><span class="small muted">Python</span><button class="button primary small" type="button" data-run ${disabled}>Run visible tests</button></div></div><label class="sr-only" for="personal-code">Python source code</label><textarea id="personal-code" class="code-editor" spellcheck="false" ${disabled}>${escapeHtml(detail.attempt.draft_source)}</textarea></section><section class="tests-pane pane"><div class="panel-top"><span>Tests / results</span></div><div class="test-body" tabindex="0" role="region" aria-label="Test results">${runs}${review}</div></section></div></div>${state.attempt.hasMore ? `<button class="button quiet" data-more-evidence>Load more evidence</button>` : ""}</main>`;
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

export function mountPersonal(root) {
  const state = { user: null, catalog: [], attempts: [], attempt: null, review: null, related: [], collectionEnabled: false, voiceEnabled: false, voiceProvider: VOICE_PROVIDER, thinkingModel: THINKING_MODEL, page: "home", sourceOrder: 0, lastOffsetMs: 0, selectedProblemId: null, catalogFilter: { topic: "", difficulty: "", limit: 30 } };
  let authMode = "sign-in";
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
    if (!state.attempt || state.page !== "workspace" || state.selectedProblemId) stopVoice();
    if (!state.collectionEnabled) { root.innerHTML = collectionUnavailableMarkup(); return; }
    if (!state.user) { root.innerHTML = authMarkup(); return; }
    if (state.page === "review") { root.innerHTML = reviewMarkup(state); return; }
    if (state.page === "related") { root.innerHTML = relatedMarkup(state); return; }
    if (state.selectedProblemId) {
      const problem = state.catalog.find((item) => item.id === state.selectedProblemId);
      root.innerHTML = problem ? setupMarkup(state, problem) : dashboardMarkup(state);
      return;
    }
    root.innerHTML = state.attempt ? workspaceMarkup(state) : dashboardMarkup(state);
  };
  const reload = async () => {
    const availability = await api("/api/personal-availability");
    state.collectionEnabled = availability.collectionEnabled === true;
    state.voiceEnabled = availability.voiceEnabled === true;
    state.voiceProvider = availability.voiceProvider || VOICE_PROVIDER;
    state.thinkingModel = availability.thinkingModel || THINKING_MODEL;
    if (!state.collectionEnabled) return;
    const [me, catalog, attempts] = await Promise.all([api("/api/me"), api("/api/catalog"), api("/api/attempts")]);
    state.user = me;
    state.catalog = catalog.problems;
    state.attempts = attempts.attempts; state.historyPage = attempts.page; state.historyMore = attempts.hasMore;
  };
  const openAttempt = async (attemptId) => {
    stopVoice();
    if (state.attempt?.attempt.id !== attemptId) state.lastOffsetMs = 0;
    state.attempt = await api(`/api/attempts/${encodeURIComponent(attemptId)}`);
    state.review = state.attempt.review ? await api(`/api/attempts/${encodeURIComponent(attemptId)}/review`).catch(() => null) : null;
    state.related = [];
    state.page = "workspace";
    state.selectedProblemId = null;
    render();
  };
  const saveDraft = async () => {
    const source = root.querySelector("#personal-code")?.value;
    if (typeof source !== "string" || !state.attempt) return;
    const result = await api(`/api/attempts/${encodeURIComponent(state.attempt.attempt.id)}/draft`, { method: "PATCH", body: { source, expectedRevision: state.attempt.attempt.draft_revision, ...sourceMetadata(state, "draft") } });
    state.attempt.attempt.draft_source = source;
    state.attempt.attempt.draft_revision = result.draftRevision;
  };
  root.addEventListener("click", async (event) => {
    const control = event.target.closest("button");
    if (!control) return;
    try {
      if (control.dataset.authView) {
        authMode = control.dataset.authView;
        root.querySelector("[data-signup-name]").hidden = authMode !== "sign-up";
        root.querySelector("#auth-password").autocomplete = authMode === "sign-up" ? "new-password" : "current-password";
        root.querySelectorAll("[data-auth-view]").forEach((button) => { const selected = button.dataset.authView === authMode; button.classList.toggle("selected", selected); button.setAttribute("aria-pressed", String(selected)); });
      } else if (control.dataset.personalPage === "catalog") { state.page = "home"; state.attempt = null; state.selectedProblemId = null; render(); root.querySelector(".home-route")?.scrollIntoView({ block: "start" }); }
      else if (control.dataset.personalPage === "home" || control.dataset.personalPage === "sessions") {
        if (state.page === "workspace" && state.attempt && state.attempt.attempt.status !== "completed") await saveDraft();
        await reload(); state.page = "home"; state.attempt = null; state.selectedProblemId = null; render();
      }
      else if (control.dataset.personalPage === "workspace") { state.page = "workspace"; render(); }
      else if (control.dataset.personalPage === "review") { state.page = "review"; render(); }
      else if (control.dataset.startProblem) { state.attempt = null; state.selectedProblemId = control.dataset.startProblem; render(); }
      else if (control.hasAttribute("data-more-problems")) { state.catalogFilter.limit += 30; render(); root.querySelector("[data-more-problems]")?.focus(); }
      else if (control.hasAttribute("data-more-attempts")) {
        const page = await api(`/api/attempts?page=${state.historyPage + 1}`);
        state.attempts.push(...page.attempts); state.historyPage = page.page; state.historyMore = page.hasMore; render();
      }
      else if (control.hasAttribute("data-more-evidence")) {
        const page = await api(`/api/attempts/${encodeURIComponent(state.attempt.attempt.id)}?page=${state.attempt.page + 1}`);
        for (const key of ["events", "transcripts", "checkpoints", "runs"]) state.attempt[key].push(...page[key]);
        state.attempt.page = page.page; state.attempt.hasMore = page.hasMore; render();
      }
      else if (control.dataset.openAttempt) await openAttempt(control.dataset.openAttempt);
      else if (control.hasAttribute("data-open-review")) { state.page = "review"; render(); }
      else if (control.hasAttribute("data-open-related")) { state.related = (await api(`/api/attempts/${encodeURIComponent(state.attempt.attempt.id)}/related`)).relatedProblems; state.page = "related"; render(); }
      else if (control.hasAttribute("data-voice-toggle")) { await startVoice(); }
      else if (control.dataset.startRelated) { state.selectedProblemId = control.dataset.startRelated; state.page = "home"; render(); }
      else if (control.dataset.retryCheckpoint) { const result = await api(`/api/attempts/${encodeURIComponent(state.attempt.attempt.id)}/retry`, { method: "POST", body: { checkpointId: control.dataset.retryCheckpoint, practiceGoal: "Focused retry" } }); await openAttempt(result.attemptId); }
      else if (control.hasAttribute("data-sign-out")) { await api("/api/auth/sign-out", { method: "POST", body: {} }); state.user = null; state.attempt = null; render(); }
      else if (control.hasAttribute("data-save-draft")) { await saveDraft(); await reload(); state.attempt = null; render(); }
      else if (control.hasAttribute("data-run")) {
        control.disabled = true; control.textContent = "Running…";
        try {
          await saveDraft();
          const result = await api(`/api/attempts/${encodeURIComponent(state.attempt.attempt.id)}/run`, { method: "POST", body: sourceMetadata(state, "run") });
          await openAttempt(state.attempt.attempt.id);
          showError(`Run recorded: ${result.testsPassed} passed, ${result.testsFailed} failed.`);
          root.querySelector(".tests-pane")?.scrollIntoView({ block: "nearest" });
        } finally { control.disabled = false; control.textContent = "Run visible tests"; }
      }
      else if (control.hasAttribute("data-finish")) {
        control.disabled = true;
        try {
          await saveDraft();
          const result = await api(`/api/attempts/${encodeURIComponent(state.attempt.attempt.id)}/finish`, { method: "POST", body: sourceMetadata(state, "finish") });
          await openAttempt(state.attempt.attempt.id);
          showError(`Attempt completed. Review dispatch: ${result.dispatch}.`);
        } finally { control.disabled = false; }
      }
      else if (control.hasAttribute("data-help")) { const result = await api(`/api/attempts/${encodeURIComponent(state.attempt.attempt.id)}/help`, { method: "POST", body: { category: "hint", ...sourceMetadata(state, "help") } }); if (result.voiceReady && voiceSession?.active) voiceSession.sendText("I am requesting a hint."); else showError(result.message); }
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
        await api(authMode === "sign-up" ? "/api/auth/sign-up/email" : "/api/auth/sign-in/email", { method: "POST", body: authMode === "sign-up" ? { email, password, name } : { email, password } });
        await reload(); render();
      } else if (form.id === "personal-setup-form") {
        const data = new FormData(form);
        const result = await api("/api/attempts", { method: "POST", body: { problemId: data.get("problemId"), mode: data.get("mode"), inputMode: data.get("inputMode"), saveAudio: false, consent: data.get("consent") === "on", familiarity: "unanswered", practiceGoal: data.get("practiceGoal"), setupContext: { studiedTopics: data.get("studiedTopics"), concern: data.get("concern") } } });
        await openAttempt(result.attemptId);
      } else if (form.id === "personal-message-form") {
        const message = new FormData(form).get("message");
        if (typeof message !== "string" || !message.trim()) return;
        if (state.attempt.attempt.input_mode === "voice") {
          if (!voiceSession?.active) throw new Error("Start voice before sending a typed message to the live interviewer.");
          voiceSession.sendText(message.trim());
          form.reset();
        } else {
          await api(`/api/attempts/${encodeURIComponent(state.attempt.attempt.id)}/messages`, { method: "POST", body: { text: message, ...sourceMetadata(state, "message") } });
          await openAttempt(state.attempt.attempt.id);
        }
      } else if (form.classList.contains("finding-correction-form")) {
        const reason = new FormData(form).get("reason");
        await api(`/api/attempts/${encodeURIComponent(state.attempt.attempt.id)}/review/findings/${encodeURIComponent(form.dataset.findingId)}/corrections`, { method: "POST", body: { reason } });
        state.review = await api(`/api/attempts/${encodeURIComponent(state.attempt.attempt.id)}/review`);
        render();
      }
    } catch (error) { showError(error instanceof Error ? error.message : "The request could not be completed."); }
  });
  const stopOnNavigation = () => {
    if (!location.hash.startsWith("#personal")) {
      stopVoice();
      window.removeEventListener("hashchange", stopOnNavigation);
    }
  };
  window.addEventListener("hashchange", stopOnNavigation);
  (async () => { try { await reload(); render(); } catch (error) { state.user = null; root.innerHTML = authMarkup(error instanceof Error ? error.message : "The data service is unavailable."); } })();
}
