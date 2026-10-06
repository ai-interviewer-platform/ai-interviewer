# Production backend deployment

This runbook owns deployment procedures, not deployment status. Verify the target
environment each time. Enable personal collection only after the
[collection policy prerequisites](#collection-policy-prerequisites) are satisfied.
Raw audio retention remains off.

## Collection policy prerequisites

Before collecting personal practice, obtain the operator's approved identity and
contact, processing purpose, retention criteria, export/deletion procedure,
backup/log handling, and disclosures for the actual processors. Keep
`PERSONAL_DATA_COLLECTION_APPROVED=false` until approval and hosted verification.
Local tests cannot establish these decisions. Waitlist, measurement, feedback,
and bug-report collection each retain their separate policy and configuration.

The top level of `wrangler.jsonc` is the production Worker configuration. The
named `runner` environment is local development only. Cloudflare bindings and
variables are environment-specific, so configure and verify them on the same
Worker environment that is deployed.

## Production configuration inventory

No production credential belongs in Git, `.env.example`, or `wrangler.jsonc`.
The alternatives in the table are exclusive where noted.

| Name | Classification | Required production value and source |
| --- | --- | --- |
| `BETTER_AUTH_URL` | Cloudflare variable | Exact public HTTPS origin, without path or trailing slash. It must equal the browser origin. |
| `BETTER_AUTH_SECRET` | Cloudflare secret | Independent high-entropy Better Auth secret. |
| `HYPERDRIVE` | Cloudflare binding | Preferred runtime PostgreSQL connection. Add the Hyperdrive configuration ID returned by Cloudflare. |
| `DATABASE_URL` | Cloudflare secret | Direct TLS PostgreSQL URL only when `HYPERDRIVE` is not used. Never configure both merely as a fallback to an unverified database. |
| `DEEPGRAM_API_KEY` | Cloudflare secret | Server-side key for the approved Deepgram project. |
| `REVIEW_PROVIDER` | Cloudflare variable | Adapter selection and prerequisites: [review configuration](../reference/review-processing.md#configuration). |
| `REVIEW_PROVIDER_API_KEY` | Cloudflare secret | Required for the OpenAI Responses adapter. Workers AI uses the `AI` binding. |
| `REVIEW_PROVIDER_MODEL` | Cloudflare variable | Approved structured-output model for the OpenAI Responses adapter. |
| `PYTHON_RUNNER` | Cloudflare binding | Preferred when an approved Cloudflare Worker gateway implements `POST /run`; mutually exclusive with URL/token. |
| `PYTHON_RUNNER_URL` | Cloudflare variable | Fixed HTTPS `/run` URL for an approved external gateway; mutually exclusive with `PYTHON_RUNNER`. |
| `PYTHON_RUNNER_TOKEN` | Cloudflare secret | Required with `PYTHON_RUNNER_URL`; omit with a service binding. |
| `PERSONAL_DATA_COLLECTION_APPROVED` | Cloudflare variable | Exactly `false` until explicit policy approval, then exactly `true`. |
| `REVIEW_QUEUE` | Cloudflare binding | Producer binding to `ai-interviewer-review`; the same Worker is its consumer. Declared in `wrangler.jsonc`. |
| `VOICE_SESSIONS` | Cloudflare binding | Durable Object namespace for class `VoiceSession`; migration tag `v1` is declared. |
| `ASSETS` | Cloudflare binding | Declared by `assets.binding` in `wrangler.jsonc` for `./public`; `src/worker.ts` serves every non-API path through it. |
| `CLOUDFLARE_API_TOKEN` | GitHub Actions secret, optional | Only required if a separate deployment workflow is later approved. The current Backend CI does not deploy or consume it. |
| `CLOUDFLARE_ACCOUNT_ID` | GitHub Actions secret/variable, optional | Same condition as above. Not required by normal Backend CI. |
| `ENV_BUNDLE_GPG_BASE64` | GitHub Actions secret | Used only by `share-development-env.yml`; it is not a runtime production credential. |
| `DATABASE_URL`, auth/provider/runner values in `.dev.vars` | local-only config | Fictional local testing only. `.dev.vars` is ignored and must never be copied into a deployment artifact or CI log. |
| `PYTHON_RUNNER_DOCKER` | local-only config | Optional Docker executable override for local runner tooling only. |

Normal Backend CI requires no paid provider secrets. It uses a PostgreSQL service,
fake review output, a mocked Deepgram boundary, and the local Docker runner.

## Provisioning order

1. Approve the data/operator/provider policy, but leave collection disabled.
2. Provision hosted PostgreSQL, its roles, TLS, backups, and a disposable target.
3. Apply and verify migrations through the direct migration connection.
4. Select and provision the production Python sandbox/gateway.
5. Create the Cloudflare Worker resources: Queue, Hyperdrive if used, Worker,
   Durable Object binding, and runner binding.
6. Create the Deepgram project/key and review-provider project/key/model.
7. Set the exact production origin, variables, and secrets.
8. Dry-run, deploy with `npm run deploy`, run non-collecting health checks, then enable collection only
   after policy approval.
9. Execute the fictional hosted smoke plan and configure operational alerts.

## Hosted PostgreSQL runbook

The known-good baseline is PostgreSQL 16. The service must support TLS, JSONB,
transactions, triggers, advisory locks, row locks, indexes, and UUID/text keys.
Use a direct connection for migrations. Hyperdrive is for runtime connectivity,
not schema migration.

Prefer separate migration and runtime roles. The migration role owns/creates
schema objects. The runtime role needs connect/usage plus application DML and
sequence/function permissions; arrange default privileges so new migrations do
not silently omit grants. For a small pilot, one tightly scoped application
owner role is technically compatible but has more privilege than the preferred
split. Neither role should be a provider superuser.

On a trusted operator machine, place the direct migration URL in the process
environment without printing it, then run:

```sh
npm ci
npm run migrate:postgres
npm run db:verify:target
```

The scripts honor an explicit `DATABASE_URL` over `.dev.vars`. Migration order is
generated Better Auth migrations followed by numbered application migrations.
The migration ledger stores SHA-256 checksums and rejects changed applied files.
Verification checks the auth mapping, application schema, security constraints,
indexes, content fixtures, review invariants, and migration ordering inside a
rolled-back transaction.

Create and test the runtime role after migration. If using Hyperdrive:

```sh
npx wrangler login
npx wrangler hyperdrive create ai-interviewer-production --connection-string='<runtime PostgreSQL TLS URL>'
npx wrangler hyperdrive get ai-interviewer-production
```

Add the returned ID as a top-level Hyperdrive entry named `HYPERDRIVE` before
deploying. Do not commit the connection URL. Without Hyperdrive, enter the direct
runtime URL interactively:

```sh
npx wrangler secret put DATABASE_URL
```

Before launch, enable provider-managed encrypted backups/PITR, define retention
and RPO/RTO with the owner, and perform a restore into a disposable database,
then rerun `npm run db:verify:target`. Backup duration and legal retention remain
policy decisions and are not invented here. Set provider connection limits so
Hyperdrive/direct Worker concurrency cannot exhaust PostgreSQL.

## Queue, Durable Object, and runner

Create the declared queue:

```sh
npx wrangler queues create ai-interviewer-review
npx wrangler queues list
```

The production deploy attaches the `REVIEW_QUEUE` producer/consumer and applies
the `VOICE_SESSIONS` `v1` Durable Object migration. Verify both in the Cloudflare
dashboard after deployment.

For an approved runner Worker, deploy that target first and add a top-level
service binding `PYTHON_RUNNER` to `wrangler.jsonc`. For an external sandbox
gateway, configure `PYTHON_RUNNER_URL` and `PYTHON_RUNNER_TOKEN`. Never deploy
`src/python-runner-proxy.ts` or `runner/wrangler.jsonc` as the production sandbox;
they are loopback development transport. See [Python runner](../reference/python-runner.md).

## Set variables and secrets

Put non-secret values in the production Worker environment using the Cloudflare
dashboard or a reviewed top-level `vars` block after their exact values are known:

- `BETTER_AUTH_URL`
- `REVIEW_PROVIDER`
- `REVIEW_PROVIDER_MODEL`
- `PERSONAL_DATA_COLLECTION_APPROVED`
- `PYTHON_RUNNER_URL` only for the external-gateway option

Enter secrets interactively so values do not enter shell history:

```sh
npx wrangler secret put BETTER_AUTH_SECRET
npx wrangler secret put DEEPGRAM_API_KEY
npx wrangler secret put REVIEW_PROVIDER_API_KEY
npx wrangler secret put PYTHON_RUNNER_TOKEN
```

Omit the runner token for a service binding. Add `DATABASE_URL` only when not
using Hyperdrive. `npx wrangler secret list` verifies names without exposing
values. The application fails closed when required configuration is absent;
`/api/personal-availability` reports capability booleans and `mvpReady`.

## Deepgram live verification

No additional repository code is required before a valid key is supplied. The
server owns the key and relay; the browser never receives it. The relay enforces
ownership, active voice attempts, reservation/account/project quotas, bounded
commands/audio/transcripts, verified provider provenance, and a 15-minute session
deadline. The Coding context is loaded server-side only when the model calls
`get_coding_context`. It is the same bounded Coding context that the text
Interviewer reads, limited to the owned active Attempt; see the
[saved-state decision](../adr/0001-interviewer-sees-only-saved-state.md) and
`codingContextDraftBytes` and `codingContextBytes` in `src/security.ts`.

Local commands after adding the key to `.dev.vars` without displaying it:

```sh
npm run db:local:start
npm run db:local:verify
node --test test/deepgram-voice-contract.test.mjs
node --env-file-if-exists=.dev.vars test/interviewer-turn-integration.mjs
node --env-file-if-exists=.dev.vars test/security-integration.mjs
npm run dev
```

Using a fictional account at `http://localhost:8787`, sign up through Better
Auth, create a voice attempt (`consent:true`, `saveAudio:false`), and connect an
authenticated WebSocket to `/api/attempts/:id/voice` with the exact Origin. A
live success requires WebSocket upgrade, Deepgram `SettingsApplied`, audible or
text-injected turn exchange, `ConversationText` messages, and persisted rows in
`transcript_segments` joined to `attempt_events` whose payload has
`verified:true`, `provider:"deepgram"`, and a provider session ID. Raw audio must
not appear in PostgreSQL or logs.

Hosted commands after setting the secret and deploying:

```sh
npx wrangler secret put DEEPGRAM_API_KEY
npx wrangler deploy --dry-run --env=""
npm run deploy
npx wrangler tail ai-interviewer --format=json
```

Run the same fictional flow at the exact HTTPS origin. Confirm one active voice
reservation, provider session provenance, transcript persistence, release on
disconnect, and expiry at the configured deadline. Exhausted allocation must
return 429; missing/invalid key or provider failure must return 503/close without
fabricated transcript; wrong Origin/owner must be denied; completed or non-voice
attempts must not connect. Save code and run visible tests, mention them to the
interviewer, and confirm its response is consistent with the bounded saved
snapshot. It must not claim awareness of unsaved code or hidden tests.

## Deploy and security checks

`npm run deploy` is the only production deploy. It refuses to run unless the
working tree is clean and `HEAD` is `origin/main`. It then applies and verifies
migrations against `DATABASE_URL` before `wrangler deploy`, so the Worker never
runs ahead of its schema. Set `DATABASE_URL` to the direct migration URL in the
process environment; the script does not read `.dev.vars`. The deploy stamps the
commit as `GIT_SHA`, which `/api/health` reports as `version`.

The exact production origin must match `BETTER_AUTH_URL`; verify secure session
cookies, origin rejection, and sign-out after deployment. Static security/CSP
headers are defined in `public/_headers` and must be checked on the deployed
asset responses.

```sh
npm run check
npm run lint
npm test
npx wrangler deploy --dry-run --env=""
npm run deploy
curl --fail --silent https://<production-origin>/api/health
curl --fail --silent https://<production-origin>/api/personal-availability
```

Before pilot access, `personal-availability` must report collection, database,
voice, runner, and review ready. A health response alone does not prove database
or provider readiness.

## Hosted golden-path smoke plan

Use only fictional users and unique event IDs. Inspect records with a read-only
operator connection; never print cookies, tokens, transcript text, or source.

| Step | Endpoint/subsystem and expected result | Database evidence | Failure classification |
| --- | --- | --- | --- |
| Sign up | `POST /api/auth/sign-up/email`, 2xx and secure session cookie | `user`, `account`, `session` rows | Auth/config/origin or DB |
| Sign in | `POST /api/auth/sign-in/email`, 2xx; wrong password rejected | New/updated `session`; no secret logged | Auth or DB |
| Catalog | `GET /api/catalog`, 200 with approved Python problems | Active `problems` and visible `test_cases` | Content/schema or DB |
| Voice attempt | `POST /api/attempts`, 201 with `inputMode:"voice"`, consent true, audio false | Active `attempts` row and `attempt_started` event | Deepgram config, policy, quota, or DB |
| Voice connect | WebSocket `/api/attempts/:id/voice`, upgrade and `SettingsApplied` | Voice reservation/session metadata | Deepgram credential/provider, DO/binding, quota, auth/origin |
| Transcript | Complete a fictional turn; provider conversation text persists | `transcript_segments` plus verified Deepgram event provenance | Provider protocol or persistence |
| Save code | `PATCH /api/attempts/:id/draft`, 200 and revision increment | Draft/revision and `draft_saved` event | Conflict/input/auth or DB |
| Incorrect run | `POST /api/attempts/:id/run`, 200 with failed visible test | Run checkpoint, `code_runs` failed result, immutable event | Candidate verdict if valid; otherwise runner infrastructure |
| Correct run | Save corrected code, then `/run`, 200 with passed tests | New checkpoint and passed run with runner/harness versions | Runner or contract |
| Coding context | Refer to saved code/test during voice turn; accurate bounded response | No cross-attempt reads; latest saved/run rows are source | Voice tool/protocol or authorization |
| Finish | `POST /api/attempts/:id/finish`, 200 queued | Completed attempt, submission checkpoint, pending review and frozen manifest | Queue/config or DB; attempt stays active if review unavailable |
| Review worker | Queue consumes once; real provider structured response accepted | Review becomes completed; transactional findings/evidence | Retryable provider/infra or permanent invalid model output |
| Review retrieval | `GET /api/attempts/:id/review`, 200 completed | Every `finding_evidence.event_id` belongs to frozen attempt evidence | Validation/persistence |
| Retry | `POST /api/attempts/:id/retry` with run/submission checkpoint, 201 | New coach attempt linked to source attempt/checkpoint | Input/ownership/schema |
| Sign out | Better Auth sign-out, 2xx; reuse of cookie rejected | Session revoked/deleted according to Better Auth | Auth/cookie/config |
| Cross-user denial | Second fictional user requests first attempt/review/retry, 403 | No new rows or changed ownership | Critical authorization defect if access succeeds |

Also exercise malformed inputs (400), anonymous access (401), invalid Origin
(403), API and voice allocation limits (429), runner timeout/crash (explicit
infrastructure result or 503, never a false candidate verdict), transient review
failure (queue retry), invalid evidence IDs (permanent failed review with no
findings), and practical database unavailability (503, nothing recorded). Record
executed results with their revision, environment, and date in the release issue.

## Operations and alerts

Application logs emit structured `mvp_backend` events without passwords,
cookies, tokens, source, transcript text, or raw provider errors. Configure
external alerts for Worker exceptions, Queue retry/backlog and exhausted
deliveries, Durable Object failures, Hyperdrive/database saturation, Deepgram
usage and allocation, review-provider spend/rate limits, and runner failures,
latency, and cleanup health. Provider-side budget caps and alerts remain account
configuration, not repository code.
