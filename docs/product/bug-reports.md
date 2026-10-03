# Bug reports and triage

## Availability

Implemented and **off** until `BUG_REPORT_COLLECTION_APPROVED=true` is set as a Worker dashboard variable and the private operator token exists. `wrangler.jsonc` does not set the flag. While it is off, **Report a problem** stays on every page and gives the contact address instead of a form. The fixture-backed tests prove the behavior; they do not report real bugs.

## Decisions

Decided under the owner's delegation of 2026-09-30. The shared collection, access and processor rules are in `docs/product/measurement.md`.

| Decision | Choice |
|---|---|
| Report content | What the person expected, what happened instead (both required, up to 4000 characters each), optional steps, and the page, feature and activity. |
| Permitted diagnostics | `public/bug-report-contract.js`: browser family, operating-system family, viewport class and width rounded to 100 px, online state, and the names of up to 5 recent script or resource errors. They are listed in the form before submission. Clearing **Include these details** sends none. |
| Excluded | Diagnostics never carry code, transcripts, audio, error messages, stacks, file names, logs, the user-agent string, URLs, queries, IP addresses or account identifiers; the server drops any diagnostic that is not allowlisted, and a bad diagnostic never blocks a report. The three answers are free text: the form asks people not to paste code, transcripts, passwords or keys, and the server replaces anything shaped like a key, bearer token, password assignment or long token (`secretPattern`) with `[removed]` before storing it. |
| Reply permission | Optional. A reply address is saved only with the stated purpose checked: "Jack Cao may email this address only about this report. The address is erased when the report is closed." The purpose is stored with the address. On request, the operator erases the address while the report stays open (**Erase reply address**). No marketing and no waitlist sign-up. |
| Anonymous and signed-in ownership | Both submit the same way, and the server never reads the session. No account owns a report, so no account can read, change or delete one. Jack Cao owns every report as the only operator. Account deletion does not affect reports; a person with a reply address can ask for deletion through the published contact. |
| Triage responsibility | Jack Cao, through the private operator token (`#operator` → Bug report triage, or `GET`/`POST /api/bug-reports/records`, filterable by status, page and feature). Notes and resolutions that a triage update does not send stay as they were. |
| Workflow | `new` → `investigating` → `fixed`, `cannot_reproduce` or `declined`. Investigation notes are kept with the report. Closing requires a resolution and erases the reply address and its purpose. No response time is promised. |
| Original reports | Preserved. A database trigger rejects any change to the report, its context or diagnostics. The reply address can only be erased. |
| Acknowledgement | A reference (`BR-` and 8 hexadecimal characters) and a statement that reports are private. Nothing is posted publicly or sent to an issue tracker automatically. |
| Error states | Missing or invalid fields are marked, described and focused. Server or connection failures keep all text and offer the contact address. |
| Availability | `public/support.js` loads separately from `app.js`, shows **Report a problem** without waiting for configuration, and does not use measurement or feedback. Pages outside the app report as page `other`. |
| Retention and deletion | Reports are kept until project retirement; reply addresses only until the report is closed or permission is withdrawn. The operator deletes a report on request or when its text contains personal data. |
| Abuse limit | 30 reports per minute project-wide (`limits` in `src/security.ts`); no identifier is stored for it. |

## Bug-report coverage matrix

| Journey | What is proved | Test |
|---|---|---|
| Every page in `public/measurement-contract.js`, plus a page outside the app | The control opens and names the page in its diagnostics | route loop |
| Sample interview preview with a script error | Diagnostics shown before submission, error name only, no transcript | browser report |
| Invalid, then failed, then saved report | Field errors and focus, reply purpose required, text kept on failure with the contact address, reference acknowledged | browser report |
| Diagnostics opt-out | Report saved with no diagnostics | browser report |
| `app.js` and site configuration unavailable | Report saved from a review page | app failure |
| Measurement failing | Report saved | whole browser run (`/api/measure` aborted) |
| Collection off | Contact address instead of a form | disabled fallback |
| Secret-shaped text in an answer | Replaced before storage | API check |
| Feedback save failing, feedback module unavailable, signed-in cookie | Report still saved | browser report, app failure |
| Anonymous and signed-in | Same contract; the session is never read | API check with a session cookie |
| Report → investigation → resolution | Operator filters, notes, closes, and the reply address is erased | API and operator browser checks |

## Verification

`node test/bug-report-integration.mjs` needs a disposable local `DATABASE_URL`. It exercises the real request handler, PostgreSQL and a browser, and covers every journey in the matrix. `node test/site-collection-gate-integration.mjs` checks the shared Site collection gate: closed collection, origin, body limit, JSON, rate limit and Operator access.
