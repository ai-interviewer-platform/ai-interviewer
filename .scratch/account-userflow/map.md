# Sign-in through session and logout consistency

Label: wayfinder:map

## Destination

Repair navigation from sign-in through personal practice and logout. Account links must reach real profile/settings/session destinations, account menus must support keyboard use and sign-out, and session screens must omit the footer.

## Notes

Execution is included because the requester explicitly asked agents to audit and fix the inconsistencies. This local Markdown map uses wayfinder's fallback tracker convention; no repository tracker was configured. Apply the requester's MSW necessity rule and three-round fuse. Existing demo scenes remain explicitly fictional; no auth-provider migration or deployment is requested.

## Decisions so far

- [Verify and repair the account-to-session flow](issues/01-verify-flow.md): Real account routes, shared menus, auth transitions, session footer removal, and mobile work-area visibility are implemented and locally verified.

## Not yet specified

None: the audit identified the affected navigation and authentication boundaries.

## Out of scope

Provider migration, redesigning practice content, and production deployment do not establish the requested navigation contract.
