# Backend API integration guide

This document records the existing local API contract and verification results.
It supplements [product and architecture](../product/contract.md), which
remains authoritative for product behavior and privacy boundaries. No frontend
is required to exercise these endpoints.

## Local connection and authentication

- Base URL and request origin: `http://localhost:8787`.
- The existing local Worker and PostgreSQL must be running. The verification
  session used PostgreSQL 16 on `127.0.0.1:5433`.
- Personal-data collection must already be enabled for fictional local tests.
  Otherwise personal and auth endpoints return `503`. Health and availability
  remain accessible. The verification script does not change configuration.
- All requests in the verification script send `Origin: http://localhost:8787`.
  The backend requires an exact match for writes. `127.0.0.1` and `localhost`
  are different origins even when they reach the same server.
- JSON writes use `Content-Type: application/json`.
- Signup/signin return `Set-Cookie`. Preserve the returned cookie and send it
  as `Cookie` on subsequent authenticated requests. A browser handles the cookie
  with same-origin `fetch`; do not copy a token into local storage.
- Better Auth owns password hashing and session records. Do not insert users or
  passwords directly into PostgreSQL to create login accounts.
- Do not commit cookies, passwords, connection strings, or `.dev.vars`.

Header shorthand in the tables:

| Shorthand | Required request headers for the documented flow |
| --- | --- |
| O | `Origin: http://localhost:8787` (sent on all tests; ordinary GETs do not require it) |
| J | O plus `Content-Type: application/json` |
| C | O plus the session `Cookie` |
| CJ | C plus `Content-Type: application/json` |

All paths below are relative to the base URL. GET requests have **no JSON body**.
Response shapes show relevant fields, not an exhaustive promise about every
Better Auth or database field. Application responses mix camelCase envelope
fields and snake_case database rows; use the actual names below.

## Authentication and operational endpoints

| Method and path | Authentication / headers | Request JSON | Observed success and response shape | Errors and limitations |
| --- | --- | --- | --- | --- |
| `GET /api/health` | None / O | None | `200 {"status":"ok","version"}`; `version` is the deployed commit, or `null` outside `npm run deploy` | Does not prove database connectivity. |
| `GET /api/personal-availability` | None / O | None | `200 {collectionEnabled, voiceEnabled, voiceProvider, thinkingModel}` | Availability metadata does not prove provider connectivity. |
| `POST /api/auth/sign-up/email` | None / J | `{"name":"Fictional Tester","email":"unique-test@example.invalid","password":"<test-password>"}` | `200 {token,user:{id,email,...}}`; `Set-Cookie` | Auth validation/duplicate-email cases were not exercised. Global origin/collection errors apply. Use unique fictional emails. |
| `POST /api/auth/sign-in/email` | None / J | `{"email":"unique-test@example.invalid","password":"<test-password>"}` | `200 {redirect:false,token,user:{id,email,...}}` without callback URL; `Set-Cookie` | Invalid credentials were not exercised; do not interpret all auth errors as the custom API's `{error}` shape. |
| `GET /api/auth/get-session` | Session cookie for a signed-in result / C | None | `200 {user:{id,email,...},session:{id,...}}`; after signout, `200 null` | A `200` alone does not mean authenticated. |
| `POST /api/auth/sign-out` | Session being revoked / CJ | `{}` | `200 {success:true,...}`; subsequent get-session with the old cookie returns `null` | Cookie revocation verified for both signup and signin sessions. |
| `GET /api/me` | Required / C | None | `200 {"userId":"<id>"}` | `401` without a valid session (implementation contract). This is an ID lookup, not a complete profile. |

Authentication response shapes are supplemented by inspection of the installed
Better Auth route implementation. Responses are library-owned; the automated test checks the cookie
and session identity rather than requiring an exact set of incidental fields.
For frontend errors, inspect `error` or `message` and handle non-JSON responses
defensively.

## Catalog and attempts

