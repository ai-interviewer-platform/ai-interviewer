const escapeHtml = (value) => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");

async function api(path, options = {}) {
  const response = await fetch(path, {
    credentials: "same-origin",
    headers: options.body ? { "content-type": "application/json" } : undefined,
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || "The request could not be completed.");
  return payload;
}

function sourceMetadata(state, name) {
  state.sourceOrder += 1;
  return {
    sourceId: `${name}:${crypto.randomUUID()}`,
    sourceOrder: state.sourceOrder,
    occurrenceOffsetMs: Math.max(0, Math.round(performance.now() - state.openedAt)),
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
  const problems = state.catalog.map((problem) => `<li><strong>${escapeHtml(problem.title)}</strong><span>${escapeHtml(problem.topic)} · ${escapeHtml(problem.difficulty)}</span><button class="button secondary small" type="button" data-start-problem="${escapeHtml(problem.id)}">Set up practice</button></li>`).join("");
  return `<main id="main" class="page-main"><header class="app-header"><a class="wordmark" href="#welcome"><span class="brand-mark" aria-hidden="true">[·]</span>Interview trainer</a><nav aria-label="Primary"><button class="button nav-link current" type="button" data-personal-page="home">Home</button><button class="button nav-link" type="button" data-personal-page="catalog">Roadmap</button><button class="button nav-link" type="button" data-personal-page="sessions">Sessions</button></nav><div class="header-end"><a class="button quiet" href="#sample">Guided sample</a><button class="button quiet" type="button" data-sign-out>Sign out</button></div></header><section class="focus-work"><div class="focus-top"><span class="eyebrow">Your practice</span><span class="badge accent">Signed in</span></div><div class="focus-body"><span class="folio-index" aria-hidden="true">→</span><p class="small">Python · English</p><h1>Start with the work.<br>Keep the evidence.</h1><p>Personal attempts preserve your code, exact test results, and text conversation. The guided sample remains separate.</p><div class="actions"><button class="button primary" type="button" data-personal-page="catalog">Choose a problem</button><a class="button quiet" href="#sample">Explore the sample</a></div></div></section><section class="home-history"><div class="section-heading"><h2>Recent sessions</h2></div>${attempts ? `<ol class="session-table">${attempts}</ol>` : `<p class="empty-inline">Nothing recorded yet. Choose an authored problem when you are ready.</p>`}</section><section class="home-route"><div class="section-heading"><h2>Available practice</h2><button class="button quiet small" type="button" data-personal-page="catalog">Open roadmap</button></div><ol class="drawer-problems">${problems}</ol></section></main>`;
}

function setupMarkup(state, problem) {
  return `<main id="main" class="page-main"><a class="back-link" href="#welcome">← Back to home</a><div class="setup-grid"><section><p class="eyebrow">Personal setup</p><h1>Make room to think.</h1><p class="intro">Text practice is ready for the real evidence path. Voice stays unavailable until the provider transport and personal-data disclosures are verified.</p><div class="setup-problem"><span aria-hidden="true">⌘</span><div><span class="small muted">Selected problem</span><h2>${escapeHtml(problem.title)}</h2><p>${escapeHtml(problem.topic)} · Python · English</p></div></div><p>${escapeHtml(problem.prompt)}</p></section><form id="personal-setup-form" class="setup-form"><h2>Session preferences</h2><input type="hidden" name="problemId" value="${escapeHtml(problem.id)}"><label for="practice-goal">What are you preparing for?</label><input id="practice-goal" name="practiceGoal" value="Coding interviews" required><label for="studied-topics">Topics you have studied</label><input id="studied-topics" name="studiedTopics" autocomplete="off"><label for="concern">Anything you want to work on? <span class="muted">Optional</span></label><input id="concern" name="concern" autocomplete="off"><fieldset><legend>Practice mode</legend><div class="choice-pair"><label class="choice"><input type="radio" name="mode" value="mock" checked><span>Mock<small>Neutral clarification and requested help.</small></span></label><label class="choice"><input type="radio" name="mode" value="coach"><span>Coach<small>Requested guidance is recorded.</small></span></label></div></fieldset><div class="notice">Text input is selected. Voice and retained audio are disabled until their runtime and policy gates are complete.</div><label class="check-row"><input type="checkbox" name="consent" required><span>Allow transcript, code checkpoints, and test evidence to be stored for this review.<small>Without personal session records, use the guided sample instead.</small></span></label><div class="actions"><button class="button primary" type="submit">Start interview</button><a class="button quiet" href="#sample">Use the sample instead</a></div></form></div></main>`;
}

function workspaceMarkup(state) {
  const detail = state.attempt;
  const problem = detail.problem;
  const transcript = detail.transcripts.map((segment) => `<div class="message"><div class="speaker">${escapeHtml(segment.speaker)}<time>${escapeHtml(segment.end_offset_ms)} ms</time></div><p>${escapeHtml(segment.text)}</p></div>`).join("") || `<p class="small muted">No conversation messages recorded yet.</p>`;
  const runs = detail.runs.map((run) => `<li><strong>${escapeHtml(run.status)}</strong> · ${escapeHtml(run.tests_passed)} passed, ${escapeHtml(run.tests_failed)} failed <small>${escapeHtml(run.runner_error || "")}</small></li>`).join("") || `<li>Run the visible tests to create an immutable checkpoint.</li>`;
  const review = detail.review ? `<p class="small">Review: <strong>${escapeHtml(detail.review.status)}</strong>${detail.review.failure_reason ? ` · ${escapeHtml(detail.review.failure_reason)}` : ""} <button class="button quiet small" type="button" data-open-review>Inspect review</button></p>` : "";
  const disabled = detail.attempt.status === "completed" ? "disabled" : "";
  return `<main id="main" class="workspace-main personal-workspace"><div class="session-header"><div class="actions"><a class="button quiet small" href="#welcome">← Sessions</a><h1>${escapeHtml(problem.title)}</h1><span class="badge">${escapeHtml(detail.attempt.mode)} · ${escapeHtml(detail.attempt.status)}</span></div><div class="actions"><span class="small muted">Text evidence · revision ${escapeHtml(detail.attempt.draft_revision)}</span><button class="button quiet small" type="button" data-save-draft ${disabled}>Save & exit</button><button class="button secondary small" type="button" data-finish ${disabled}>Finish interview</button></div></div><div class="workspace"><div class="left-column"><section class="problem-pane pane"><div class="panel-top"><span>Problem</span><span class="small muted">Original authored revision</span></div><div class="problem-scroll"><p>${escapeHtml(problem.prompt)}</p><p class="small muted">Entry point: <code>${escapeHtml(problem.entry_point)}</code></p></div></section><section class="conversation-pane pane"><div class="panel-top"><span>Conversation</span><button class="button quiet small" type="button" data-help ${disabled}>Request help</button></div><div class="conversation-body"><div class="messages" tabindex="0" role="region" aria-label="Recorded conversation">${transcript}</div><form id="personal-message-form" class="composer"><label class="sr-only" for="personal-message">Message the interviewer</label><input id="personal-message" name="message" placeholder="Explain your approach…" autocomplete="off" ${disabled}><button class="icon-button" type="submit" aria-label="Send message" ${disabled}>→</button></form><p class="composer-note">Messages are stored as text evidence. A live interviewer response is unavailable until the selected voice transport is verified.</p></div></section></div><div class="right-column"><section class="editor-pane pane"><div class="panel-top"><span>Code</span><div class="actions"><span class="small muted">Python</span><button class="button primary small" type="button" data-run ${disabled}>Run visible tests</button></div></div><label class="sr-only" for="personal-code">Python source code</label><textarea id="personal-code" class="code-editor" spellcheck="false" ${disabled}>${escapeHtml(detail.attempt.draft_source)}</textarea></section><section class="tests-pane pane"><div class="panel-top"><span>Tests / results</span></div><ul class="test-list">${runs}</ul>${review}</section></div></div></main>`;
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
  const state = { user: null, catalog: [], attempts: [], attempt: null, review: null, related: [], collectionEnabled: false, page: "home", sourceOrder: 0, openedAt: performance.now(), selectedProblemId: null };
  let authMode = "sign-in";
  const showError = (message) => { root.querySelector("#personal-error")?.remove(); const target = root.querySelector("main"); if (target) target.insertAdjacentHTML("afterbegin", `<p id="personal-error" class="inline-alert" role="alert">${escapeHtml(message)}</p>`); };
  const render = () => {
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
    if (!state.collectionEnabled) return;
    const [me, catalog, attempts] = await Promise.all([api("/api/me"), api("/api/catalog"), api("/api/attempts")]);
    state.user = me;
    state.catalog = catalog.problems;
    state.attempts = attempts.attempts;
  };
  const openAttempt = async (attemptId) => {
    state.attempt = await api(`/api/attempts/${encodeURIComponent(attemptId)}`);
    state.review = state.attempt.review ? await api(`/api/attempts/${encodeURIComponent(attemptId)}/review`).catch(() => null) : null;
    state.related = [];
    state.page = "workspace";
    state.selectedProblemId = null;
    state.openedAt = performance.now();
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
      else if (control.dataset.personalPage === "home" || control.dataset.personalPage === "sessions") { state.page = "home"; state.attempt = null; state.selectedProblemId = null; render(); }
      else if (control.dataset.personalPage === "workspace") { state.page = "workspace"; render(); }
      else if (control.dataset.personalPage === "review") { state.page = "review"; render(); }
      else if (control.dataset.startProblem) { state.attempt = null; state.selectedProblemId = control.dataset.startProblem; render(); }
      else if (control.dataset.openAttempt) await openAttempt(control.dataset.openAttempt);
      else if (control.hasAttribute("data-open-review")) { state.page = "review"; render(); }
      else if (control.hasAttribute("data-open-related")) { state.related = (await api(`/api/attempts/${encodeURIComponent(state.attempt.attempt.id)}/related`)).relatedProblems; state.page = "related"; render(); }
      else if (control.dataset.startRelated) { state.selectedProblemId = control.dataset.startRelated; state.page = "home"; render(); }
      else if (control.dataset.retryCheckpoint) { const result = await api(`/api/attempts/${encodeURIComponent(state.attempt.attempt.id)}/retry`, { method: "POST", body: { checkpointId: control.dataset.retryCheckpoint, practiceGoal: "Focused retry" } }); await openAttempt(result.attemptId); }
      else if (control.hasAttribute("data-sign-out")) { await api("/api/auth/sign-out", { method: "POST" }); state.user = null; state.attempt = null; render(); }
      else if (control.hasAttribute("data-save-draft")) { await saveDraft(); await reload(); state.attempt = null; render(); }
      else if (control.hasAttribute("data-run")) { await saveDraft(); await openAttempt(state.attempt.attempt.id); const result = await api(`/api/attempts/${encodeURIComponent(state.attempt.attempt.id)}/run`, { method: "POST", body: sourceMetadata(state, "run") }); showError(`Run recorded: ${result.testsPassed} passed, ${result.testsFailed} failed.`); await openAttempt(state.attempt.attempt.id); }
      else if (control.hasAttribute("data-finish")) { await saveDraft(); await openAttempt(state.attempt.attempt.id); const result = await api(`/api/attempts/${encodeURIComponent(state.attempt.attempt.id)}/finish`, { method: "POST", body: sourceMetadata(state, "finish") }); showError(`Attempt completed. Review dispatch: ${result.dispatch}.`); await openAttempt(state.attempt.attempt.id); }
      else if (control.hasAttribute("data-help")) { const result = await api(`/api/attempts/${encodeURIComponent(state.attempt.attempt.id)}/help`, { method: "POST", body: { category: "hint", ...sourceMetadata(state, "help") } }); showError(result.message); await openAttempt(state.attempt.attempt.id); }
    } catch (error) { showError(error instanceof Error ? error.message : "The request could not be completed."); }
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
        const result = await api("/api/attempts", { method: "POST", body: { problemId: data.get("problemId"), mode: data.get("mode"), inputMode: "text", saveAudio: false, consent: data.get("consent") === "on", familiarity: "unanswered", practiceGoal: data.get("practiceGoal"), setupContext: { studiedTopics: data.get("studiedTopics"), concern: data.get("concern") } } });
        await openAttempt(result.attemptId);
      } else if (form.id === "personal-message-form") {
        const message = new FormData(form).get("message");
        if (typeof message !== "string" || !message.trim()) return;
        await api(`/api/attempts/${encodeURIComponent(state.attempt.attempt.id)}/messages`, { method: "POST", body: { text: message, ...sourceMetadata(state, "message") } });
        await openAttempt(state.attempt.attempt.id);
      } else if (form.classList.contains("finding-correction-form")) {
        const reason = new FormData(form).get("reason");
        await api(`/api/attempts/${encodeURIComponent(state.attempt.attempt.id)}/review/findings/${encodeURIComponent(form.dataset.findingId)}/corrections`, { method: "POST", body: { reason } });
        state.review = await api(`/api/attempts/${encodeURIComponent(state.attempt.attempt.id)}/review`);
        render();
      }
    } catch (error) { showError(error instanceof Error ? error.message : "The request could not be completed."); }
  });
  (async () => { try { await reload(); render(); } catch (error) { state.user = null; root.innerHTML = authMarkup(error instanceof Error ? error.message : "The data service is unavailable."); } })();
}
