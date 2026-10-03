// The attempt session client: every Attempt request from the candidate's browser.
// The Interviewer sees only saved state (docs/adr/0001), so each request that the
// Interviewer or the timeline reads first saves a changed Draft. The client also
// builds the Attempt URLs and the Event fields, so click handlers hold none of these rules.
//
// api(path, options) sends one request; attempt() returns the open Attempt row or null;
// editorSource() returns the editor text, or undefined when no editor is shown.
export function createAttemptSession({ api, attempt, editorSource }) {
  let sourceOrder = 0;
  let lastOffsetMs = 0;
  let offsetAttemptId = null;
  const current = () => {
    const row = attempt();
    if (!row) throw new Error("No attempt is open.");
    return row;
  };
  const url = (attemptId = current().id) => `/api/attempts/${encodeURIComponent(attemptId)}`;
  const post = (path, body) => api(`${url()}${path}`, { method: "POST", body });

  // Offsets share the server's clock origin (attempt creation), like voice
  // events, so the timeline orders text, runs, help, and voice consistently.
  // They never decrease within an Attempt, even if the local clock is adjusted.
  function eventFields(name) {
    const row = current();
    if (row.id !== offsetAttemptId) { offsetAttemptId = row.id; lastOffsetMs = 0; }
    sourceOrder += 1;
    const elapsed = Date.now() - Date.parse(row.created_at);
    lastOffsetMs = Math.max(lastOffsetMs, Number.isFinite(elapsed) ? Math.round(elapsed) : 0);
    return { sourceId: `${name}:${crypto.randomUUID()}`, sourceOrder, occurrenceOffsetMs: lastOffsetMs };
  }

  // Saves the editor text when it differs from the saved Draft of an open Attempt.
  async function saveChangedDraft() {
    const row = attempt();
    const source = editorSource();
    if (!row || row.status === "completed" || typeof source !== "string" || source === row.draft_source) return;
    const result = await api(`${url()}/draft`, { method: "PATCH", body: { source, expectedRevision: row.draft_revision, ...eventFields("draft") } });
    row.draft_source = source;
    row.draft_revision = result.draftRevision;
  }

  const afterSave = (send) => async (...values) => { await saveChangedDraft(); return send(...values); };

  // A finish whose response was lost may have recorded the Submission. Its retry sends
  // the same Event fields, so the server reuses that Submission and its check.
  let pendingFinish = null;
  async function finish() {
    const attemptId = current().id;
    if (pendingFinish?.attemptId !== attemptId) pendingFinish = { attemptId, fields: eventFields("finish") };
    const result = await post("/finish", pendingFinish.fields);
    pendingFinish = null;
    return result;
  }

  return {
    saveChangedDraft,
    message: afterSave((text) => post("/messages", { text, ...eventFields("message") })),
    help: afterSave((category) => post("/help", { category, ...eventFields("help") })),
    run: afterSave(() => post("/run", eventFields("run"))),
    finish: afterSave(finish),
    detail: (attemptId, page = 0) => api(page ? `${url(attemptId)}?page=${page}` : url(attemptId)),
    review: (attemptId) => api(`${url(attemptId)}/review`),
    related: () => api(`${url()}/related`),
    retry: (checkpointId, practiceGoal) => post("/retry", { checkpointId, practiceGoal }),
    correctFinding: (findingId, reason) => post(`/review/findings/${encodeURIComponent(findingId)}/corrections`, { reason }),
  };
}
