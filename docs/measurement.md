# Sitewide measurement and landing heatmap — Ticket 07 (#23)

## Status

First-party measurement is implemented and **off** until `MEASUREMENT_COLLECTION_APPROVED=true` is set as a Worker dashboard variable and the private operator token exists. `wrangler.jsonc` does not set the flag, so a deploy never turns collection on (`keep_vars` preserves the dashboard value). The fixture-backed tests prove the behavior; they do not show live conversion results.

Disclosure comes before collection: the privacy notice and cookies page describe measurement "when enabled". Waitlist policy `waitlist-2026-09-30.2` replaces "Analytics and heatmaps are off" with "never enters measurement", so turning the flag on does not contradict a published notice. Existing entries keep the version they agreed to; the contact purpose is unchanged.

## Shared collection decisions

Decided under the owner's delegation of 2026-09-30, on the baseline of `docs/landing-waitlist.md`. Contextual feedback (#21) and bug reports (#22) apply these rules and own their own contact and operating decisions.

| Decision | Choice |
|---|---|
| Analytics provider | First-party only: the Coursay Worker (Cloudflare) receives events at `POST /api/measure` and stores them in Neon PostgreSQL. No third-party analytics, session replay or heatmap provider. |
| Heatmap provider and surface | First-party. Landing page only (`#landing`). Clicks bucketed to a 20 × 20 grid plus a named zone; no coordinates, element text, screenshots or replay. |
| Surface coverage | Every route emits `page_viewed` with its allowlisted name. Sensitive surfaces (sample and personal workspaces, reviews, account pages) keep event coverage and are excluded from the heatmap. The feedback control sends no measurement events. |
| Consent and disclosure | No cookie, browser storage or cross-page identifier. Disclosed in the privacy notice and the cookies page. Global Privacy Control or Do Not Track sends nothing. The server flag and operator token gate collection. |
| Operator access | Jack Cao only, through the private operator token (`WAITLIST_OPERATOR_TOKEN`), shared by every operator API. `#operator` is a public page shell with no data: reports load only after the token is entered, and the token stays in tab memory. This replaces the #20 choice of no operator page, because a heatmap is not inspectable as JSON. |
| Retention | Measurement events: until project retirement. No numeric retention period is set. Feedback (#21) and bug reports (#22) record their own retention. |
| Export and deletion | Events carry no personal identifier, so individual requests cannot be matched. The operator can export aggregates through the report API. Project retirement deletes the tables. |
| Processor inventory | Cloudflare (hosting, request processing) and Neon PostgreSQL (storage). Google Fonts receives font requests as before, with no measurement data. No AI processing of measurement, feedback or bug-report records. |
| Minimization | Allowlisted fields only. The server rejects unknown event names, surfaces, actions and zones and stores only allowlisted columns. No email, receipt, free text, code, transcript, URL, query, referrer, IP address or account identifier. |
| Outage behavior | Measurement never blocks product, feedback or bug-report work: adapter errors are swallowed, and the server returns 503 when off. |
| Abuse limit | A project-wide limit of 1200 events per minute (`limits` in `src/security.ts`). Exhausting it drops events, never product work. No identifier is stored for rate limiting. |

## Event contract

`public/measurement-contract.js` holds the allowlists (names, pages and their activity, actions, heat zones, grid size) that both the browser and the server check. `public/measurement.js` builds every event: `version`, `id` (event UUID, the deduplication key), `name`, `surface` (allowlisted page name), `activity` (`none`, `sample`, `personal`), `action`, `authority`, `attribution: unknown` and `exposureId`. `landing_click` adds `zone`, `cellX`, `cellY` and `viewport` (`narrow` below 768 px); a keyboard activation counts at the control's centre. The server rejects any event whose `attribution` is not `unknown`. `exposureId` is one random UUID per page load (document): hash navigation keeps it, and a reload or new tab replaces it. Events queue until `/api/site-config` answers, then go out or are dropped.

The outcome vocabulary and authority rules of `docs/landing-waitlist.md` still apply. This ticket adds:

| Event | Emitted when | Authority |
|---|---|---|
| `page_viewed` | The page name changes (a query change on the same page is not a new view) | client |
| `landing_click` | Click on the landing page outside text fields | client |
| `practice_started` | Sample: sample or interview preview opens (`activity: sample`). Personal: server confirms the new Attempt | client / server-confirmed |
| `practice_completed` | Sample finish; personal finish confirmed by the server | client / server-confirmed |
| `review_opened` | Sample review page opens; a personal ready Review is shown (once per Review per document) | client |
| `retry_started` | Sample retry selected; personal Retry confirmed by the server | client / server-confirmed |
| `experiment_exposed` | The landing shows the variant of a running experiment (#24), once per document. Adds `experiment`, `variant`, `variantVersion` and `eligibility`. See `docs/landing-experiments.md`. | client |

Sample events stay `activity: sample` and never count as personal practice.

## Report and denominators

`GET /api/measure/report?start=<ISO>&end=<ISO>` (operator token) and the `#operator` page. The operator must choose both ends; there is no default window. The window uses server receipt time, `start` inclusive and `end` exclusive.

- **Landing funnel**: `documents` = distinct documents with `landing_exposed` in the window. Each step = those documents that sent that event (by activity and action) at or after their landing exposure. `documents` is the denominator for every step. `unattributedDocuments` = documents with events but no landing exposure in the window (entered elsewhere, or attribution unknown).
- **Personal cohort** (authoritative server records): personal Attempts created in the window without a retry source. `completed` and `reviewsReady` are observed before `end`. `openAtEnd` Attempts are right-censored, not failed. `reviewedRetried` = cohort Attempts with a ready Review before `end` and at least one Retry created before `end` (the #20 denominator is reviewed Attempts, so compare it with `reviewsReady`).
- **Waitlist**: `waitlist_joined` and `waitlist_withdrawn` server outcomes in the window.
- **Events**: counts per name, surface, activity, action and authority, with distinct documents, resent `duplicates` (same event UUID; stored once) and `withoutDocument` (missing exposure).
- **Heatmap**: landing clicks per viewport, zone and cell.
- **Experiment**: the configured landing experiment (#24), or its contract problems. See `docs/landing-experiments.md`.

The report never calculates a rate between client documents and server outcomes: they are not joined. Click intent is never counted as persisted success. The `limitations` list comes with every report.

## Analytics coverage matrix

| Journey or surface | Events | Heatmap | Test |
|---|---|---|---|
| Landing (`#landing`) | `page_viewed`, `landing_exposed`, `cta_selected`, `landing_click` | Yes, text fields masked | measurement journey, masked clicks |
| Landing → waitlist | `waitlist_request_accepted`, `waitlist_withdrawal_accepted`; server `waitlist_joined`/`withdrawn` | No (form) | waitlist test, report waitlist counts |
| Landing → sample practice → review → retry | `cta_selected`, `practice_started`, `practice_completed`, `review_opened`, `retry_started` (`sample`) | No | journey events, landing funnel steps |
| Personal practice → review → retry | server-confirmed `practice_started`, `practice_completed`, `retry_started`; `review_opened` (`personal`); server cohort | No | server cohort in the measurement test; client emissions and exclusion of code and account data in the mocked personal flow (`test/userflow-navigation.test.mjs`) |
| Sample pages (fictional): `welcome`, `roadmap`, `sessions`, `setup`, `interview`, `review`, `retry`, `complete`, `related`, `preferences`, `system`, `demo-profile` | `page_viewed` (`sample`) | No | route loop |
| Legal: `terms`, `privacy`, `cookies` | `page_viewed` (`none`) | No | route loop |
| `personal` (account, workspace, review) | `page_viewed` (`personal`) | No | route loop |
| `operator` | none | No | not in the allowlist |
| Analytics outage (`/api/measure` failing, `/api/site-config` unreachable) | nothing is sent; waitlist and sample still work | — | outage check |
| Global Privacy Control / Do Not Track | nothing is sent | — | GPC check |

Payload inspection: the browser test captures every `/api/measure` body during the journey and the route loop, with an email address, a typed transcript and sensitive URL queries on the page. It asserts that none of them appear and that only the allowlisted keys are present.

## Verification

`node test/measurement-integration.mjs` needs a disposable local `DATABASE_URL`. It exercises the real request handler, PostgreSQL and a browser with synthetic interactions. It covers the collection gate, origin check, allowlist, deduplication, private report access, the sitewide route loop, masking, outage isolation, GPC, and the operator funnel and heatmap view.