| Method and path | Authentication / headers | Request JSON | Observed success and response shape | Important errors / notes |
| --- | --- | --- | --- | --- |
| `GET /api/catalog` | None while collection enabled / O | None | `200 {problems:[Problem]}` | Returns active, non-sample problems. Verified without a cookie; reference solutions are not exposed. |
| `POST /api/attempts` | Required / CJ | Creation body below | `201 {attemptId}` | Observed `400` for missing consent or unavailable problem. Other invalid fields also produce `400` by implementation. |
| `GET /api/attempts?page=0` | Required / C | None | `200 {attempts:[AttemptSummary],page,hasMore}` | Observed `400` for negative page. Only the current user's attempts were returned. |
| `GET /api/attempts/:id?page=0` | Owner / C | None | `200 {attempt,problem,events,transcripts,checkpoints,runs,review,submissionCheck,page,hasMore}` | Observed `401` without cookie; `403` for another user **and** nonexistent attempt. `runs` holds visible Runs only; `submissionCheck` is `null` until the Attempt completes with a Submission check. |
| `PATCH /api/attempts/:id/draft` | Owner / CJ | Draft body below | `200 {draftRevision,updatedAt}` | Observed `403` for another user; `409` for stale revision; `400` for malformed JSON or `text/plain`. |

`Problem` includes `id`, `title`, `topic`, `difficulty`, `prompt`, `starter_code`,
`entry_point`, and `test_contract`. Choose `problemId` from the live catalog;
do not assume frontend fixture identifiers are valid personal problems.

`AttemptSummary` includes `id`, `mode`, `input_mode`, `status`, `draft_revision`,
`problem_id`, `title`, `topic`, `practice_goal`, `familiarity`, `created_at`,
`updated_at`, `review_status`, `source_attempt_id`, and `source_checkpoint_id`.

The detail's `attempt` includes `id`, `user_id`, `problem_id`, `draft_source`,
`draft_revision`, `status`, `mode`, `input_mode`, `setup_context`, and other
stored attempt fields. `review` is `null` before a review exists. Empty evidence
collections are arrays, not errors.

### Create an attempt

```json
{
  "problemId": "<id from GET /api/catalog>",
  "mode": "mock",
  "inputMode": "voice",
  "practiceGoal": "Fictional API verification",
  "consent": true,
  "saveAudio": false,
  "familiarity": "unanswered",
  "setupContext": {
    "studiedTopics": "Loops",
    "concern": "Fictional test only"
  }
}
```

- `mode`: `mock` or `coach`.
- `inputMode`: `voice` is the frozen MVP path. `text` remains accepted for
  existing fixtures/backward compatibility but is not required for launch.
- `consent` must be `true`; `saveAudio` must be explicitly `false`.
- `familiarity`: `unanswered`, `familiar`, or `not_recalled`; omitted defaults
  to `unanswered`.
- Optional `setupContext` defaults to `{}`. Only `studiedTopics` and `concern`
  string values are accepted.
- New attempts are `active` and start with the problem's starter code.

### Save a draft

Read `attempt.draft_revision` from the detail response before saving:

```json
{
  "source": "# Fictional test\nprint('hello')\n",
  "expectedRevision": 0,
  "sourceId": "<unique-event-id>",
  "sourceOrder": 1,
  "occurrenceOffsetMs": 1000
}
```

Successful saving increments the revision by one. Subsequent detail requests
return the source in `attempt.draft_source`. A stale revision returns:

```json
{
  "error": "The draft changed elsewhere. Reload before saving again."
}
```

On `409`, reload and reconcile the draft. Repeating the same draft PATCH with
the old revision is not a successful idempotent save. Verification confirmed
that stale and unauthorized writes did not change the saved source/revision.

## Additional attempt endpoints

