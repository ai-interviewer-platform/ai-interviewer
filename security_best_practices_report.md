# Security audit — AI interviewer

Date: 2026-09-16. Revision: `20b97934b637fb2cafff7a69ae954a051dea2d52`.

## Remediation status — 2026-09-16

The historical audit below describes revision `20b9793`. The subsequent security
change addresses SEC-001 through SEC-006 in source: route validation/escaping and
CSP; metered server-side voice relay; provider-origin transcript persistence;
exact-origin JSON writes; bounded input/history and serialized review dispatch;
and shared atomic PostgreSQL authentication throttling. Updated dependencies report
zero vulnerabilities in full and production-only npm audits.

Verification: 15 unit/contract tests; PostgreSQL concurrency and simulated-provider
relay tests; local Better Auth signup/session/revocation; migration invariants;
browser XSS/header regression; Home/Profile browser checks; lint/type/build checks;
and Wrangler deployment dry run. No real provider session or hosted deployment
was exercised. Apply migration 0003 before deploying. Production policy and hosted
configuration checks remain as described in the maintained architecture document.

## Historical audit executive summary

**Do not enable public personal collection until SEC-001 and SEC-002 are addressed.** The audit found a reproducible URL-triggered DOM XSS and unrestricted issuance of billable provider credentials to authenticated users. Additional weaknesses affect transcript provenance, origin validation, resource consumption, and distributed authentication throttling. No critical vulnerability or cross-user SQL authorization bypass was established.

The owner confirmed planned internet-facing production with collection enabled and ordinary interview-practice data. Current production configuration was not inspected. Application files were not changed. This report recommends changes; it does not implement them.

## Findings

| ID | Priority | Confidence | Finding |
|---|---|---|---|
| SEC-001 | High | Browser reproduced | Roadmap URL parameter executes JavaScript on the shared personal-app origin |
| SEC-002 | High | Code path verified; provider capabilities documented | Voice credentials allow unmetered billable use outside the app's intended session |
| SEC-003 | Medium | Handler reproduced with test doubles | Browser can fabricate trusted-looking interviewer evidence |
| SEC-004 | Medium, conditional | Handler reproduced; browser cookie prerequisite untested | Custom API writes lack origin and CSRF validation |
| SEC-005 | Medium | Code verified | Personal API has no application resource budgets or bounded collection reads |
| SEC-006 | Medium, conditional | Installed library defaults inspected | Authentication throttling defaults to isolate-local memory |

Severity is qualitative for this deployment, not an inherited scanner score. High means plausible account-data compromise or significant shared provider cost; medium means narrower integrity/availability exposure or a material deployment prerequisite. No arbitrary rate, size, time, or spending quota is proposed: derive these from workload measurements and owner-approved budgets.

### SEC-001 — Roadmap URL injection (CWE-79; JS-XSS-001)

**Impact:** An attacker can send a roadmap link that executes script in a victim's app origin and can read personal API responses or make authenticated requests when the victim is signed in.

- Evidence: `public/roadmap.js:15` reads `route.params.get('view')`; lines 20 and 22 interpolate it into quoted `href` attributes without escaping or enum validation. `public/app.js:294` inserts the resulting markup through `innerHTML`.
- Reproduction: `node output/security-audit/xss-proof.mjs` against local Wrangler. A percent-encoded `view` value containing `"><img src=x onerror="document.documentElement.dataset.auditXss=1">` set the DOM marker on navigation. No user account, real record, or outbound exfiltration was used. Result: `xss-proof.json`, `executed: true`.
- The fictional routes and `#personal` share the same document origin (`public/app.js:282`). Hash routing is not a security boundary. HttpOnly prevents cookie reads, but not same-origin requests made by injected script.
- Minimal fix: accept only `map` and `list` for the view; escape URL attribute values in both roadmap templates and the shared `link` helper (`public/app.js:34`). Encode URL components before interpolation. Audit the corresponding drawer return path.
- Defense in depth: deploy a script CSP and anti-framing policy compatible with the actual app. The locally served HTML had no CSP; hosted edge policies remain unverified.
- Regression proof: the encoded payload must render no injected element or executable handler, and both normal views must remain usable.

