# MVP external blockers

Last updated: 2026-09-28.

This file contains only prerequisites the owner or team must provide or decide.
Repository work continues independently. No item here authorizes inventing a
credential, policy, provider promise, or legal term.

## Data policy and operator disclosure

**Action required:** approve the deployment's operator identity and contact,
applicable processing basis, retention criteria, deletion/export procedure,
backup/log handling, and disclosures for Cloudflare, hosted PostgreSQL, Deepgram,
OpenAI review processing, and the selected runner provider.

This affects accounts, session cookies, source code, transcripts, checkpoints,
test output, help records, reviews/corrections, voice reservations, provider
processing, logs, and backups. Engineering cannot safely enable collection or
choose retention/deletion semantics without these decisions. Safe default:
`PERSONAL_DATA_COLLECTION_APPROVED=false`, no raw audio retention, and no hosted
personal practice.

## Cloudflare production environment

**Action required:** provide access to the target Cloudflare account, final HTTPS
origin/domain, Worker environment name, Queue, Durable Object, and Hyperdrive
provisioning choices. Confirm whether the pilot uses `workers.dev` or a custom
domain.

Engineering behavior depending on this: exact `BETTER_AUTH_URL`, trusted origin,
cookie behavior, bindings, CSP/header delivery, queue consumption, Durable Object
alarms, Hyperdrive connectivity, and hosted smoke tests. Safe default: dry-run
only; do not deploy or enable collection.

## Hosted PostgreSQL

**Action required:** select/provision the hosted PostgreSQL service and provide a
secret connection path (preferably Cloudflare Hyperdrive), supported PostgreSQL
version, required TLS mode/CA behavior, migration role, runtime role, connection
limit, backup policy, and a disposable verification database or schema.

Engineering behavior depending on this: production migrations, least-privilege
runtime connectivity, Better Auth sessions, evidence persistence, queue work, and
hosted schema verification. Safe default: no production database connection.

## Deepgram voice

**Action required:** provide the production Deepgram account/project and
`DEEPGRAM_API_KEY`; approve provider processing settings and spending/usage alerts.
Confirm that the configured Voice Agent listen/think/speak models are enabled for
the account.

Engineering behavior depending on this: live microphone/playback, transcript
quality, barge-in, reconnect, provider session provenance, quota behavior, and
cost verification. Safe default: voice availability reports disabled and no
provider connection is attempted.

## Evidence-review provider

**Action required:** confirm the production OpenAI project/model (or approve and
implement another adapter), provision the production credential, confirm its
data-processing settings, and approve a small fictional evaluation set for human
feedback-quality review. The current `openai-responses` adapter has passed one
real local structured-output request; that proves integration, not production
account policy, model quality, budget, or hosted configuration.

Engineering behavior depending on this: credentialed generation, model quality,
latency, spending, and provider retention verification. Safe default: reviews
fail explicitly with no fabricated findings.

## Production Python sandbox

**Action required:** select/provision a hosted execution service that can run an
ephemeral Linux sandbox per test with no public network, no application secrets,
strict CPU/memory/PID/filesystem/output/time limits, authenticated private ingress,
and reliable forced cleanup. Provide its deployment/account target and supported
service-auth mechanism.

Engineering behavior depending on this: the production `PYTHON_RUNNER` binding,
service authentication, isolation proof, operational alerting, and hosted
correct/incorrect/timeout tests. The local loopback Docker proxy is not an
acceptable production service. Safe default: runner binding absent and `/run`
returns 503 without a verdict.

## Password recovery pilot decision

**Action required:** decide whether invite-only pilot accounts may explicitly
operate without self-service password recovery, or select/configure an email
delivery provider and sender identity for Better Auth recovery.

Engineering behavior depending on this: reset-token delivery and user support.
Safe default: no reset endpoint is advertised; lost-password users require an
owner-approved support process or a new invitation.

## MVP problem set

**Action required:** approve 5–10 authored Python problems, reference solutions,
visible cases, help guidance, relationships, and expected difficulty labels. Each
must fit the runner's documented single-list positional function and exact-JSON
comparison contract unless a contract expansion is separately approved.

Engineering behavior depending on this: seed migration/content release and review
quality evaluation. Safe default: retain the two existing technical fixtures and
do not represent them as a complete curriculum.

## Hosted golden-path window

**Action required:** after the services above exist, authorize a deployment and a
fictional test account/window in which billable Deepgram and review calls may be
made. Provide access to relevant non-sensitive Cloudflare/provider diagnostics.

Engineering behavior depending on this: final hosted verification and release
decision. Safe default: `docs/mvp-verification.md` continues to state that the
hosted golden path is unproven.

## Independent CI/verification run

**Action required:** review these uncommitted changes, then run the new Backend CI
workflow in GitHub (or provide a verification host with Microsoft Edge and a
running Linux Docker engine). Local PostgreSQL 16, migrations, Better Auth, the
application schema, review/security integration, and the repository MVP flow are
now verified on this host. Microsoft Edge still requires administrator
installation and the Linux Docker engine is unavailable here.

Engineering behavior depending on this: an independent green proof of the full
ordinary browser route suite and real runner isolation tests. Safe default:
retain the recorded partial/local results and do not describe the release as
fully verified.
