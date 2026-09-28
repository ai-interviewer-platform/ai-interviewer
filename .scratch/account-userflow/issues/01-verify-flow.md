# Verify and repair the account-to-session flow

Type: task
Label: wayfinder:task
Status: resolved
Assignee: Codex
Parent: ../map.md
Blocked by: none

## Question

Which existing links and authentication transitions break the requested sign-in, personal usage, account navigation, and logout flow, and do the scoped repairs restore that flow?

## Evidence to establish

- Browser interactions reach actual personal profile/settings/session destinations and preserve those destinations on reload.
- Account disclosure supports keyboard opening, dismissal, settings navigation, and logout.
- Signup followed by logout and sign-in uses the correct auth endpoint; password-reset links remain usable with an existing session.
- Session workspace/review/retry screens omit footers while ordinary pages retain them.
- Relevant repository checks pass. Controlled API fixtures prove frontend behavior; they do not establish production authentication or provider availability.

## Answer

Repaired real account destinations and sign-in aliases, separated the fictional profile at `#demo-profile`, and added shared account disclosures across public and personal screens. Personal profile uses authenticated identity; settings exposes the existing export/delete controls. Personal destinations survive reload and support history navigation. Signup/logout resets authentication mode; reset links take precedence over an existing session. Navigation and logout preserve active editor drafts. Mount cleanup stops voice when leaving personal screens.

Session workspaces, reviews, retries, completion, and related screens no longer display the shared footer. Browser verification also exposed mobile CSS hiding the personal code and conversation panes without a pane switcher; a scoped override makes those areas reachable.

Proof: `npm run check`, `npm run lint`, and `git diff --check` pass. The existing 82 tests passed in the full suite. The new mocked userflow test initially failed because its signup fixture omitted a session token; after fixing the fixture and the observed mobile pane bug, its final targeted run passed (1/1). It covers signup/logout/sign-in endpoint selection, signed-in reset entry, account menu keyboard/dismissal, actual profile/settings, mobile fit, setup/review/retry, draft saves before settings/logout, public-menu logout, guest profile gating, and footer boundaries. Screenshot gallery: [Local browser evidence](../../../output/playwright/userflow/index.html).

Live production authentication, voice, execution, and provider behavior were not exercised by this frontend verification. No deployment was performed.
