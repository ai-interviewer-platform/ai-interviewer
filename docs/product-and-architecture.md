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

- English Python practice with Deepgram voice as the primary configured path and
  text as an alternative.
- Email/password authentication through Better Auth.
- Mock and Coach modes with user-requested help.
- Draft saving, immutable run/submission checkpoints, and visible test results.
- Completed attempts that remain available when review processing fails.
- Evidence-linked findings, user corrections, supported retries, and authored
  related practice.
- Session history, responsive workspace panes, keyboard access, and explicit
  reduced-motion behavior.

Retained audio, hosted isolated Python execution, and model-generated reviews are
not complete merely because their interfaces or bindings exist. Local Python
execution has a dedicated Docker runner behind the existing optional service
binding; see [Python runner](python-runner.md) for setup, limits and verification. The Deepgram voice
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
                         ├─ optional isolated Python runner binding
                         └─ review queue → evidence-validation boundary
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
| `src/deepgram.ts` | Server-owned Deepgram settings and voice availability |
| `src/browser/voice-agent.js` | Deepgram microphone, live conversation, playback, and transcript flow |
| `src/auth.ts` | Better Auth runtime configuration |
| `src/db/generated-auth.ts` | CLI-generated Better Auth Drizzle schema |
| `migrations/0002_application.sql` | Application schema and database invariants |

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
  findings when provider configuration or evidence-reference validation is
  missing.
- Voice processing and retained audio are separate decisions. The app can stream
  a consented voice attempt to Deepgram while keeping retained audio off.
- Permanent Deepgram credentials stay in the Worker. An authenticated, active
  voice attempt connects through a metered Durable Object relay; no provider token reaches the browser.
- Retention, export, deletion, and provider-processing behavior must be approved
  before collecting real personal sessions.

## API surface

Unauthenticated operational routes expose health and collection availability.
Better Auth owns `/api/auth/*`. The personal API provides catalog access plus
owned attempt listing, creation, detail, draft updates, messages, requested help,
a same-origin voice WebSocket, runs, completion, review,
corrections, retry, and related-problem lookup.

Every owned-attempt route verifies the authenticated user before returning or
changing data. Finishing an attempt freezes an evidence manifest and creates a
pending review before queue dispatch; a repeated finish can repair lost dispatch
without creating a second review. Dispatch claims are serialized and expire after 60 seconds while the review remains pending; terminal reviews cannot be redispatched.

## Delivery status

| Area | Current repository evidence | Still required before claiming production readiness |
| --- | --- | --- |
| Frontend | Maintained vanilla HTML/CSS/JavaScript app, fixture/personal route separation, responsive and accessibility checks | User validation of the product loop |
| Authentication | Better Auth configuration and generated PostgreSQL schema | Hosted environment and end-to-end deployment verification |
| Database | Versioned migrations, ownership/evidence constraints, local tooling | Live migration and constraint proof against the selected hosted PostgreSQL service |
| Personal collection | Explicit fail-closed gate | Approved retention, deletion, disclosure, and processor policy |
| Runner | Opt-in local service binding, per-test restricted Docker containers, external result comparison, and contract/API/execution tests | Successful execution of Docker and database checks in the target environment; production isolation proof and deployed transport |
| Review | Durable pending record, frozen evidence manifest, queue recovery path | Selected provider, structured output validation, and evidence-reference quality proof |
| Voice/audio | Deepgram audio helpers, server-controlled WebSocket relay, Nova-3 listening, GPT-5.6 Terra thinking, Flux speech, barge-in, transcript persistence, and no application audio retention | Live credentialed microphone/playback test, provider-processing approval, transcript quality checks, and hosted interruption/reconnection proof |
| Deployment | Wrangler configuration and dry-run support | Real bindings, secrets, provider credentials, and hosted smoke tests |

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
| History and evidence | 50 rows per collection per page, explicit Load more controls |
| Attempt evidence | 10,000 events; completion and writes share the attempt row lock |
| Voice control messages | 1,200 per connection; only KeepAlive and InjectUserMessage permitted |
| Voice persistence backlog | 50 pending transcript writes; disconnect rather than accumulate unbounded memory |
| Audio input | 16 kHz, 16-bit mono throughput plus two seconds of capture jitter |

Voice sessions end on disconnect, deadline, invalid client messages or persistence
failure. The database serializes allocation before any provider connection;
a durable alarm and a live timer close both sockets. Provider settings are built
from server-owned problem data. Only messages received from the provider socket
can create verified voice events. Browser transcript/token endpoints are removed.
A verified transcript means verified transport provenance, not factual correctness.
No transcript automatically marks requested help as delivered. Historical voice
events lacking `payload.verified: true` remain unverified; do not use them as
provider evidence in a future review implementation.

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
