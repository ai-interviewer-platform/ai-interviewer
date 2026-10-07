# Contextual feedback and triage

## Availability

Implemented and **off** until `FEEDBACK_COLLECTION_APPROVED=true` is set as a Worker dashboard variable and the private operator token exists. `wrangler.jsonc` does not set the flag. The fixture-backed tests prove the behavior; they do not report real feedback.

## Decisions

Decided under the owner's delegation of 2026-09-30. The shared collection, access, retention and processor rules are in `docs/product/measurement.md`.

| Decision | Choice |
|---|---|
| Contextual questions | One versioned question per feature, chosen by the page: `public/feedback-questions.js`. Changing a question's wording or answers requires a new version. |
| Answer semantics | Three neutral presets, none preselected, plus optional free text of up to 2000 characters. A response needs a preset, text or both, and only **Send feedback** records it; anything else is **nonresponse**. Collapsing the control (its button or Escape) or changing page keeps an unsent draft about the page where it started. Cancel discards it. |
| Context saved | Question ID and version, feature, page name and activity (`none`, `sample`, `personal`), the chosen preset and the text exactly as written. No account, email, Attempt, URL query or record identifier. Signed-in and anonymous people submit the same way; the server does not read the session. |
| Original responses | Preserved. A database trigger rejects any change to the question, context or response. Triage changes only category, status and resolution. |
| Triage responsibility and ownership | Jack Cao, the only operator, owns every record through the private operator token (`#operator` → Feedback triage, or `GET`/`POST /api/feedback/records`, filterable by status, feature, page and category). No account owns a response, so no account can read, change or delete it. |
| Response workflow | `new` → `reviewing` → `planned` → `resolved` or `declined`. Closing requires a recorded resolution. Categories: usability, content, bug, feature request, praise, other. No response time is promised. |
| Contact permission | None. Feedback is anonymous and no reply is sent. The form asks people not to include contact details, code, transcripts or passwords. A reply channel belongs to bug reports (#22). |
| Marketing consent | None. Feedback never subscribes anyone to anything and never joins the waitlist. |
| Retention and deletion | Kept until project retirement, also after resolution: an anonymous response is the product evidence behind its resolution. The operator deletes a record on request (through the published contact) or when its text contains personal data. |
| Evidence corrections | Separate. On review pages, the form says that it does not change a Finding and points to "Disagree with this feedback", the Correction flow. Sending feedback never disputes a Finding. |
| Availability | `public/support.js` loads separately from `app.js` and does not use measurement. It stays usable when a feature, the measurement service or `/api/site-config` fails. When the configuration is unreachable, the control appears and the server still refuses while feedback is off. |
| Abuse limit | 60 responses per minute project-wide (`limits` in `src/security.ts`); no identifier is stored for it. A per-visitor limit of 10 requests per minute, counted by Cloudflare for each IP address, stops one visitor from using it up; the address is not stored. |

## Feedback coverage matrix

| Page (`#…`) | Feature and question | Activity | Test |
|---|---|---|---|
| `landing` | landing: "How clear is what Coursay offers?" | none | keyboard, dismissal, error, save; route loop |
| `sample`, `interview`, `retry` | practice: "How did this practice step work for you?" | sample | route loop; save with `app.js` and site configuration unavailable |
| `review`, `complete` | review: "How understandable is this review?" with the Correction note | sample | route loop; save beside "Disagree with this feedback" |
| `welcome`, `roadmap`, `sessions`, `related`, `preferences`, `system`, `demo-profile` | navigation: "How easy was it to find what you needed here?" | sample | route loop |
| `terms`, `privacy`, `cookies` | policy: "How clear is this page?" | none | route loop |
| `personal` (account, workspace, review) | personal: "How is personal practice working for you?" | personal | route loop |
| `operator` | no control | — | — |

The test also checks that every page in `public/measurement-contract.js` has a feedback question.

## Verification

`node test/feedback-integration.mjs` needs a disposable local `DATABASE_URL`. It exercises the real request handler, PostgreSQL and a browser. It covers:
- question versions and answer semantics (the shared collection gate is checked by `test/site-collection-gate-integration.mjs`)
- the session-independent contract, private triage, filters, immutability and deletion
- the keyboard and focus behavior, dismissal and failure states
- a question on every page and coexistence with the Correction flow
- independence from `app.js` and measurement failures
- a browser submission through to operator triage
