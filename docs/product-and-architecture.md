# Product and architecture

This document is the source of truth for the product contract, system
boundaries, and delivery status. It describes the current repository rather
than the earlier prototype handoff.

## Product contract

The core loop is:

1. Practice an authored Python problem in Mock or Coach mode.
2. Preserve the attempt's actual transcript, code checkpoints, and test results.
3. Review narrow findings linked to that evidence.
4. Start a fresh Coach retry from a supported checkpoint while preserving the
   original attempt.
5. Optionally choose an author-linked related problem.

The product describes what happened in an attempt. It does not issue an overall
score, predict interview success, infer struggle from silence or typing speed,
or turn one attempt into a claim about lasting ability.

The guided sample uses authored fictional events. Only `#sample` or an explicit
`source=sample` route may load fixtures; personal routes use the API adapter and
fail closed when collection is unavailable.

## User-facing scope

- English Python practice with Deepgram voice. Text-only interviewing is not an
  MVP requirement; text evidence remains supported internally for fixtures and
  compatibility, but is not a launch substitute for voice.
- Email/password authentication through Better Auth.
- Mock and Coach modes with user-requested help.
- Draft saving, immutable run/submission checkpoints, and visible test results.
- Completed attempts that remain available when review processing fails.
- Evidence-linked findings, user corrections, supported retries, and authored
  related practice.
- Session history, responsive workspace panes, keyboard access, and explicit
  reduced-motion behavior.

Retained audio remains incomplete. Evidence-backed review processing runs behind a
provider adapter (`src/review-provider.ts`): Workers AI (the `AI` binding,
no provider key, `@cf/moonshotai/kimi-k2.6`) by default, or OpenAI Responses when
`REVIEW_PROVIDER=openai-responses` with its key and model. Text-mode interviewer
replies use Workers AI `@cf/moonshotai/kimi-k2.6`; the model IDs are constants in
`src/llm.ts` and need Workers Paid. Live model quality still requires human
evaluation. Python runs in a Docker runner locally and in a hosted Cloudflare
Containers runner in production; see [Python runner](python-runner.md) for setup,
limits and verification. The Deepgram voice
transport is implemented, but live provider behavior still requires a configured
account and hosted verification as recorded below.

## Runtime structure

