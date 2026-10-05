import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import pg from "pg";

// Explicit opt-in command; excluded from the offline *.test.mjs suite.
// Creates fictional records through HTTP only; SQL below is read-only.
const origin = process.env.BETTER_AUTH_URL ?? "http://localhost:8787";
const target = new URL(origin);
assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(target.hostname), "Use a local backend only.");
assert.equal(target.origin, origin, "BETTER_AUTH_URL must be an origin without a trailing slash.");
assert.ok(process.env.DATABASE_URL, "Set DATABASE_URL for read-only persistence verification.");
const database = new pg.Client({ connectionString: process.env.DATABASE_URL });
const runId = randomUUID();
const sessions = [];
let connected = false;

async function request(method, path, { cookie, body, rawBody, headers = {}, status = 200 } = {}) {
  const response = await fetch(origin + path, {
    method,
    headers: { origin, ...(cookie ? { cookie } : {}), ...(body !== undefined || rawBody !== undefined ? { "content-type": "application/json" } : {}), ...headers },
    ...(rawBody !== undefined || body !== undefined ? { body: rawBody ?? JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(15000),
    redirect: "error",
  });
  const data = await response.json();
  // Do not print auth bodies: they can contain session tokens.
  assert.equal(response.status, status, `${method} ${path}: expected ${status}, received ${response.status}`);
  if (status >= 400) assert.ok(data.error || data.message, "Expected a structured error.");
  console.log(`PASS ${method} ${path} -> ${status}`);
  return { data, cookie: response.headers.getSetCookie().map(value => value.split(";", 1)[0]).join("; ") };
}

async function user(label) {
  const email = `backend-api-${label}-${runId}@example.invalid`;
  const password = randomBytes(24).toString("base64url");
  const signup = await request("POST", "/api/auth/sign-up/email", { body: { name: `Fictional API ${label}`, email, password } });
  assert.equal(signup.data.user.email, email);
  assert.ok(signup.cookie);
  sessions.push(signup.cookie);
  const login = await request("POST", "/api/auth/sign-in/email", { body: { email, password } });
  assert.ok(login.cookie);
  sessions.push(login.cookie);
  const session = await request("GET", "/api/auth/get-session", { cookie: login.cookie });
  assert.equal(session.data.user.email, email);
  assert.ok(session.data.session.id);
  return { email, id: session.data.user.id, cookie: login.cookie };
}

try {
  const health = (await request("GET", "/api/health")).data;
  assert.equal(health.status, "ok");
  assert.equal(health.version, null, "Only npm run deploy stamps a version");
  assert.equal((await request("GET", "/api/personal-availability")).data.collectionEnabled, true, "Local collection must already be enabled for fictional testing.");
  const owner = await user("owner");
  const me = await request("GET", "/api/me", { cookie: owner.cookie });
  assert.equal(me.data.userId, owner.id);
  const catalog = (await request("GET", "/api/catalog")).data;
  assert.ok(catalog.problems.length > 0);
  assert.ok(catalog.problems.every(problem => !("reference_solution" in problem)));
  const problem = catalog.problems[0];
  const body = { problemId: problem.id, mode: "mock", inputMode: "text", practiceGoal: `Fictional backend API verification ${runId}`, consent: true, saveAudio: false, familiarity: "unanswered", setupContext: { studiedTopics: "Loops", concern: "Fictional test only" } };
  const attemptId = (await request("POST", "/api/attempts", { cookie: owner.cookie, body, status: 201 })).data.attemptId;
  assert.ok(attemptId);
  const path = `/api/attempts/${attemptId}`;
  const initial = (await request("GET", path, { cookie: owner.cookie })).data;
  assert.equal(initial.attempt.user_id, owner.id);
  assert.equal(initial.attempt.problem_id, problem.id);
  const source = `# Fictional persistence test ${runId}\n${problem.starter_code}\n`;
  const draft = { source, expectedRevision: initial.attempt.draft_revision, sourceId: `${runId}:draft`, sourceOrder: 1, occurrenceOffsetMs: 1000 };
  const saved = (await request("PATCH", `${path}/draft`, { cookie: owner.cookie, body: draft })).data;
  assert.equal(saved.draftRevision, draft.expectedRevision + 1);
  const detail = (await request("GET", path, { cookie: owner.cookie })).data;
  assert.equal(detail.attempt.draft_source, source);
  assert.equal(detail.attempt.draft_revision, saved.draftRevision);
  assert.ok(detail.events.some(event => event.event_type === "draft_saved"));
  const message = { text: "Fictional candidate message: I will inspect the loop.", sourceId: `${runId}:message`, sourceOrder: 2, occurrenceOffsetMs: 2000 };
  const posted = (await request("POST", `${path}/messages`, { cookie: owner.cookie, body: message, status: 201 })).data;
  const repeated = (await request("POST", `${path}/messages`, { cookie: owner.cookie, body: message, status: 201 })).data;
  assert.equal(repeated.eventId, posted.eventId, "Repeated message metadata must not duplicate evidence.");
  const help = (await request("POST", `${path}/help`, { cookie: owner.cookie, body: { category: "hint", sourceId: `${runId}:help`, sourceOrder: 3, occurrenceOffsetMs: 3000 }, status: 202 })).data;
  assert.equal(help.delivered, false);
  assert.equal(help.voiceReady, false);
  const related = (await request("GET", `${path}/related`, { cookie: owner.cookie })).data;
  assert.ok(Array.isArray(related.relatedProblems));
  const history = (await request("GET", "/api/attempts?page=0", { cookie: owner.cookie })).data;
  assert.ok(history.attempts.some(attempt => attempt.id === attemptId));
  const latest = (await request("GET", path, { cookie: owner.cookie })).data;
  assert.equal(latest.transcripts.filter(segment => segment.event_id === posted.eventId).length, 1);
  assert.equal(latest.transcripts.find(segment => segment.event_id === posted.eventId).text, message.text);

  await request("GET", path, { status: 401 });
  const other = await user("other");
  await request("GET", path, { cookie: other.cookie, status: 403 });
  await request("PATCH", `${path}/draft`, { cookie: other.cookie, body: { ...draft, expectedRevision: saved.draftRevision }, status: 403 });
  const otherHistory = (await request("GET", "/api/attempts", { cookie: other.cookie })).data;
  assert.ok(!otherHistory.attempts.some(attempt => attempt.id === attemptId));
  await request("PATCH", `${path}/draft`, { cookie: owner.cookie, body: draft, status: 409 });
  await request("POST", "/api/attempts", { cookie: owner.cookie, body: { ...body, consent: false }, status: 400 });
  await request("POST", "/api/attempts", { cookie: owner.cookie, body: { ...body, problemId: "missing-fictional-problem" }, status: 400 });
  await request("POST", `${path}/messages`, { cookie: owner.cookie, body: { text: "" }, status: 400 });
  await request("PATCH", `${path}/draft`, { cookie: owner.cookie, rawBody: "{", status: 400 });
  await request("PATCH", `${path}/draft`, { cookie: owner.cookie, body: draft, headers: { "content-type": "text/plain" }, status: 400 });
  await request("GET", "/api/attempts?page=-1", { cookie: owner.cookie, status: 400 });
  await request("GET", `${path}/review`, { cookie: owner.cookie, status: 404 });
  await request("GET", `/api/attempts/${randomUUID()}`, { cookie: owner.cookie, status: 403 });
  await request("GET", "/api/unknown-verification-route", { cookie: owner.cookie, status: 404 });
  const afterErrors = (await request("GET", path, { cookie: owner.cookie })).data;
  assert.equal(afterErrors.attempt.draft_source, source);
  assert.equal(afterErrors.attempt.draft_revision, saved.draftRevision);

  await database.connect();
  connected = true;
  await database.query("BEGIN READ ONLY");
  const stored = await database.query("SELECT user_id, draft_source, draft_revision FROM attempts WHERE id = $1", [attemptId]);
  assert.deepEqual(stored.rows, [{ user_id: owner.id, draft_source: source, draft_revision: saved.draftRevision }]);
  const transcript = await database.query("SELECT text FROM transcript_segments WHERE attempt_id = $1 AND event_id = $2", [attemptId, posted.eventId]);
  assert.deepEqual(transcript.rows, [{ text: message.text }]);
  const assistance = await database.query("SELECT category, delivered FROM assistance_events WHERE attempt_id = $1 AND event_id = $2", [attemptId, help.eventId]);
  assert.deepEqual(assistance.rows, [{ category: "hint", delivered: false }]);
  const events = await database.query("SELECT event_type FROM attempt_events WHERE attempt_id = $1 ORDER BY occurrence_offset_ms", [attemptId]);
  assert.deepEqual(events.rows.map(row => row.event_type), ["attempt_started", "draft_saved", "candidate_text", "help_requested"]);
  await database.query("ROLLBACK");
  console.log(`PASS read-only PostgreSQL persistence and rejected-write checks; attempt=${attemptId}; owner=${owner.email}; other=${other.email}`);
} finally {
  if (connected) await database.end();
  for (const cookie of sessions) {
    await request("POST", "/api/auth/sign-out", { cookie, body: {} });
    assert.equal((await request("GET", "/api/auth/get-session", { cookie })).data, null, "Signed-out sessions must be revoked.");
  }
}
