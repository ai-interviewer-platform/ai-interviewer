# Landing experiments

## Availability

The experiment capability is implemented and **no live experiment is configured**. `LANDING_EXPERIMENT` is unset, so every document shows the control. A live experiment needs measured baseline evidence first: measurement (#23) must be on long enough to give a baseline window with landing documents and conversions. Until an owner-approved contract exists, the operator report gives observations only, never a winner. The fixture-backed tests prove the behavior; they do not show a conversion lift.

## Pre-registered contract

`LANDING_EXPERIMENT` is a Worker dashboard variable holding one JSON contract. Every field is an owner choice and has no default. A missing or invalid field serves the control to every document, and the operator report lists the problems. Changing the weights or the copy of a running experiment needs a new `id`.

| Field | Owner decision |
|---|---|
| `id` | Lowercase slug. A new experiment gets a new id. |
| `status` | `running` assigns variants from the `start`. `stopped` is the rollback and the stop: every document shows the control, and only a stopped experiment is analyzed. |
| `start` | When the experiment starts collecting. No variant is served before it. The analysis uses exposures from this time, whatever report window the operator chooses. |
| `hypothesis` | What the treatment changes, and why that could change the primary outcome. |
| `audience` | The eligible audience. The implementation counts landing documents that are not automated or internal. |
| `primaryOutcome` | One allowlisted outcome event and action, for example `{ "name": "cta_selected", "action": "waitlist" }`. |
| `guardrails` | One or more allowlisted outcome events and actions that must not get worse. |
| `baseline` | `start` and `end` of a measured window that closes before the experiment `start`. The report derives the baseline rate of the primary outcome from it. |
| `minimumEffect` | The smallest absolute difference in the primary outcome worth detecting, for example `0.02` for 2 percentage points. |
| `alpha`, `power` | Two-sided significance level and statistical power. |
| `identity` | `document`: see the allocation and identity policy. |
| `method` | `fixed-horizon-two-proportion`: see the method and stopping rule. |
| `variants` | Exactly two: the control first, without copy, then one treatment with plain-text `copy` for allowlisted slots (`eyebrow`, `headline`, `intro`). Each has a positive `weight`. |

Example (fixture numbers, not a recommendation):

```json
{ "id": "evidence-headline", "status": "running", "start": "2026-10-16T00:00:00Z",
  "hypothesis": "Naming the evidence in the headline raises waitlist intent.",
  "audience": "Landing documents that are not automated or internal.",
  "primaryOutcome": { "name": "cta_selected", "action": "waitlist" },
  "guardrails": [{ "name": "cta_selected", "action": "sample" }],
  "baseline": { "start": "2026-10-01T00:00:00Z", "end": "2026-10-15T00:00:00Z" },
  "minimumEffect": 0.02, "alpha": 0.05, "power": 0.8,
  "identity": "document", "method": "fixed-horizon-two-proportion",
  "variants": [{ "id": "control", "weight": 1 }, { "id": "evidence-first", "weight": 1, "copy": { "headline": "See what your practice shows." } }] }
```

## Behavior

| Decision | Choice |
|---|---|
| Allocation and identity | The unit is the Document (one page load). The variant is a hash of the experiment id and the page-load identifier, divided in proportion to the approved weights. It is stable for the document and needs no cookie, storage or cross-page identifier, as the measurement decisions require. A reload or new tab is assigned again, so one person can see both variants. |
| Variant version | The server computes each variant's version from its id and copy. Changing the wording is a new version; exposures of an old version are excluded. |
| Eligible exposure | `experiment_exposed`, sent once per document after the landing shows the assigned variant, with `eligibility`. Only `eligible` documents are analyzed. |
| Exclusions | `automation`: the browser reports `navigator.webdriver`, or the server sees a crawler or headless user agent (the server overrides the browser). `internal`: the operator opens `/#landing?internal`. Global Privacy Control or Do Not Track: the control is shown and nothing is sent. |
| Data-quality checks | Wrong variant (the server recomputes the assignment), old copy version, both variants in one document, and landing documents since the `start` without an exposure are counted and reported. |
| Outcomes | The primary outcome and the guardrails are client events of the exposed document at or after its exposure. Server waitlist joins and personal Attempts are not joined to variants. |
| Method and stopping rule | Fixed horizon. The planned documents per variant come from the two-proportion sample-size formula with the baseline rate, `minimumEffect`, `alpha`, `power` and the weight ratio. The report shows progress while the experiment runs and no interval. After every variant reaches its plan, the operator sets `status: stopped` and `end`. The analysis then uses the first planned eligible documents of each variant, with outcomes observed until `end`. Stopping before the plan is inconclusive. |
| Inference | Unpooled (Wald) interval for the treatment − control difference at `1 − alpha`, analyzed from the contract `start` to its `end`. A 0% or 100% rate in a variant gives a zero-width interval; the report states this limitation. `difference_detected` when it excludes zero, otherwise `inconclusive`. Guardrails get the same interval, not adjusted for multiple comparisons. |
| No winner | The report never names a winner. It shows the interval, the guardrails, the exclusions and the limitations; the owner decides. |
| Before/after | The report states that the comparison is randomized and concurrent. The baseline only derives the plan; it is never compared with the experiment. |

Every other numeric setting is derived from the contract. There is no traffic threshold, duration or minimum sample in the code.

## Operation

1. Keep measurement on. Choose a baseline window and read the landing funnel in `#operator`.
2. Record the contract in `LANDING_EXPERIMENT` with `status: running`. Check `#operator`: an incomplete contract lists its problems.
3. Load the report for any window: the experiment uses its own window. It shows the derived plan and progress while collecting.
4. Roll back at any time with `status: stopped` and `end`. Removing the variable also shows the control, but the report can no longer analyze the experiment.
5. When the report says every variant has reached its plan, set `status: stopped` and `end`. Read the interval and guardrails, then record the decision outside the tool.

## Disclosure

The privacy notice (Measurement, when enabled) states that the landing page can show one of two wordings, records which wording it showed, and records whether the page load looks automated or was marked internal. The waitlist policy version stays `waitlist-2026-09-30.2`: it versions the waitlist section, whose text did not change.

## Verification

`node test/experiment.test.mjs` checks the sample-size formula against the textbook value (3,841 per group for 10% → 12%), the interval, the assignment weights and the contract gate. `node test/experiment-integration.mjs` needs a disposable local `DATABASE_URL`. It exercises the real request handler, PostgreSQL and a browser: contract gate, rollback, derived plan, fixed horizon, the interval and guardrails, every exclusion and missing-data count, the stable variant and copy in the browser, Global Privacy Control, the operator report and the aggregate download.