| Method and path | Authentication / headers | Request JSON | Observed status and response shape | Errors / limitations |
| --- | --- | --- | --- | --- |
| `POST /api/attempts/:id/messages` | Owner / CJ | Message body below | `201 {eventId}` | Observed `400` for invalid message/metadata. Same `sourceId` repeated returned the same event ID and only one transcript row. |
| `POST /api/attempts/:id/help` | Owner / CJ | Help body below | `202 {eventId,delivered:false,voiceReady:false,message}` for this text attempt | Records a request only; no AI guidance was generated. Invalid category/metadata is `400` by implementation, not exercised. |
| `GET /api/attempts/:id/related` | Owner / C | None | `200 {relatedProblems:[{id,title,topic,relationship_reason,attempted_before}]}` | An empty array is allowed. Relationships are authored catalog data. |
| `POST /api/attempts/:id/finish` | Owner / CJ | Event metadata (`sourceId`, `sourceOrder`, `occurrenceOffsetMs`) | `200 {reviewId,dispatch,recoveryDispatch,submissionCheck}` | `503` when Review processing is not configured; the Attempt stays active. The Runner never refuses a finish. Covered by `test/submission-check-integration.mjs`. |
| `GET /api/me/export` | Required / C | None | `200` JSON attachment with one array per personal table | `runs` includes Submission checks (`run_kind = 'submission'`) with their categories only. Hidden test definitions and reference solutions are never exported. |
| `GET /api/attempts/:id/review` | Owner / C | None | **Only the missing-review case was verified:** `404 {"error":"Not found."}` | Existing-review success is code-inspected only: `200 {review,findings}`. No external review generation tested. |

Message body:

```json
{
  "text": "Fictional candidate message: I will inspect the loop.",
  "sourceId": "<unique-message-id>",
  "sourceOrder": 2,
  "occurrenceOffsetMs": 2000
}
```

Help body:

```json
{
  "category": "hint",
  "sourceId": "<unique-help-id>",
  "sourceOrder": 3,
  "occurrenceOffsetMs": 3000
}
```

Help categories are `clarification`, `hint`, and `explanation`. Evidence metadata
is required: `sourceId` is a stable event identifier; `sourceOrder` and
`occurrenceOffsetMs` must be nonnegative safe integers. Use different source IDs
for different events. Retain the same message ID when retrying the same message.
The transcript appears in detail as `{id,event_id,speaker,text,end_offset_ms,
created_at}`. A recorded help request is not delivered help; check `delivered`.

### Finish and the Submission check

Finishing records the Submission Checkpoint, runs the Problem's hidden test
cases against it with the existing Runner outside any database transaction, then
in one transaction records the Submission check (a Run with `run_kind =
'submission'` and a `submission_check` Event), completes the Attempt, and creates
the pending Review. Its evidence manifest names `submissionCheckEventId`.
See the glossary and [ADR 0002](../adr/0002-submission-check-records-outcome-categories-only.md).

Retry a finish with the **same** event metadata. A retry reuses the recorded
Submission, so an Attempt has exactly one Submission and one Submission check.
Finishing a completed Attempt only redispatches its Review (`recoveryDispatch:
true`) and returns the recorded check.

`submissionCheck` (finish and detail responses) is:

```json
{ "state": "checked", "passed": 4, "total": 6, "failures": { "wrong answer": 1, "TypeError": 1 } }
```

- `checked`: `passed` of `total` hidden tests, and the count of each failure
  category. A category is `wrong answer`, an allowlisted built-in Python
  exception class name, `timeout`, or `other error` (a candidate-defined
  exception, a missing callable, a non-JSON return value, a process exit, or a
  test the run deadline skipped).
- `unavailable`: the Runner is not configured, gave no result, returned
  `runner_error` at any point, or ran out of memory. `passed` and `total` are
  `null`, `failures` is `{}`, and no partial counts are stored.
- `no hidden tests`: the Problem has none, so the Runner was not called.
  `passed` and `total` are `null`.

The stored Run keeps each hidden test as `{testId, category}` only, with no
output, stdout, stderr, message text, or execution time. No response contains
hidden inputs or expected values. The Evidence limit never refuses the
Submission check Event, because it closes the Attempt.

## Error handling and pagination

Custom application errors use `{ "error": "Human-readable message" }`.

| Status | Meaning / verification |
| --- | --- |
| `400` | Observed invalid consent/problem, message metadata, JSON/content type, and negative page. |
| `401` | Observed unauthenticated attempt retrieval. |
| `403` | Observed cross-user retrieval/update and nonexistent attempt ID. Origin mismatch also returns `403` by implementation; this run sent only the configured origin. |
| `404` | Observed missing review and unknown API route for an authenticated user. |
| `409` | Observed stale draft revision; reload before saving again. |
| `413` | Request exceeds 256 KiB; implementation and existing security tests, not this live flow. |
| `429` | Rate limit; implementation and existing isolated integration suite, not deliberately triggered on the live server. |
| `503` | Collection disabled or required service unavailable; implementation contract, not deliberately triggered in this run. |

