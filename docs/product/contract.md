# Product contract

Coursay supports Python interview practice grounded in recorded evidence.
Terms belong in the [glossary](../../CONTEXT.md); this document defines their
relationships and boundaries.

## Practice loop

1. A Candidate starts an Attempt on a Problem in mock or coach Mode.
2. The Attempt records conversation, saved code, Checkpoints, Runs, and Help requests.
3. Completion freezes a Submission and the Evidence available to its Review.
4. Each Finding cites that Evidence and distinguishes observation from interpretation.
5. A Retry starts a new coach Attempt from a supported earlier Checkpoint.

Completion and Review processing have separate lifecycles. A failed Review does
not erase a completed Attempt. Retry preserves the original Attempt and its
record; it does not restore a running process or hidden model state.

Coursay does not infer lasting ability, hiring outcomes, or struggle from timing.
Visible test results do not establish hidden-test correctness. A Help request
does not prove help was delivered. A Correction remains distinguishable from
the original Finding.

## Evidence-backed reviews

The frozen Attempt record determines eligible Evidence. Reviews cannot borrow
another Attempt's events or expand their evidence after completion. Findings
must cite eligible event IDs; citation membership alone does not prove the prose
is correct. Human evaluation remains necessary.

Missing configuration, failed providers, or invalid output produce an explicit
failure, never invented findings or test verdicts. Review publication is atomic;
queue redelivery cannot duplicate it. See [review processing](../reference/review-processing.md)
for adapter configuration, validation, and recovery.

## Sample and personal practice

The Sample is fictional and requires no account. Personal routes use owned
records and fail closed when collection is unavailable. Sample data cannot
silently become a Candidate's record or capture a microphone.

The Interviewer sees saved state only; see the
[saved-state decision](../adr/0001-interviewer-sees-only-saved-state.md).
Both Input modes follow the same Interviewer rules for each Mode, and treat
candidate code and messages as data, never as instructions.
Voice processing and retained audio are separate choices. The application
streams consented voice and stores transcript text; it does not retain raw audio.

## Trust and privacy boundaries

- Authenticate and authorize every personal record access against its owner.
- Keep provider credentials, hidden tests, and reference solutions off the browser.
- Run candidate Python in isolation without application secrets or public network
  access; see the [runner contract](../reference/python-runner.md).
- Treat candidate text, code, runner output, and model output as untrusted input.
- Keep source, transcripts, tokens, and raw provider errors out of operational logs.
- Enable each collection surface only under its approved policy and configuration.
  Account export/deletion does not define backup erasure or provider retention.

The [deployment runbook](../operations/production-deployment.md) owns release
prerequisites. Runtime policy and limits live in `src/data-policy.ts`,
`src/security.ts`, `src/review-provider.ts`, and `src/runtime-config.ts`.
Read those definitions rather than copying numeric limits into this contract.

## Public engagement

Waitlist interest, anonymous Measurement events, Feedback responses, and private
Bug reports are separate records. They do not become interview Evidence.
Their contracts: [waitlist](landing-waitlist.md), [measurement](measurement.md),
[feedback](contextual-feedback.md), [bug reports](bug-reports.md), and
[landing experiments](landing-experiments.md).

Content research distinguishes Source observations, Content hypotheses, and
measured Experiment outcomes. A Campaign brief is a proposal; approval and a
recorded launch action are separate. See [marketing tools](../../tools/marketing/README.md).

## Verification boundary

Tests prove the behavior exercised in their environment. Mocked providers,
local databases, dry-runs, and dated audits do not establish current hosted
readiness, provider policy, model quality, or product demand. Historical results
belong in [the archive](../archive/README.md), not this contract.
