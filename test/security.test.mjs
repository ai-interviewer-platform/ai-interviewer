import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { after, test } from "node:test";
import { roadmapScreen } from "../public/roadmap.js";
import { initialAttempt } from "../public/model.js";

const directory = await mkdtemp(join(tmpdir(), "interviewer-security-"));
after(() => rm(directory, { recursive: true, force: true }));
await build({ entryPoints: ["src/http.ts", "src/security.ts", "src/api.ts"], outdir: directory, outExtension: { ".js": ".mjs" }, bundle: true, format: "esm", platform: "node", plugins: [{
  name: "test-auth",
  setup(plugin) {
    plugin.onResolve({ filter: /^\.\/auth$/ }, () => ({ path: "auth", namespace: "test" }));
    plugin.onLoad({ filter: /.*/, namespace: "test" }, () => ({ contents: 'export const authenticatedUserId = async () => "owner";' }));
  },
}] });
const { boundedRequest, checkOrigin, requestBody } = await import(pathToFileURL(join(directory, "http.mjs")));
const { handleApi } = await import(pathToFileURL(join(directory, "api.mjs")));
const { limits } = await import(pathToFileURL(join(directory, "security.mjs")));
const origin = "https://interview.example";
const env = { BETTER_AUTH_URL: origin, PERSONAL_DATA_COLLECTION_APPROVED: "true" };
const request = (path, body, headers = {}) => new Request(`${origin}${path}`, { method: "POST", headers: { origin, "content-type": "application/json", ...headers }, body: JSON.stringify(body) });

test("roadmap rejects attribute injection and preserves known views", () => {
  globalThis.matchMedia = () => ({ matches: false });
  const state = { personal: initialAttempt() };
  const ui = { icon: () => "", link: () => "", button: () => "" };
  const html = roadmapScreen(state, { params: new URLSearchParams({ topic: "sets", view: '"><img src=x onerror="alert(1)">' }) }, ui);
  assert.doesNotMatch(html, /onerror|<img/);
  assert.match(html, /view=map/);
  assert.match(roadmapScreen(state, { params: new URLSearchParams({ view: "list" }) }, ui), /road-list/);
});

test("unsafe requests require the exact origin, including sibling domains", () => {
  for (const candidate of ["https://evil.example", "https://sibling.interview.example", "null"]) {
    assert.equal(checkOrigin(request("/api/attempts", {}, { origin: candidate }), origin).status, 403);
  }
  const missing = request("/api/attempts", {}); missing.headers.delete("origin");
  assert.equal(checkOrigin(missing, origin).status, 403);
  assert.equal(checkOrigin(request("/api/attempts", {}), origin), null);
});

test("request parser rejects non-JSON, oversized text and chunked bodies without Content-Length", async () => {
  assert.equal(await requestBody(request("/api/attempts", {}, { "content-type": "text/plain" })), null);
  assert.equal(await requestBody(request("/api/attempts", { text: "x".repeat(limits.textBytes + 1) })), null);
  assert.deepEqual(await requestBody(request("/api/attempts", { text: "ok" })), { text: "ok" });
  const oversized = request("/api/attempts", { text: "x".repeat(limits.requestBytes) });
  assert.equal((await boundedRequest(oversized)).status, 413);
  const normal = await boundedRequest(request("/api/attempts", { text: "ok" }));
  assert.deepEqual(await normal.json(), { text: "ok" });
});

test("forged transcripts and provider-token endpoints are inaccessible", async () => {
  const pool = { query: async sql => ({ rows: sql.startsWith("INSERT INTO security_rate_limits") ? [{ count: 1 }] : [] }) };
  for (const action of ["voice-token", "voice-transcript"]) {
    const response = await handleApi(request(`/api/attempts/owned/${action}`, { role: "assistant", text: "fake", providerSessionId: "fake" }), env, {}, pool);
    assert.equal(response.status, 404);
  }
  const response = await handleApi(request("/api/attempts", {}, { origin: "https://attacker.example" }), env, {}, { query: () => { throw new Error("Must reject before database access"); } });
  assert.equal(response.status, 403);
});

test("history and attempt evidence use bounded SQL pages", async () => {
  const queries = [];
  const pool = { query: async (sql, values) => {
    queries.push({ sql, values });
    if (sql.startsWith("INSERT INTO security_rate_limits")) return { rows: [{ count: 1 }] };
    if (sql.startsWith("SELECT * FROM attempts")) return { rows: [{ id: "owned", user_id: "owner", problem_id: "p" }] };
    return { rows: [] };
  } };
  for (const path of ["/api/attempts?page=1", "/api/attempts/owned?page=1"]) {
    assert.equal((await handleApi(new Request(origin + path), env, {}, pool)).status, 200);
  }
  const paged = queries.filter(({ sql }) => sql.includes("LIMIT $2 OFFSET $3"));
  assert.equal(paged.length, 5);
  assert.ok(paged.every(({ values }) => values[1] === limits.pageSize && values[2] === limits.pageSize));
});
