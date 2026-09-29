# Connected operator console v2 implementation plan

**Goal:** Replace `/internal` with the owner-approved v2 client console design while preserving every supported admin operation and making every visible action truthful.

**Design:** The approved `/internal/design` prototype and `prototype/internal-client-console-v2-cn-audit.md` define layout, type, spacing, navigation and action placement. The existing `/internal` panels and `/api/internal` routes define working behavior. User decision on 2026-09-28: connect client screens first; named operator Accounts are deferred until a real identity service exists.

**Architecture:** Keep the existing passcode gate and BFF authentication. Build the new portfolio/client shell at `/internal`, then recompose existing modules around their current API calls. Add an optional person ID to the login-link route; validate it against the selected client's users. The raw issued URL is shown only on creation and cannot be recovered from history. Keep `/internal/design` as a labelled sample-data reference during review.

**Stack:** Next.js 16, React 19, TypeScript, existing Base UI/shadcn primitives and scoped admin CSS.

## Constraints

- No new backend endpoint or fabricated status. The existing client-create route now passes through the backend's supported IANA time zone field. Preserve main's `America/New_York` default while letting the operator choose another zone.
- Keep tenant IDs in server-owned API paths and preserve passcode checks.
- A new link is copied only from its issuance response; history supports status and revoke, not copy. The token itself does not expire automatically.
- Loading, write failure and clipboard failure must be visible and must not claim success.
- No operator Accounts controls until named authentication and audit attribution exist.
- Preserve the active client's module and direct-link behavior without exposing another client's state.

## Tasks

1. **Link recipient:** Extend `api/internal/client-login-link` to accept optional `userId`, validate it in the client's user list, and keep the old first-person default for existing callers. Test wrong-client and unknown IDs.
2. **Connected shell:** Move the approved two-level layout and responsive navigation to `/internal`. Connect list, search, selection, create client/person, errors, and URL state. Do not move sample fixtures into the production route.
3. **Client modules:** Recompose Overview, People, Sources, Knowledge, Voice, Access, and Held drafts using current BFF routes. Keep source/knowledge provenance, asynchronous processing, exact voice version, issuance-only raw link handling, confirmation for destructive actions, and held release semantics.
4. **Truthful boundaries:** Show the client journey as an explanatory preview only, distinguish link issue/use/onboarding completion, and remove Accounts actions from the connected console. Record remaining backend gaps.
5. **Verification:** Typecheck, build, existing tests, revised admin design/browser tests at desktop/phone widths, action matrix with intercepted API responses, and a connected synthetic backend journey where the test environment permits. Update frontend capability and verification records with what ran and what did not.

## Review focus

- Failed list or detail reads must show an error rather than an empty client or source state.
- Client switches must clear selected person, source, knowledge item, and one-time link.
- Link generation must use the selected person and must refuse a person outside the client.
- Clipboard denial must keep the one-time URL selectable and show an error.
- Two-step client/person creation must preserve the created client after a person-call failure.
