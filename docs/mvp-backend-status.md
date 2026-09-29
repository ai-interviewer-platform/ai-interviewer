# MVP backend status

Last updated: 2026-09-28.

This is the working status for the frozen voice-first MVP golden path. `COMPLETE`
means the repository implementation and applicable local verification exist;
it does not substitute for the hosted golden-path proof recorded in
`mvp-verification.md`. `BLOCKED_EXTERNAL` means the remaining proof or choice
requires an account, credential, deployment, policy decision, or approved content.

## Final repository status

| Workstream | Status | Repository evidence and remaining work |
| --- | --- | --- |
| 1. Baseline and regression safety | PARTIAL | `npm run check`, lint, PostgreSQL/schema/auth/integration suites, focused backend tests, and production Wrangler dry-run pass. The full suite is 67/68; only the Edge route check is unavailable without host administrator installation. Docker's Linux engine is unavailable for live container isolation tests. See `mvp-verification.md`. |
| 2. Evidence-backed AI review generation | COMPLETE | `src/review-provider.ts` is vendor-independent; `src/review-providers/openai-responses.ts` is the isolated adapter. Frozen same-attempt evidence, bounds, untrusted structured-output validation, evidence membership, atomic publication, retry classification, and idempotence pass mocked and PostgreSQL tests. A real configured provider response was validated, persisted, and retrieved locally. Production account/model policy and hosted proof remain external deployment concerns. |
| 3. Voice MVP and coding context | PARTIAL | The secure relay retains quotas, timeouts, provenance, and server-held credentials. `get_coding_context` now supplies only a bounded owned active-attempt draft/checkpoint/visible-run/help snapshot; hidden tests, raw output, unsaved state, and other attempts are excluded. Ownership/bounds/missing-result tests pass. Live Deepgram verification is external. |
| 4. Production Python runner | BLOCKED_EXTERNAL | `src/runner.ts` implements the repository boundary through a service binding or fixed authenticated HTTPS endpoint, with fail-closed configuration and no browser credential forwarding. Local sandbox/reference contracts and hosted requirements are documented. An independently reviewed hosted sandbox target has not been selected or proven. |
| 5. Hosted PostgreSQL | BLOCKED_EXTERNAL | Migration discovery/checksums, fresh-schema ordering, schema/index/content/security verification, Hyperdrive guidance, and CI PostgreSQL are implemented. No hosted database, TLS/role/backup configuration, or hosted verification connection was provided. |
| 6. Authentication re-verification | PARTIAL | Better Auth signup/sign-in, session cookie, authenticated API use, sign-out/revocation, exact origin validation, owner scoping, PostgreSQL rate limiting, and anonymous/cross-user rejection are verified locally. Hosted cookie/origin proof and the pilot password-recovery decision remain external. |
| 7. Privacy and personal-data lifecycle | BLOCKED_EXTERNAL | Fail-closed collection and raw-audio-off behavior are preserved, and the data/log inventory is documented. Export, account deletion, automated retention, backup erasure, operator identity, and processor disclosures await policy decisions; no semantics were invented. |
| 8. Cloudflare production configuration | BLOCKED_EXTERNAL | Worker assets, Queue, Durable Object, readiness reporting, origin checks, runner transports, secrets/bindings checklist, deployment commands, and dry-runs are complete. Real account resources, Hyperdrive/binding IDs, secrets, domain, and deployment proof remain external. |
| 9. Observability, limits, and cost protection | PARTIAL | Non-sensitive structured events cover DB, runner, review, queue, and voice failures. API/voice/runner/review limits and external alert/spend requirements are documented. Provider/Cloudflare alert configuration and load/cost proof remain external. |
| 10. Backend CI | COMPLETE | `.github/workflows/backend-ci.yml` runs install, Edge setup, check, lint, unit tests, PostgreSQL migrations/schema/review/security/MVP integrations, real Docker runner tests, and live Better Auth/API integration without paid provider calls. It still needs its first GitHub run after these uncommitted changes are reviewed. |
| 11. MVP problem content | PARTIAL | Migration `0004_mvp_content_foundation.sql` strengthens the two existing Python fixtures to multiple edge cases, and schema verification enforces the runner contract/2–16 visible cases. Approval of a curated 5–10 problem set remains external. |
| 12. Hosted golden-path verification | BLOCKED_EXTERNAL | The disposable-PostgreSQL integration passes voice-mode creation, failed/passed runs, verified transcript/help/context, finish, fake evidence-backed review, retrieval, retry, and cross-user denial. A real review-provider request also passes locally. Real hosted voice, sandbox, queue/provider, auth, and failure paths are not proven. |
| 13. Release readiness | PARTIAL | Status, blockers, verification, provider/runner/database contracts, deployment checklist, and CI are updated. Launch-critical hosted services, policy approval, content approval, and complete golden-path proof remain outstanding, so the MVP is not declared ready. |

## Frozen MVP constraints

- Voice interviewing, safe Python execution, persisted evidence, real AI review,
  review retrieval, and checkpoint retry are required.
- Text-only interviewing, payments, broad analytics, and retained raw audio are
  outside this MVP.
- Missing configuration must fail closed; no fallback finding or code verdict may
  be fabricated.

Remaining human actions are listed only in `docs/mvp-blockers.md`. Exact executed
results, including environmental failures, are in `docs/mvp-verification.md`.
