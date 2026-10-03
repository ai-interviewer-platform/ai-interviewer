# Backend review processing

The authoritative product contract is in [product and architecture](../product/contract.md#evidence-backed-reviews).
This guide describes configuration, testing, and the existing API contract. No
frontend or paid provider call is required for the automated tests.

## Configuration

`src/review-provider.ts` selects the adapter. An explicit
`REVIEW_PROVIDER` wins; otherwise Workers AI is used when the Worker has the `AI`
binding (production and `wrangler dev`), and OpenAI Responses otherwise.

| `REVIEW_PROVIDER` | Adapter | Needs |
| --- | --- | --- |
| empty or `workers-ai` | `src/review-providers/workers-ai.ts`, model `REVIEW_MODEL` in `src/llm.ts` (`@cf/moonshotai/kimi-k2.6`, reasoning off) | The `AI` binding in `wrangler.jsonc` (Workers Paid); no key |
| `openai-responses` | `src/review-providers/openai-responses.ts` | `REVIEW_PROVIDER_API_KEY` and `REVIEW_PROVIDER_MODEL` |

The Workers AI adapter sends the same instructions (`reviewInstructions`) and
schema as the OpenAI adapter, with `evidenceIds` enumerated to the attempt's own
allowed IDs. Truncated, filtered, or empty output fails the review; outages and
timeouts are transient and retried by the queue. Both adapters must answer
within `reviewLimits.timeoutMs` (45 s) because the review row lock is held under a
60 s idle-transaction limit; Kimi K2.7 Code (always reasoning) took 36-53 s and
timed out, while K2.6 with reasoning off answered in 9-20 s in local tests.
Reviews are capped at `limits.accountReviewsPerDay` per account per UTC day.

To use OpenAI instead, set these server-side values in `.dev.vars` for local development:

```dotenv
REVIEW_PROVIDER_API_KEY=<OpenAI API key>
REVIEW_PROVIDER_MODEL=<model available to your account supporting Responses structured outputs>
REVIEW_PROVIDER=openai-responses
```

For a deployed Worker, set `REVIEW_PROVIDER_API_KEY` using
`npx wrangler secret put REVIEW_PROVIDER_API_KEY` and configure
`REVIEW_PROVIDER_MODEL` on that same environment. This feature does not choose a
model automatically. The model must accept the configured JSON Schema and output
budget. Deepgram credentials and its managed thinking-model setting are separate.

Core processing depends on the provider-independent `ReviewProvider` interface:
it supplies a bounded evidence package and allowed evidence-ID set and receives
normalized findings. Core processing revalidates that normalized result before
any database write, so a future adapter cannot bypass the common field and
evidence-ID boundary. The included `openai-responses` adapter is isolated in
`src/review-providers/openai-responses.ts`. It sends requests to
`https://api.openai.com/v1/responses`, uses
`text.format` with a strict JSON Schema, disables response storage with
`store: false`, and enables no tools. This does not promise zero provider retention;
the deployment's existing personal-data and processor approval still applies.
The Worker queue also honors `PERSONAL_DATA_COLLECTION_APPROVED=true`.
No provider key, database connection string, or raw provider error is returned to
the browser. Provider configuration is not needed to run mocked tests.

See the official [Structured Outputs documentation](https://developers.openai.com/api/docs/guides/structured-outputs)
for that adapter's transport format. A future adapter must normalize into the
same `Finding[]` contract and cannot bypass the shared evidence-ID and field
validation boundary.

## Review queue

`src/review-queue.ts` owns Review dispatch and consumption. The finish route calls
`dispatchReview` after the completion transaction: it claims the pending Review,
sends `{reviewId}`, and releases the claim when the send fails. A claim blocks
another send for 60 seconds; after that, a finish retry recovers a lost dispatch.
There is no scheduled sweep. The Worker queue handler calls `consumeReviews`,
which acknowledges invalid messages, processed Reviews, and permanent failures,
and retries transient failures. `reviewConfigured` is the one "Review configured"
rule (a provider and a queue); the finish route and the personal availability
response both read it. The Cloudflare Queue binding is the production adapter;
`InMemoryReviewQueue` is the test adapter.

## Frontend/API contract (unchanged)

All personal endpoints require the authenticated owner's cookie. Writes also
require the exact configured `Origin` and `Content-Type: application/json`.

1. Save the draft and optionally run visible tests through the existing endpoints.
2. `POST /api/attempts/:attemptId/finish` with stable event metadata:

   ```json
   {"sourceId":"unique-finish-id","sourceOrder":10,"occurrenceOffsetMs":30000}
   ```

   The response remains `{reviewId, dispatch, recoveryDispatch}`. Finishing
   completes the attempt; it does not synchronously generate feedback. Keep
   metadata stable when retrying the same finish request. Dispatch failure returns
   `503`; repeat finish to recover. A pending dispatch claim expires after 60 seconds.
3. Poll `GET /api/attempts/:attemptId/review` at a modest interval. It returns:

   ```json
   {
     "review": {"id":"...","status":"ready","failure_reason":null,"evidence_manifest":{}},
     "findings": [{
       "id":"server-generated-id",
       "observation":"The recorded run passed its visible cases.",
       "interpretation":null,
       "limitations":"Visible tests do not establish correctness for every input.",
       "suggested_action":"Explain the index selection.",
       "criterion":"Correctness",
       "evidence_status":"reproducible_observation",
       "retry_checkpoint_id":"stored-checkpoint-id-or-null",
       "practice_goal":"server-derived-action-or-null",
       "assistance_context":{"events":[]},
       "is_disputed":false,
       "evidence":[{"eventId":"stored-event-id","locator":{"runId":"stored-run-id","checkpointId":"stored-checkpoint-id","occurrenceOffsetMs":1200}}]
     }]
   }
   ```

   This is illustrative, not a fixture returned by the application. Additional
   existing database fields/timestamps are retained. Real manifests contain
   `attemptId`, `finalCheckpointId`, and `frozenAt`.

Statuses are `pending`, `ready`, and `failed`. `ready` with `findings: []` is valid:
no defensible finding is better than invented feedback. `404` means no review has
been created. A failed review preserves the completed attempt and its evidence.
`failure_reason` is a fixed, non-sensitive explanation, not raw provider content.
A retry checkpoint is supplied only when a cited run/submission checkpoint is
eligible for the existing retry endpoint, the finding suggests an action, and the
finding is not `insufficient_evidence`. Findings on a retry attempt do not offer
nested retries, consistent with the current API.

Model output has no finding IDs, locators, timestamps, test results, retry IDs,
practice goal, or assistance context fields. The backend generates IDs and derives
locators, retry choices, and assistance context from the cited records.

## Tests without the frontend

```sh
# Mocked Responses transport, validation, publication and queue behavior
node --test test/reviews.test.mjs

# Real PostgreSQL constraints/transactions, fake provider, fictional isolated schema
node test/review-integration.mjs

# Review queue dispatch and consumption with the in-memory queue
node test/review-queue-integration.mjs

# Existing PostgreSQL security and finish-dispatch concurrency regression tests
node --env-file=.dev.vars test/security-integration.mjs

npm test
npm run check
npm run lint
npx wrangler deploy --dry-run
```

`review-integration.mjs` reads `DATABASE_URL` from the environment, falling back to
`.dev.vars`. It rejects non-local hosts. The database role must be able to create
and drop a schema. It applies current migrations inside a unique temporary schema,
creates fictional users/attempts/evidence, invokes the actual finish endpoint and
processor with fake model responses, checks review retrieval, concurrent delivery,
voice provenance, foreign evidence rejection, and rollback/retry after a forced
citation-write error. It removes its schema afterward. It does not call OpenAI,
Deepgram, Docker, or the unfinished frontend, or change the app's configuration.

## Manual local API check with a real model

Use only fictional data and an appropriately configured local database. Start
`npm run dev` (or the existing runner development services if testing actual code
runs). Supply the review configuration above before starting the Worker. Wrangler's
configured review queue delivers the finish message to the local consumer.

Authenticate using the signup/signin endpoints and retain the cookie, create a
personal attempt, save a draft, optionally add candidate messages and run Python,
then POST finish and GET review using the contract above. The existing
[backend API guide](backend-api.md) contains signup, cookie, draft, and message
examples. For a shell cookie jar, the final calls have this form:

```sh
curl -b /tmp/interview-cookies.txt \
  -H 'Origin: http://localhost:8787' -H 'Content-Type: application/json' \
  --data '{"sourceId":"finish-review-1","sourceOrder":10,"occurrenceOffsetMs":30000}' \
  http://localhost:8787/api/attempts/ATTEMPT_ID/finish

curl -b /tmp/interview-cookies.txt \
  http://localhost:8787/api/attempts/ATTEMPT_ID/review
```

Replace `ATTEMPT_ID` and use your actual configured origin. A real model request
uses the configured account and may incur charges. Never put keys in curl URLs,
frontend code, screenshots, or shared logs. The fake-provider integration test is
the recommended repeatable backend verification path.

## Failure recovery and limits

- Provider network/body-read failures, the 45-second deadline, HTTP 408/409/429/5xx,
  database failures, and lock contention roll back and are retried by the existing
  queue handler. There is no internal provider retry loop.
- Missing configuration, other non-success HTTP statuses, refusal/incomplete
  responses, invalid JSON/schema/citations, invalid frozen evidence, or exceeded
  evidence/output bounds mark the review `failed` without findings and are acked.
- Terminal reviews are never regenerated. Repeating finish does not restart a
  failed/ready review. There is no new public review-reset endpoint.
- If queue retries are exhausted, the review remains pending. Existing finish
  redispatch recovery is available after the dispatch claim expires; automatic
  dead-letter recovery is outside this change.
- The processor uses a PostgreSQL row lock across the bounded provider request.
  Lock waits expire after 2 seconds, SQL statements after 10 seconds, and idle
  transactions after 60 seconds. This deliberately simple serialization occupies
  a database connection during inference; a durable lease design may be appropriate
  at larger scale. A crash before commit can cause another provider call, but cannot
  publish a duplicate review.
- Limits: 200 eligible events, 192 KiB of complete evidence/context payload, 64 KiB
  of provider response including its envelope, 6,000 output tokens, 0–8 findings,
  and 1–8 unique citations per finding. Evidence is not silently truncated. Oversized
  attempts fail with a useful reason; future selection/chunking needs its own design.
- Field maximum lengths: observation 500, interpretation 2,000, limitations 1,000,
  suggested action 1,000, criterion 200 characters. Optional text is explicit null.
  Unknown fields, blank strings, duplicate citations, and duplicate normalized
  observations are rejected. One invalid finding rejects the complete output.

Citation checks establish provenance and exact membership, not semantic truth.
Human evaluation of feedback quality and a credentialed hosted provider check are
still required before claiming production readiness.
