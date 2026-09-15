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

Retained audio, isolated Python execution, and model-generated reviews are not
complete merely because their interfaces or bindings exist. The Deepgram voice
transport is implemented, but live provider behavior still requires a configured
account and hosted verification as recorded below.

## Runtime structure

```text
Browser (`public/`)
  ├─ guided sample adapter → authored fixtures only
  └─ personal adapter → `/api/*`
                         ├─ Better Auth
                         ├─ PostgreSQL through an invocation-scoped pool
                         ├─ short-lived Deepgram Voice Agent token
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
| `src/deepgram.ts` | Server-only Deepgram token exchange and voice availability |
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
  or public network access. The optional runner binding is not proof of that
  isolation.
- Review output remains failed rather than publishing fabricated fallback
  findings when provider configuration or evidence-reference validation is
  missing.
- Voice processing and retained audio are separate decisions. The app can stream
  a consented voice attempt to Deepgram while keeping retained audio off.
- Permanent Deepgram credentials stay in the Worker. An authenticated, active
  voice attempt can receive only a short-lived bearer token.
- Retention, export, deletion, and provider-processing behavior must be approved
  before collecting real personal sessions.

## API surface

Unauthenticated operational routes expose health and collection availability.
Better Auth owns `/api/auth/*`. The personal API provides catalog access plus
owned attempt listing, creation, detail, draft updates, messages, requested help,
Deepgram voice tokens and transcript receipts, runs, completion, review,
corrections, retry, and related-problem lookup.

Every owned-attempt route verifies the authenticated user before returning or
changing data. Finishing an attempt freezes an evidence manifest and creates a
pending review before queue dispatch; a repeated finish can repair lost dispatch
without creating a second review.

## Delivery status

| Area | Current repository evidence | Still required before claiming production readiness |
| --- | --- | --- |
| Frontend | Maintained vanilla HTML/CSS/JavaScript app, fixture/personal route separation, responsive and accessibility checks | User validation of the product loop |
| Authentication | Better Auth configuration and generated PostgreSQL schema | Hosted environment and end-to-end deployment verification |
| Database | Versioned migrations, ownership/evidence constraints, local tooling | Live migration and constraint proof against the selected hosted PostgreSQL service |
| Personal collection | Explicit fail-closed gate | Approved retention, deletion, disclosure, and processor policy |
| Runner | Validated API result shape and optional binding | Proven isolation, resource policy, harness integrity, and deployed transport |
| Review | Durable pending record, frozen evidence manifest, queue recovery path | Selected provider, structured output validation, and evidence-reference quality proof |
| Voice/audio | Deepgram browser SDK, authenticated temporary-token exchange, Nova-3 listening, GPT-5.6 Terra thinking, Flux speech, barge-in, transcript persistence, and no application audio retention | Live credentialed microphone/playback test, provider-processing approval, transcript quality checks, and hosted interruption/reconnection proof |
| Deployment | Wrangler configuration and dry-run support | Real bindings, secrets, provider credentials, and hosted smoke tests |

Passing local checks proves the checked behavior only. It does not prove hosted
PostgreSQL, third-party provider behavior, runner isolation, or product demand.
