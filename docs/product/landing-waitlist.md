# Landing and waitlist

## Contract and policy

The public entry route is `/#landing`. Existing `/#welcome` remains the prepared fictional workspace; public Home and brand links return to the landing. The landing separates the authored sample, available personal practice and waitlist interest. Audience: students/new grads preparing for SWE interviews who can already attempt Python problems. No language expansion, user counts, testimonials or hiring promises.

**Owner-selected primary action: personal practice; waitlist secondary** (2026-09-29). Production configuration records `personal_practice`; availability still gates the usable action.

**Waitlist policy selected under the owner's explicit delegation (2026-09-30 UTC).** The owner selected personal practice as primary, waitlist as secondary, and delegated the remaining policy choices. The configured policy is `waitlist-2026-09-30` (superseded by `waitlist-2026-09-30.2`, which changes only the processors text for #23 measurement): Jack Cao; `jack.cao@utdallas.edu`; optional invitations to new Coursay practice features and voluntary product feedback. Joining is not required for current practice. Confirmation uses a browser receipt, **no email provider and no email sent**; email ownership is not verified. Deployment remains gated by the private operator secret and migration readiness, owned by the release workflow.

Entries are retained until withdrawal, purpose fulfillment or waitlist closure, whichever comes first. Jack Cao deletes entries through the private API when the purpose is fulfilled or the waitlist closes. Anonymous outcomes remain until project retirement. Operator access: Jack Cao only. Processors: Cloudflare hosting and Neon PostgreSQL; waitlist data is not sent to AI models. These choices cover waitlist data and establish the contact/access/minimization baseline for #23; analytics/heatmap providers remain **none/off**. They do not resolve or alter the separate existing personal-practice policy.

Neon recovery history was verified at `history_retention_seconds = 21600` on 2026-09-30 UTC: the six-hour statement is the actual platform setting, not an invented retention period. Deleted entries may remain recoverable until configured history expiry. **Before serving traffic or contacting candidates from a restored database**, keep waitlist collection closed, use the private operator API to erase every restored waitlist entry, and require fresh opt-in. Preserve other application records. On project retirement, remove the anonymous outcomes as part of database retirement. Recheck the Neon setting and update the public notice before changing it.

The page reads `/api/personal-availability` and only presents personal practice as enabled when collection and MVP capability checks pass. This reflects deployment configuration, not a guarantee that every downstream service is healthy. Voice availability is reported separately. Failed availability checks retain the sample link and abstain from claiming personal practice is usable.

Live check, 2026-09-30 UTC: the configured production origin returned HTTP 200, `collectionEnabled: true`, `mvpReady: true`. The separately delegated waitlist policy does not replace the existing personal-data policy.

## Configuration and operation

Apply `migrations/0010_waitlist.sql` through the existing PostgreSQL migration runner. Waitlist records remain separate from accounts/attempts in the existing application PostgreSQL database. Marketing research storage in Cloudflare is a different data set.

Release receipt: `0010_waitlist.sql` applied and verified on Neon production at `2026-09-30T00:40:01.481Z`; SHA-256 `2e08c66de715f8332616474f845ed932c225d8bb27bed398b66cd9f4cce2f9d2`. The operator token is configured as a Worker secret; its local operator copy is in ignored `.env.marketing.local`. No token is committed or exposed to the browser. Migration and operator configuration are ready; live collection starts only after the reviewed deployment. No email is sent.

Set `LANDING_PRIMARY_ACTION` to the owner's choice: `waitlist` or `personal_practice`. Missing choice produces no selected primary action. Set `WAITLIST_COLLECTION_APPROVED=true` only after the actual policy is approved. Store `WAITLIST_OPERATOR_TOKEN` as a Worker secret, never a public variable or browser credential. `WAITLIST_POLICY` is JSON with these required fields:

| Field | Required owner decision |
|---|---|
| `version` | Published notice version |
| `contactPurpose` | Specific permitted contact purpose |
| `operator`, `contact` | Real operator identity and working contact channel |
| `retention` | Retention criteria for entries, anonymous outcomes and backups; no invented duration |
| `processors` | Actual hosting/database processing inventory and approved access |
| `deletion` | Receipt deletion, lost-receipt requests, backup handling and operator process |
| `emailProvider` | `none` for this implementation |
| `confirmation` | `browser_receipt` for this implementation |

Missing/incomplete policy or missing operator secret disables new collection. Withdrawal and authenticated operator deletion remain available after collection is switched off. The actual waitlist disclosures are published in the configured policy and public privacy notice. Additional analytics/heatmap processing requires its own #23 disclosure and implementation; this configuration enables neither analytics nor automatic outreach.

Operator API, private bearer token required:

- `GET /api/waitlist/records`: persisted entries and independent anonymous outcome records. Use this authenticated JSON view/export; no public operator dashboard.
- `POST /api/waitlist/records` with `{ "action": "delete", "id": "record-id" }`: delete an entry for a verified owner request or approved retention criteria. Apply the published backup process separately. Administrative deletion is not miscounted as voluntary withdrawal.