### SEC-002 — Unrestricted provider use (CWE-770 / CWE-863)

- Evidence: `src/api.ts:509` authorizes an owned, non-completed voice attempt and immediately grants a token. `src/deepgram.ts:23–44` requests a generic grant with `{}` and returns its bearer token. No persisted grant budget, active-session allocation, usage accounting, or concurrency check exists. `src/browser/voice-agent.js:49` supplies the agent configuration from the untrusted browser.
- Abuse: register, create one voice attempt, request tokens repeatedly, and use them directly with Deepgram, including configurations/endpoints outside the UI. Finishing or disconnecting in the app does not terminate an independently opened provider connection.
- Provider documentation confirms temporary tokens cover speech-to-text, speech, text intelligence, and Voice Agent usage. Their default 30-second expiry controls connection establishment, not the lifetime of an established WebSocket. They do **not** grant management API access. [Deepgram token documentation](https://developers.deepgram.com/guides/fundamentals/token-based-authentication).
- Proof: `api-proof.mjs` exercised the actual handler with authentication, SQL, and provider test doubles; the token branch returned 200 and reached the provider mock. No paid requests or actual credentials were used. Financial impact was not load-tested.
- Fix: enforce per-account and project budgets, account eligibility, and active-session accounting server-side before grants. For strict configuration/session-duration enforcement, use a server-controlled provider connection or provider-supported restrictions that actually enforce those constraints. Rate limiting token issuance alone cannot end an already established connection.
- Detection: count grants and provider usage by accountable session; alert on divergence, unexpected models/endpoints, and budget exhaustion. Keep tokens and transcript contents out of logs.

### SEC-003 — Fabricated voice evidence (CWE-345)

- Evidence: `src/api.ts:235–279` accepts client-provided `role`, `text`, and any nonempty `providerSessionId`. At line 247, `assistant` becomes `interviewer` or `coach`. The same request can mark pending assistance as delivered at line 265.
- Reproduction: `api-proof.mjs` supplied an invented provider session and assistant text. The handler returned 201 and attempted an interviewer transcript insert. Authentication was intentionally stubbed to a legitimate owner; database/provider authenticity was not established by this harness.
- Impact: a user can fabricate their own recorded interviewer statements and assistance delivery. Ownership checks prevent this proof from modifying another user's record. Reviews currently fail closed, so no production evaluator compromise is claimed (`src/api.ts:538`).
- Fix: accept authoritative assistant evidence from a server-controlled/verified provider stream. Until available, record browser transcripts explicitly as unverified client assertions and do not use them as proof of provider delivery. Preserve the source distinction through review generation.
- Regression proof: a made-up provider session must not create a verified interviewer statement or mark assistance delivered.

### SEC-004 — Missing custom API origin checks (CWE-352)

- Evidence: `src/api.ts:471–535` authenticates the cookie but performs no Origin/Fetch-Metadata/CSRF check before writes. `src/http.ts:44` parses JSON regardless of Content-Type. Better Auth's trusted-origin configuration (`src/auth.ts:18`) protects its own handler, not these separate endpoints.
- Reproduction: actual handler with a signed-in-user test double accepted `Origin: https://untrusted.example` and `Content-Type: text/plain`; token returned 200 and transcript insertion returned 201 (`api-proof.json`). This demonstrates the missing application check, **not a full browser CSRF exploit**.
- Prerequisites: ambient cookie delivery, e.g. a compromised same-site sibling origin, or a later cookie-policy change. Installed Better Auth cookies default to explicit SameSite=Lax and HttpOnly, which block ordinary cross-site POST cookies. There is no demonstrated arbitrary cross-site read; absent CORS response headers do not grant that capability.
- Fix: require the configured trusted origin for unsafe browser methods and a CSRF mechanism where origin validation alone is insufficient. Enforce JSON media types on JSON write routes. Test expected browser requests as well as hostile same-site sibling requests.

### SEC-005 — Unbounded personal-data operations (CWE-400 / CWE-770)

- Evidence: `src/http.ts:46` reads the whole request JSON; `src/api.ts:178` accepts arbitrary-length practice goals and unconstrained setupContext; text, drafts, and correction reasons have no application byte limits. `listAttempts` at line 163 and `attemptDetail` at line 206 return complete collections. Repeated finish requests enqueue again at line 400 even when no new completion occurs.
- Impact: an authenticated user can grow storage, response size, and queue work without an application allocation. Large attempt timelines increase memory and latency for reads. Platform limits may terminate requests but do not implement per-user storage/cost fairness.
- Fix: define schema and byte limits from actual supported inputs; enforce streaming request limits, persisted per-user allocations, paginated history/timelines, and bounded queue dispatch based on pending state. Derive thresholds from measured workloads and service budgets. Preserve legitimate recovery dispatch.
- No flood or exhaustion test was run; this is code-established lack of application controls, not measured infrastructure failure.

### SEC-006 — Authentication throttling is not durable (CWE-307)

- Evidence: `src/auth.ts:11–70` sets no rate-limit storage or explicit production enablement. Installed Better Auth `dist/context/create-context.mjs:170–175` enables the limiter according to its production environment detection and defaults to memory. `dist/api/rate-limiter/index.mjs:6` holds a module-local Map.
- Risk: public sign-in/sign-up protection is split across Worker isolates and resets when an isolate disappears. This does not mean it resets on every auth instance; the inspected Map is module-level. Hosted edge rate limiting was not inspected and could mitigate this.
- Fix: explicitly enable and configure an atomic shared limiter or verified edge controls; configure client IP from the trusted Cloudflare boundary. The installed default reads X-Forwarded-For (`@better-auth/core/dist/utils/ip.mjs:196`); verify its deployment trust chain before relying on it.
- [Better Auth options](https://better-auth.com/docs/reference/options) document the storage choices. No password-guessing campaign was run.

## Dependencies and build tooling

`npm audit --json` reported **7 affected package nodes: 3 high, 4 moderate**, representing two underlying advisory families, not seven distinct exploitable application bugs. Raw output: `output/security-audit/npm-audit.json`.

- `wrangler 4.130.0 → miniflare → sharp 0.35.2`: high libheif advisory [GHSA-rgj7-g3m4-5g8c](https://github.com/advisories/GHSA-rgj7-g3m4-5g8c). Audit proposes Wrangler 4.133.0. No runtime image-upload/HEIF decoding path was found; this is a local-tool exposure, not established remote Worker RCE. Update the toolchain and rerun the relevant preview checks.
- `drizzle-kit → @esbuild-kit/esm-loader → core-utils → esbuild 0.18.20`: moderate development-server cross-origin disclosure [GHSA-67mh-4wv8-2f99](https://github.com/advisories/GHSA-67mh-4wv8-2f99). The vulnerable serve API is not used by the inspected application. Top-level esbuild is 0.28.2. Do not blindly use `npm audit fix --force`: its proposed drizzle-kit downgrade is a breaking change.
- `npm audit --omit=dev` still reports four moderate nodes because Better Auth's dependency tree includes drizzle-kit. Package classification is not proof that the vulnerable dev-server code executes in the deployed Worker. The lockfile is present and direct package versions mostly pinned.
- No CI workflow or CODEOWNERS was present. Hosted branch protection/secret scanning was not verified: the available `gh` launcher returned no usable version or API output. No changes were made to GitHub settings.

## Controls verified by inspection

- Personal collection fails closed unless explicitly enabled (`src/data-policy.ts:8`, `src/worker.ts:29`).
- Database-backed sessions, explicit auth base URL and trusted origin (`src/auth.ts:16–19,52`). Installed Better Auth supplies secure-cookie behavior according to deployment and HttpOnly/SameSite defaults; hosted cookies were not captured.
- Owner predicates on attempt access and retry checkpoints, plus correction ownership checks (`src/api.ts:75,409,449`). No input interpolation in the reviewed SQL queries.
- Membership triggers bind evidence to attempts and corrections to owners; completion triggers reject ordinary later evidence changes (`migrations/0002_application.sql:201–312`). Concurrent freeze races were not exercised against PostgreSQL.
- Only visible tests and no reference solution are sent by the reviewed runner route. Runner uses an operator-configured service binding, not a client-controlled fetch URL (`src/api.ts:339–351`).
- Review generation remains disabled even when provider settings exist; no unvalidated model findings are published (`src/api.ts:538`).
- Permanent Deepgram key stays server-side; raw audio is not saved by this application. Actual provider retention and account settings remain outside this proof.
- Personal adapter HTML uses escaping; personal records/tokens are not deliberately persisted in localStorage/sessionStorage. The demo's storage is fixture state.
- Local database setup binds loopback, generates random credentials, uses SCRAM, and avoids shell-string subprocess execution. Local no-TLS configuration is not a production TLS finding.

## Ownership and history

The available non-shallow history has **two commits and one author, Tec94**. All observed sensitive paths have a single recorded author. This is authorship concentration, not proof of exclusive expertise, reviewer identity, or abandoned code.

Ownership artifacts: `output/security-audit/ownership/{people,files,edges}.csv`, `ownership.graph.json`, `summary.json`, and `commits.jsonl`. Repo-specific equal-weight sensitivity rules include API/auth, credentials, database/migrations, voice, and personal UI. Equal weights classify paths, not risk scores. Co-change/community inference was disabled because two bulk commits do not support a useful separation of ownership clusters. Script default recency/owner thresholds are tool heuristics, not project policy; no stale/orphan conclusion is used as a release gate.

Current sensitive paths with one recorded author:

- `public/personal-adapter.js`
- `src/api.ts`
- `src/browser/voice-agent.js`
- `src/deepgram.ts`
- `src/worker.ts`
- `migrations/0002_application.sql`
- `migrations/auth/0000_colorful_vindicator.sql`
- `migrations/auth/meta/0000_snapshot.json`
- `migrations/auth/meta/_journal.json`
- `src/auth.ts`
- `src/data-policy.ts`
- `src/database.ts`
- `src/db/generated-auth.ts`

The full-history pattern scan covered 97 unique text blobs across both reachable commits. It matched only example credential URLs and a constructed local connection-string template, not an established live secret. See `history-secret-patterns.json`. Gitleaks, Semgrep/OpenGrep, and Trivy were unavailable; this was a limited pattern scan, not an entropy scan or a guarantee that history contains no secrets. No secret value was printed or tested against a provider.

## Threat model and production prerequisites

See `ai-interviewer-threat-model.md` for boundaries, abuse paths, prioritization, and focus paths.

Before collection is enabled, approve and implement a retention/deletion/export procedure consistent with `src/data-policy.ts:4–6`. No personal deletion/export endpoint or scheduled retention task was found. Completed-evidence triggers intentionally reject deletion, so a lawful operator deletion path must be designed explicitly; this is a known release prerequisite, not a claim of a particular legal violation. Confirm hosted TLS, database credentials/privileges, backup deletion, edge headers, provider budgets/data settings, and runner isolation separately.

## Evidence and limitations

- Browser XSS: reproduced on local Wrangler with a harmless DOM marker.
- API origins and voice provenance: actual handler bundled with isolated auth/SQL/provider doubles; no real user records or billable calls.
- Existing `npm test`: all 10 tests passed. These mostly verify contracts and do not prove resistance to the reproduced attacks.
- Dependency queries are current registry results on the audit date.
- No destructive test, load test, authenticated hosted penetration test, provider credential validation, or live runner escape test.
- Source reviewed: Worker/API/auth/database/data policy, generated schema and migrations, personal and demo render boundaries, browser voice source, scripts, dependency manifests, runtime assets, and repository history. Standalone design documents are outside the deployed `public/` asset root.
- Rejected claims: no proven SQL injection, cross-user IDOR, operator-URL SSRF, server code execution, hidden-test disclosure, or model tool exfiltration. No extra implementation is proposed for these absent paths.

## Recommended order

1. Close SEC-001 and add a malicious-fragment regression test.
2. Enforce SEC-002 provider-use boundaries before paid public voice access.
3. Resolve transcript provenance, API CSRF, resource allocations, and durable auth throttling before enabling personal collection.
4. Update affected tools after compatibility checks; verify hosted controls and the data lifecycle.
