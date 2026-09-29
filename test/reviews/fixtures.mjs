export const env = { PERSONAL_DATA_COLLECTION_APPROVED: "true", REVIEW_PROVIDER_API_KEY: "fictional-key", REVIEW_PROVIDER_MODEL: "fixture-model" };
export const finding = { observation: "The submitted code sums odd indexes.", interpretation: null, limitations: "Only visible tests were observed.", suggested_action: "Explain the index selection.", criterion: "Correctness", evidence_status: "reproducible_observation", evidenceIds: ["submission", "run", "transcript"] };
export const evidence = [
  { id: "transcript", type: "candidate_text", occurrenceOffsetMs: 0, transcript: { id: "segment", speaker: "candidate", text: "I will sum odd indexes." }, checkpoint: null, run: null, assistance: null },
  { id: "run", type: "code_run", occurrenceOffsetMs: 1, transcript: null, checkpoint: null, run: { id: "run-record", checkpointId: "final", status: "passed", testResults: [{ testId: "visible", outcome: "passed" }] }, assistance: null },
  { id: "submission", type: "code_checkpoint", occurrenceOffsetMs: 2, transcript: null, checkpoint: { id: "final", type: "submission", source: "def solve(values): return sum(values[1::2])" }, run: null, assistance: null },
];
export const envelope = (value = { findings: [finding] }) => ({ status: "completed", output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: typeof value === "string" ? value : JSON.stringify(value) }] }] });
export function fakeDatabase({ status = "pending", failCitation = false, rows = evidence, manifest = { attemptId: "attempt", finalCheckpointId: "final", frozenAt: "2026-09-22T00:00:00Z" } } = {}) {
  let saved = { status, findings: [], citations: [], reason: null, reviewTokens: 0 };
  let working;
  let tokensOutsideTransaction = 0;
  const queries = [];
  // The client holds the transaction; the pool is autocommit, as in pg.
  const client = { release() {}, query: (sql, values) => run(sql, values, true) };
  const pool = { queries, get saved() { return saved; }, get reviewTokens() { return saved.reviewTokens + tokensOutsideTransaction; }, async connect() { return client; }, query: (sql, values) => run(sql, values, false) };
  async function run(sql, values = [], inTransaction) {
    queries.push({ sql, values });
    if (sql === "BEGIN") working = structuredClone(saved);
    else if (sql === "COMMIT") saved = working;
    else if (sql === "ROLLBACK") working = undefined;
    else if (sql.startsWith("SET LOCAL")) return { rows: [] };
    // The daily review cap: owner lookup, then the rate bucket (always allowed here).
    else if (sql.startsWith("SELECT user_id FROM attempts")) return { rows: [{ user_id: "owner" }] };
    else if (sql.startsWith("DELETE FROM security_rate_limits")) return { rows: [] };
    else if (sql.includes("INSERT INTO security_rate_limits")) { if (inTransaction) working.reviewTokens++; else tokensOutsideTransaction++; return { rows: [{ count: 1 }] }; }
    else if (sql.startsWith("SELECT id, attempt_id")) return { rows: [{ id: "review", attempt_id: "attempt", status: saved.status, evidence_manifest: manifest }] };
    else if (sql.includes("FROM attempts a JOIN problems")) { if (values[0] !== "attempt") throw new Error("Wrong scope"); return { rows: [{ status: "completed", source_attempt_id: null, prompt: "Sum odd indexes", mode: "mock", input_mode: "text" }] }; }
    else if (sql.includes("WITH selected")) { if (values[0] !== "attempt") throw new Error("Wrong scope"); return { rows: rows.map(evidence => ({ evidence })) }; }
    else if (sql.includes("INSERT INTO review_findings")) working.findings.push(values);
    else if (sql.includes("INSERT INTO finding_evidence")) { if (failCitation) throw new Error("Fictional database failure"); working.citations.push(values); }
    else if (sql.includes("status = 'ready'")) working.status = "ready";
    else if (sql.includes("status = 'failed'")) { working.status = "failed"; working.reason = values[1]; }
    else if (!sql.includes("SET started_at")) throw new Error(`Unexpected SQL: ${sql}`);
    return { rows: [] };
  }
  return pool;
}