```text
Browser (`public/`)
  ├─ guided sample adapter → authored fixtures only
  └─ personal adapter → `/api/*`
                         ├─ Better Auth
                         ├─ PostgreSQL through an invocation-scoped pool
                         ├─ authenticated voice relay → Deepgram Voice Agent
                         │    └─ Nova-3 listen → GPT-5.6 Terra think → Flux speak
                         ├─ text interviewer turn → Workers AI Kimi K2.6
                         ├─ hosted isolated Python runner binding/HTTPS adapter
                         └─ review queue → provider adapter (Workers AI | OpenAI Responses) → evidence validation
```

Cloudflare Workers serves the static assets and API as one application.
PostgreSQL is authoritative for accounts, attempts, evidence, reviews, and retry
lineage. The queue moves review work; it does not become the source of truth.

### Source ownership

| Source | Owns |
| --- | --- |
| `public/app.js` | Sample routes, shared shell, interaction state, and fixtures |
| `public/personal-adapter.js` | Authenticated personal UI and API calls |
| `public/model.js` | Authored sample/catalog data and route parsing |
| `public/design-system.css` | Shared visual tokens and all motion policy |
| `public/styles.css` | Shared components and workspace layout |
| `public/discovery.css` | Home and discovery layout |
| `public/practice.css` | Roadmap, practice, and profile layout |
| `src/worker.ts` | Static/API boundary, fail-closed collection gate, and queue entry |
| `src/api.ts` | Attempt, evidence, run, review, correction, and retry operations |
| `src/llm.ts` | Workers AI client, model IDs, and provider failure reasons |
| `src/review.ts` | Review evidence loading, findings schema, validation, and publication |
| `src/deepgram.ts` | Server-owned Deepgram settings and voice availability |
| `src/browser/voice-agent.js` | Deepgram microphone, live conversation, playback, and transcript flow |
| `src/auth.ts` | Better Auth runtime configuration |
| `src/account.ts` | Account data export and deletion |
| `src/email.ts` | Optional Resend email for password reset and verification |
| `src/db/generated-auth.ts` | CLI-generated Better Auth Drizzle schema |
| `migrations/0002_application.sql` | Application schema and database invariants |
| `src/voice-context.ts` | Bounded, owner-scoped coding context for the voice agent |
| `src/review-provider.ts` | Provider-independent review request/result contract |
| `src/review-providers/` | Vendor-specific review transport adapters |
| `src/runner.ts` | Runner request, transport (service binding or authenticated HTTPS), deadline, size limit, and result check |

## Data and evidence contract

An attempt owns its user, immutable problem revision, mode, input mode, lifecycle,
draft revision, consent snapshot, and optional retry provenance. Review state is
separate from attempt completion so a failed evaluator cannot erase a completed
attempt.

Evidence keeps stable IDs, producer order, occurrence offsets, and receipt time.
Code runs point to the exact checkpoint and test version they executed. Findings
point back to stored evidence and keep later corrections distinguishable from the
original review.

Retry creates a new Coach attempt from a run or submission checkpoint. It may
receive earlier conversation context up to that point, but it does not restore a
live process, hidden model state, or later answers.

Database constraints and transactions enforce ownership and event/detail
consistency where practical. API checks remain necessary for authorization,
request validation, and boundaries that relational keys cannot express alone.

## Trust and privacy boundaries

- `PERSONAL_DATA_COLLECTION_APPROVED` defaults to false. When false, personal
  routes do not connect to the data service and the UI directs users to the
  sample.
- The sample cannot write personal evidence or capture a microphone.
- Browser assets contain no hidden tests, reference solutions, or permanent
  provider credentials.
- Candidate code must run in an isolated environment without application secrets
  or public network access. The local runner uses restricted per-test Docker
  containers; an optional binding alone is not proof of production isolation.
- Review output remains failed rather than publishing fabricated fallback
  findings when provider configuration, the provider call, or validation fails.
  A review sends the frozen evidence up to the final checkpoint, without
  unverified voice events or reference solutions. Every finding must match the
  schema, stay within text limits, avoid score or outcome claims, and cite 1–10
  event IDs from that set. Findings and the `ready` status are written in one
  transaction guarded by `status = 'pending'`, so queue redelivery is a no-op.
- The text interviewer receives the problem, authored guidance, saved draft,
  latest visible run, and the last 20 transcript segments, never the reference
  solution. Mock mode does not hint unless help is requested; Coach mode guides
  without writing the solution. A reply is its own `interviewer_text` event and
  transcript segment. If the provider fails, the candidate message stays saved
  and the response says no reply was generated.
- Voice processing and retained audio are separate decisions. The app can stream
  a consented voice attempt to Deepgram while keeping retained audio off.
- Permanent Deepgram credentials stay in the Worker. An authenticated, active
  voice attempt connects through a metered Durable Object relay; no provider token reaches the browser.
- Retention, export, deletion, backup/log handling, and provider-processing
  behavior must be approved before collecting real personal sessions. The
  mechanisms exist: a signed-in user can download their data and, after
  re-entering the password, permanently delete the account and every personal row.
  Only `delete_user_account()` (`migrations/0007_account_deletion.sql`) may delete
  completed evidence, and only that user's; normal updates and deletes stay rejected.
- Email (password reset, verification) is sent as plain text through Resend only
  when `RESEND_API_KEY` and `EMAIL_FROM` are set; links use `BETTER_AUTH_URL`,
  never the request host. Without both values, reset is off and verification is
  not required.

### Personal-data inventory and lifecycle

The application database stores account/profile identifiers, credentials managed
by Better Auth, sessions and rate-limit records; attempt setup/consent metadata;
saved Python source, checkpoints, visible-run outputs and test outcomes;
transcript text and provider/session provenance; requested-assistance records;
review manifests, findings, evidence links, corrections, and retry lineage; and
voice reservation timestamps/usage. The application does not store raw audio.

Candidate source, transcript text, and runner output can contain personal data
entered by a user. Operational logs are limited to named backend events and small
non-sensitive scalars; they omit passwords, cookies, tokens, API keys, source,
transcripts, and raw provider errors. Provider-side processing, platform logs,
and database backups remain governed by the deployment decisions in
`mvp-blockers.md`.

Better Auth supports session invalidation and sign-out. Account export and
password-confirmed account deletion are implemented (see above); password reset
works only when email is configured. Automated retention and backup erasure are
not implemented. Completed evidence stays immutable at the ordinary application
role; the single deletion path is the audited `delete_user_account()` function.

## API surface

Unauthenticated operational routes expose health and collection availability.
Better Auth owns `/api/auth/*`. The personal API provides catalog access plus
owned attempt listing, creation, detail, draft updates, messages, requested help,
a same-origin voice WebSocket, runs, completion, review,
corrections, retry, and related-problem lookup, plus `GET /api/me/export` (a JSON
attachment of the user's own data, without reference solutions or tests) and
`DELETE /api/me` (requires the current password).

Every owned-attempt route verifies the authenticated user before returning or
changing data. Finishing an attempt freezes an evidence manifest and creates a
pending review before queue dispatch; a repeated finish can repair lost dispatch
without creating a second review. Dispatch claims are serialized and expire after 60 seconds while the review remains pending; terminal reviews cannot be redispatched.

## Evidence-backed reviews

`src/reviews.ts` processes only pending reviews of completed attempts. It verifies
that the existing manifest names that same attempt and its stored final submission
checkpoint. Completion triggers freeze the underlying evidence; the manifest is
not reinterpreted as a timestamp cutoff or expanded to another attempt's history.

The processor loads same-attempt events, transcript segments, code checkpoints,
visible code-run results, assistance records, and the final submission. Unverified
historical voice evidence and non-visible runs are excluded. Help requested is
kept distinct from help delivered. Retry ancestors are not followed. Model context
contains the problem prompt and practice/input modes; account identity, setup
answers, free-form personal goals, raw audio, hidden tests, reference solutions,
and raw event payloads are not sent. Candidate text/code/output can contain
user-entered private information; this is not a content-redaction service.

The core processor depends only on the `ReviewProvider` interface. The included
`openai-responses` adapter uses server-only `REVIEW_PROVIDER_API_KEY` and
`REVIEW_PROVIDER_MODEL`, strict structured output, no tools, and `store: false`.
It sends an explicit allowed event-ID list. Model findings use the existing
observation, interpretation, limitations, suggested action, criterion, and evidence
status fields. Every finding needs unique citations from precisely that supplied
set. Unknown fields/IDs, duplicate observations, oversized output, and unsupported
shapes fail the entire review. IDs, citation locators, timestamps, retry checkpoints,
and assistance context are generated or derived by the backend, never accepted
as model-generated evidence. Membership validation does not establish the factual
correctness of arbitrary prose; model-quality evaluation remains necessary.

Review success is the existing `ready` status, including a valid empty findings
array. A review row lock serializes processing; all findings, evidence references,
and the status update commit together. Duplicate or terminal delivery is a no-op.
The original attempt is never edited by review processing. Transient provider,
network, lock, or database errors roll back to `pending` and propagate to queue
retry. Permanent configuration/output/evidence failures become `failed` with a
non-sensitive reason and no fabricated fallback. The queue honors the existing
personal-collection gate. Terminal review reset is not exposed by this change.

Processing bounds are 200 eligible events, a 192 KiB evidence/context payload,
a 64 KiB provider envelope, a 45-second provider deadline, and at most eight
findings with eight citations each. Oversized evidence fails explicitly rather
than silently truncating the reviewed record. Holding a row lock during inference
is an intentional small-scale tradeoff; database connection capacity and feedback
quality must be assessed before increasing traffic.

See [backend review processing](review-processing.md) for provider configuration,
field limits, frontend API/status behavior, queue recovery, and frontend-free
mocked and PostgreSQL verification commands.

## Delivery status

| Area | Current repository evidence | Still required before claiming production readiness |
| --- | --- | --- |
| Frontend | Maintained vanilla HTML/CSS/JavaScript app, fixture/personal route separation, responsive and accessibility checks | User validation of the product loop |
| Authentication | Better Auth configuration and generated PostgreSQL schema | Hosted environment and end-to-end deployment verification |
| Database | Versioned migrations, ownership/evidence constraints, local tooling | Live migration and constraint proof against the selected hosted PostgreSQL service |
| Personal collection | Explicit fail-closed gate, data export, password-confirmed account deletion, optional email reset/verification | Approved retention, disclosure, and processor policy; published privacy terms; verified Resend sender domain |
| Runner | Local restricted Docker runner; production client accepting a Worker service binding or fixed authenticated HTTPS endpoint; hosted Cloudflare Containers runner deployed 2026-09-28 (fresh container per run, verified pass/fail, CPU-limit kill, and no egress) | Independent isolation review, concurrency and cleanup monitoring under real load |
| Review | Provider-independent interface with Workers AI (default, Kimi K2.6, attempt-scoped evidence-ID enum) and OpenAI Responses adapters, frozen evidence validation, atomic publication, idempotent queue handling, per-account daily cap; mocked-provider and PostgreSQL tests; real local Workers AI reviews in 9-20 s | Human evaluation of finding quality; credentialed OpenAI verification if selected |
| Text interviewer | Kimi K2.6 replies and requested help in text mode, with per-attempt and per-account caps; real local replies in about 2 s | Live reply quality checks |
| Voice/audio | Server-controlled Deepgram relay, bounded coding-context function, transcript provenance, quotas, timeouts, and no application raw-audio retention | Live credentialed microphone/playback/function-call test, provider-processing approval, transcript quality, and hosted interruption/reconnection proof |
| Deployment | Wrangler resources, runtime readiness report, exact-origin validation, structured logs, CI, migration/schema verification, and an authoritative checklist | Real bindings, secrets, provider credentials, alert configuration, and hosted smoke tests |

The 2026-09-24 end-to-end audit, remaining launch blockers, and hosting runbook
are recorded in [launch readiness](launch-readiness.md). The catalog now includes
the verified public [problem bank](problem-bank.md).

Passing local checks proves the checked behavior only. It does not prove hosted
PostgreSQL, third-party provider behavior, runner isolation, or product demand.

## Security controls and limits

The owner authorized conservative defaults on 2026-09-16. These limits are
application policy, not provider guarantees; see `src/security.ts`.

| Boundary | Enforced policy |
| --- | --- |
| Voice connection | 15 minutes, one active connection per account |
| Account allocation | 60 reserved minutes per UTC day |
| Project allocation | 600 reserved minutes per UTC day across all accounts |
| Reservation accounting | Charge the complete 15-minute allocation before connecting; no refund on disconnect or provider failure |
| HTTP input and runner result | 256 KiB, read incrementally even without Content-Length |
| Saved input text | 64 KiB per string; setup permits only studiedTopics and concern strings |
| API requests | 120 per authenticated account per 60-second fixed window |
| Auth requests | Better Auth's shipped route-specific limits, explicitly enabled with atomic PostgreSQL storage and Cloudflare client IP |
| Model turns (text replies and help) | 40 per attempt; 60 per account per hour |
| Reviews | 20 model reviews per account per day; evidence above about 100k tokens fails |
| History and evidence | 50 rows per collection per page, explicit Load more controls |
| Attempt evidence | 10,000 events; completion and writes share the attempt row lock |
| Voice control messages | 1,200 per connection; only KeepAlive and InjectUserMessage permitted |
| Voice coding context | 30 function calls, 10 KiB saved source, 16 KiB total response; active owned attempt only |
| Voice persistence backlog | 50 pending transcript writes; disconnect rather than accumulate unbounded memory |
| Audio input | 16 kHz, 16-bit mono throughput plus two seconds of capture jitter |
| Review provider | 200 evidence events, 192 KiB request context, 64 KiB response, 45 seconds, 8 findings × 8 citations |
| Runner | 64 KiB source, 1–16 tests, 256 KiB request/result, 95-second application deadline; sandbox limits are documented separately |

Voice sessions end on disconnect, deadline, invalid client messages or persistence
failure. The interviewer may call only the server-owned `get_coding_context`
function. It receives a bounded saved draft, latest checkpoint, normalized latest
visible-test outcomes, and latest help request; it never receives hidden tests,
raw runner output, account metadata, or another attempt. The database serializes allocation before any provider connection;
a durable alarm and a live timer close both sockets. Provider settings are built
from server-owned problem data. Only messages received from the provider socket
can create verified voice events. Browser transcript/token endpoints are removed.
A verified transcript means verified transport provenance, not factual correctness.
No transcript automatically marks requested help as delivered. Historical voice
events lacking `payload.verified: true` remain unverified; reviews neither send
nor accept them as evidence.

Unsafe API methods require an exact Origin match; custom JSON writes require
application/json. Static assets carry CSP, anti-framing, no-sniff and privacy
headers. Inline styles remain allowed for existing layout tokens; inline scripts
are forbidden. Blob scripts support the installed microphone AudioWorklet.

Expired rate buckets and prior-day inactive voice reservations are pruned. Retry
context stores source references and a cutoff instead of duplicating an unbounded
transcript. Evidence itself retains the existing collection-policy gate.

Before production collection: apply the security migration, deploy Worker/assets
and Durable Object binding, verify the actual hosted origin/TLS/database permissions,
and exercise a credentialed voice session, including microphone, barge-in, expiry
and disconnection. Local tests use a simulated provider and do not establish
provider availability or processing/retention policy. Owner approval of retention,
export, deletion and processor handling is still required by the existing gate.

Implementation references: [Deepgram voice protocol](https://developers.deepgram.com/docs/build-a-voice-agent),
[Cloudflare WebSockets](https://developers.cloudflare.com/durable-objects/best-practices/websockets/),
[Durable Object alarms](https://developers.cloudflare.com/durable-objects/api/alarms/).
