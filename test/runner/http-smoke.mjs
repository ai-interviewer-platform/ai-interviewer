import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";

const origin = process.env.BETTER_AUTH_URL ?? "http://localhost:8787";
assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(new URL(origin).hostname), "Use a local Worker only");
let cookie;
let order = 0;
async function request(path, body, method = body === undefined ? "GET" : "POST") {
  const response = await fetch(origin + path, {
    method,
    headers: { origin, ...(cookie ? { cookie } : {}), ...(body === undefined ? {} : { "content-type": "application/json" }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(100_000),
  });
  const data = await response.json();
  assert.ok(response.ok, `${method} ${path}: ${response.status} ${data.error ?? data.message ?? "request failed"}`);
  const cookies = response.headers.getSetCookie();
  if (cookies.length) cookie = cookies.map(value => value.split(";", 1)[0]).join("; ");
  return data;
}
const metadata = () => ({ sourceId: randomUUID(), sourceOrder: ++order, occurrenceOffsetMs: order });
try {
  const available = await request("/api/personal-availability");
  assert.equal(available.collectionEnabled, true, "Local fictional collection must already be enabled");
  await request("/api/auth/sign-up/email", { name: "Fictional runner smoke test", email: `runner-${randomUUID()}@example.invalid`, password: randomBytes(24).toString("base64url") });
  assert.ok(cookie, "Expected a session cookie");
  const catalog = await request("/api/catalog");
  const problem = catalog.problems.find(item => item.id === "sum-odd-positions-v1");
  assert.ok(problem, "Expected the seeded visible-test problem");
  const { attemptId } = await request("/api/attempts", { problemId: problem.id, mode: "mock", inputMode: "text", consent: true, saveAudio: false, practiceGoal: "Fictional runner smoke test" });
  const path = `/api/attempts/${attemptId}`;
  let revision = 0;
  for (const [source, expectedStatus] of [
    ["def sum_odd_positions(values):\n    print('fictional stdout')\n    return sum(values[1::2])", "passed"],
    ["def sum_odd_positions(values):\n    return -1", "failed"],
    ["def sum_odd_positions(values):\n    while True: pass", "failed"],
  ]) {
    const saved = await request(`${path}/draft`, { source, expectedRevision: revision, ...metadata() }, "PATCH");
    revision = saved.draftRevision;
    const run = await request(`${path}/run`, metadata());
    assert.equal(run.status, expectedStatus, JSON.stringify(run));
    assert.equal(run.testResults.length, 2);
    const detail = await request(path);
    const stored = detail.runs.find(item => item.id === run.runId);
    assert.equal(stored.status, expectedStatus);
    assert.equal(stored.checkpoint_id, run.checkpointId);
    assert.ok(stored.execution_time_ms >= 0);
    if (expectedStatus === "passed") assert.match(stored.stdout, /fictional stdout/);
    console.log(`PASS live Worker binding: ${run.status}; ${run.testsPassed} passed, ${run.testsFailed} failed`);
  }
  console.log(`Fictional attempt retained for inspection: ${attemptId}`);
} finally {
  if (cookie) await request("/api/auth/sign-out", {});
}