Joining requires email, affirmative purpose consent, current notice version. The server atomically saves the unique normalized email and a `waitlist_joined` outcome. Duplicate submissions return the same response shape and do not expose membership, replace the original receipt or create extra joined outcomes. A receipt from a duplicate request does not control an existing record; UI states this and directs lost-receipt requests to the published contact.

Receipt withdrawal atomically deletes a matching entry and records an anonymous `waitlist_withdrawn` outcome. Repeated or unmatched receipts receive the same confirmation and do not create outcomes. Email is not retained as a tombstone. Browser session storage retains the current email hash and receipt; a matching repeat preserves that receipt, a different email gets its own new receipt. The receipt is shown so candidates can save it outside the tab. Server stores only its SHA-256 hash. No receipt or email enters measurement payloads.

## Shared outcome contract for #23

Implemented and extended in `docs/product/measurement.md`: first-party transport, sitewide page coverage, landing heatmap and the operator report.

`public/measurement.js` is an opt-in adapter seam (`setMeasurementAdapter`). Default: no transport, tracking cookie, visitor identity, heatmap or replay. Adapter errors never block forms. Payload allowlist: version, event UUID, name, surface, activity, action, authority, `attribution: unknown`, document exposure UUID (#23 dropped the client timestamp; reports use server receipt time). No raw URL/referrer, query string, email, receipt, free text, code or transcript. Unknown attribution stays unknown; no manufactured campaign attribution.

| Outcome | Definition / authority | Denominator and observation window |
|---|---|---|
| `landing_exposed` | Landing mounted once per document lifetime; client | Distinct eligible document exposures observed by the approved adapter. Reload is a new exposure; rerender is not. Bot/internal filtering remains #23, so raw counts are not eligible-visitor counts. |
| `cta_selected` | Sample/waitlist/personal action selected; client intent | Distinct exposure IDs selecting the named action / distinct eligible exposures within an explicitly selected reporting interval. Not a signup or activation. |
| `waitlist_request_accepted` | Successful server response, including duplicates; client emits server-confirmed acknowledgement | Accepted requests in the reporting interval; **not unique joins**. Submitted requests are not observed, so no acceptance rate is reported. Client failure can make this missing despite server persistence. |
| `waitlist_joined` | New unique email committed; authoritative server outcome table | Actual committed joins. Exposure conversion denominator needs an approved cross-event attribution policy; currently unknown, so do not calculate that rate. |
| `waitlist_withdrawal_accepted` | Server acknowledges receipt request, including unmatched/repeated; client | Requests only, not number of records removed. |
| `waitlist_withdrawn` | Existing entry deleted through receipt; authoritative server outcome table | Actual removed entries; withdrawal cohort/rate requires an explicitly selected population and interval. |
| `practice_started` | Personal Attempt persisted; sample starts remain `activity: sample` and fictional | Eligible personal start intents for start completion; landing exposures for acquisition only after approved attribution. |
| `practice_completed` | Server confirms completed personal Attempt | Distinct started personal Attempts in the declared cohort. Open Attempts are incomplete/right-censored until the declared observation end. |
| `review_opened` | Ready Review displayed; client | Distinct eligible Attempts with ready Reviews. Missing browser events are not proof a Review was unread. |
| `retry_started` | New coach Attempt persisted with source Checkpoint | Eligible reviewed personal Attempts; distinguish persisted Retry from click intent. |

Practice/review/retry rows define the vocabulary for #23; this ticket does **not** claim to instrument those journeys or supply sitewide analytics. Sample events never become personal activation. Waitlist join never becomes practice activation.

Every report must record explicit `start`/`end` timestamps, cohort eligibility, deduplication key and observation end. No default numerical reporting/attribution window is chosen here. Until the owner/analyst selects those and #23 establishes eligible exposure/attribution, report counts and missingness, not conversion rates or lift. Server outcomes use UUID deduplication; there is no personal identifier for joining them to client exposure. Lack of an adapter/consent, blockers, offline clients and lost responses produce missing client observations; expose that limitation.

## Verification

`npm run test:waitlist` requires a disposable local `DATABASE_URL`; the test harness creates and removes its own schema. Browser exercises real request handler and PostgreSQL: server-confirmed signup, duplicate privacy, reload, withdrawal, operator export/deletion, missing policy, validation, failure recovery and analytics outage isolation. Desktop/mobile accessibility and screenshots use synthetic `.invalid` addresses in an isolated database and the configured public policy. Fixtures prove behavior and configured-policy disclosure, not conversion results. The documented owner delegation is the authority for the actual policy choices.

Generated evidence: `.local/marketing/landing-desktop.png`, `landing-mobile.png`. The Backend CI PostgreSQL job includes this browser/API check.