History and evidence pages use a zero-based `page` query parameter and 50 rows
per collection. `hasMore` is a length-based hint; the next page may be empty.
On detail, pagination applies to events, transcripts, checkpoints, and runs;
it does not page the attempt itself. First-page behavior was verified; large
multi-page datasets were not created. Most authenticated API calls share a
120-request/60-second account limit. Auth has separate library-owned limits.

## Automated verification and observed results

Run against the existing local backend from the repository root, using Node's
environment-file support (tested with Node 24):

```bash
node --env-file=.dev.vars test/backend-api-integration.mjs
node --env-file=.dev.vars test/security-integration.mjs
npm test
npm run check
npm run lint
```

The new script is deliberately separate from `npm test`: it needs a live backend
and PostgreSQL. It refuses non-loopback API hosts, does not alter configuration,
creates two unique `backend-api-...@example.invalid` users through Better Auth,
and preserves cookies for requests. Passwords and cookie values are not logged.
It stops on an unexpected assertion and signs out created sessions in `finally`.
Fictional users, one active attempt, messages, and evidence remain in the local
database for inspection; reruns create new users and records. It does not delete
or directly modify database records. Database assertions run in a read-only
transaction using `DATABASE_URL`; this must identify the same local database
used by the Worker.

Verification on 2026-09-17:

- Live signup, signin, session identity/revocation, catalog, creation, draft
  persistence, history, messages, message deduplication, help recording, and
  related lookup passed.
- Unauthenticated access, cross-user read/write, stale revisions, invalid
  input, missing records, and unknown-route checks returned expected errors.
- Read-only PostgreSQL queries confirmed the owner, draft source/revision,
  single transcript row, undelivered hint request, and four expected evidence
  events. Rejected writes left the draft unchanged.
- Existing `test/security-integration.mjs` passed. It creates/removes an isolated
  PostgreSQL schema and uses simulated voice/provider and queue objects; it
  does not call Deepgram or an AI provider.
- `npm test`: 14 passed, 1 failed because Microsoft Edge was absent at
  `/opt/microsoft/msedge/msedge` in the browser route-boundary test. No browser
  installation or production fix was attempted.
- `npm run check` passed. Its existing voice build step produced byte-identical
  generated output; no application/generated content was changed.
- `npm run lint` passed with zero warnings/errors after correcting a request-helper
  lint warning in the new test. The final live integration rerun also passed.

The final rerun retained attempt `a1487b3a-224a-470a-bfb9-c20c1ce21f22` for
inspection. An earlier successful run retained
`1e2b9e12-db2d-4c44-a9f4-6c72bd4e9b81`. Both contain fictional data. The previously
created interactive test login was not modified or signed out by these tests.

No live endpoint under test returned an unexpected failure. The missing-review
`404` is expected, not a broken review assertion. Full repository verification
is still blocked by the missing browser dependency.

## Deliberately unverified

- Deepgram voice/WebSocket sessions and credentialed microphone behavior.
- Python `/run` was not exercised in this original verification session. The
  subsequent local runner implementation and its separate verification commands
  are documented in [Python runner](python-runner.md).
- External AI review generation is implemented behind a provider adapter with
  strict evidence validation. Credentialed provider quality and hosted queue
  behavior remain unverified; see `review-processing.md`.
- `/finish`, `/retry`, and finding corrections were not invoked in this live
  flow. Finish dispatches review work; retry requires a run/submission checkpoint;
  corrections require findings. Do not treat these as verified by this document.
- Live quota exhaustion, concurrency under load, full pagination, and deployment
  behavior. Local results do not establish hosted production readiness.

No endpoint was redesigned or repaired to obtain those historical results. The
frozen MVP uses the voice path; text attempts remain compatibility/test coverage
and are not a launch fallback for unavailable voice.

## Python execution integration

Use [Python runner](python-runner.md) for local startup, the existing `/run`
contract, stored stdout/stderr, resource limits, and candidate versus
infrastructure error handling. The runner is opt-in through `npm run dev:runner`;
no frontend or review provider is needed for its API tests.
