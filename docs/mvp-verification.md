# MVP backend verification

Last updated: 2026-09-28.

This file records executed evidence, not planned checks. Tests use fictional data.
The complete hosted golden path has **not** been proven.

## Pre-change baseline

| Check | Result | Evidence |
| --- | --- | --- |
| `npm run check` | PASS | Voice bundle built; TypeScript and JavaScript syntax checks passed. |
| `npm run lint` | PASS | Zero warnings and zero errors across 57 files. |
| `npm test` | ENVIRONMENTAL FAILURE | 56 of 57 passed. The route-boundary test could not launch Microsoft Edge at `/opt/microsoft/msedge/msedge`; no application assertion failed in that test. |
| `npx wrangler deploy --dry-run --env=""` | PASS | Assets bundled; `VOICE_SESSIONS` and `REVIEW_QUEUE` bindings resolved. No deployment performed. |
| `npm run db:local:status` | NOT AVAILABLE | Local PostgreSQL is stopped or not initialized. PostgreSQL integration, migration, review, security, and live auth suites were not run in this baseline. |
| `npm run test:runner` | ENVIRONMENTAL FAILURE | Docker Linux engine unavailable before container tests began. |

## Baseline interpretation

- Mocked review generation, strict evidence validation, queue behavior, runner
  contract parsing, HTTP proxying, origin enforcement, limits, and voice source
  contracts pass in the ordinary suite.
- The baseline does not prove Docker isolation on this host, PostgreSQL behavior
  on this host, real Deepgram behavior, a credentialed review provider, hosted
  bindings, or end-to-end deployment.
- Existing uncommitted work was present before this effort in `.gitignore`,
  `package-lock.json`, `AGENTS.md`, `docs/backend-api.md`, and
  `test/backend-api-integration.mjs`; it is preserved.

## Post-change repository verification

| Check | Result | Evidence |
| --- | --- | --- |
| `git diff --check` | PASS | No whitespace errors. |
| `npm run check` | PASS | Voice bundle, TypeScript, and JavaScript syntax checks passed. |
| `npm run lint` | PASS | Zero warnings/errors across 68 checked files. |
| Focused backend tests | PASS | Review provider/core, voice contract/context, runner client, runtime config, and migration contract all passed (6 test files). |
| `npm test` | ENVIRONMENTAL FAILURE | 67 of 68 tests passed. Only `public-route-boundary` failed because `/opt/microsoft/msedge/msedge` is absent. Loopback runner/proxy tests passed when executed outside the filesystem/network sandbox. |
| `npx playwright install msedge` | BLOCKED_ENVIRONMENT | Playwright attempted the documented install but the host requires an interactive administrator password. No browser was installed. |
| `npx wrangler deploy --dry-run --env=""` | PASS | Worker/assets, `VOICE_SESSIONS`, and `REVIEW_QUEUE` bundled. No deployment. |
| `npx wrangler deploy --dry-run --env runner` | PASS | Worker/assets plus the development `PYTHON_RUNNER` service binding bundled. No deployment. |
| `npx wrangler deploy --dry-run --config runner/wrangler.jsonc` | PASS | Development runner proxy bundled. It remains prohibited as a production sandbox. |
| `npm run db:local:status` | PASS | WSL-local PostgreSQL 16 is running and accepts the repository database connection. |
| `npm run migrate:postgres` | PASS | All generated Better Auth and four numbered application migrations are applied with verified checksums. |
| `npm run db:verify:target` | PASS | Migration ledger, Better Auth mapping, application schema, security constraints, indexes, problem catalog, and review/runner contracts verified. |
| `npm run db:local:verify-auth` | PASS | Fictional signup, session cookie, authenticated request, sign-out, and revoked-session rejection verified through the Worker. |
| `npm run test:postgres` | PASS | Schema verification plus review, security/voice, and complete repository-only MVP database integrations passed. |
| Real review-provider request | PASS | Configured provider returned strict structured findings; evidence IDs were validated against frozen attempt evidence, persisted transactionally, and retrieved. No credential or evidence content was logged. |
| `npm run test:runner` | ENVIRONMENTAL FAILURE | Failed before candidate execution because the Docker Linux engine is unavailable. |

The focused review suite uses fake normalized provider output and exercises valid
evidence, invented/foreign/duplicate citations, malformed/oversized output,
provider status classification, rollback, queue retry, collection gating, and
duplicate terminal delivery without a paid API call. Voice-context tests exercise
ownership, active/completed state, source/response bounds, missing results, and
field filtering. Runner-client tests exercise binding precedence, fixed HTTPS and
paired-token validation, and header isolation.

`test/mvp-backend-integration.mjs` passed against disposable PostgreSQL and is
wired into Backend CI. It covers missing-provider fail-closed behavior, voice attempt
creation, incorrect/correct Python results through a fake hosted runner, verified
transcript/help persistence, bounded context, finish/queue, fake evidence-linked
review, retrieval, voice retry, completed-context rejection, and cross-user
denial.

The new GitHub workflow provisions PostgreSQL 16, installs Edge,
runs migrations/schema checks and all database integrations, runs the real Docker
runner suites, and starts the Worker for Better Auth/API integration. It uses
fictional data and mocks at paid voice/review provider boundaries. The workflow
itself has not run because this task does not authorize committing or pushing.

The production-configuration audit found no Deepgram key and no production runner
endpoint/binding in local configuration, so neither live Deepgram nor hosted
Python execution was claimed. A duplicate non-secret `REVIEW_PROVIDER` selector
in `.dev.vars` was normalized; all credentials and unrelated settings were
preserved.

## Hosted golden path

Status: **BLOCKED_EXTERNAL / NOT PROVEN**.

Hosted evidence must cover signup, sign-in, catalog, voice, transcript persistence,
draft/run/checkpoints, bounded interviewer coding context, finish/queue/review,
evidence citations, retry, sign-out/revocation, and the enumerated failure cases.
