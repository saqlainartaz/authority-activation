# Verification record

Verified locally on 2026-09-14 and rechecked on 2026-09-15 (Europe/Warsaw). Nothing in this record is a
deployment or live-provider claim.

## Pinned inputs

- Approved stakeholder frontend initial revision:
  `ec2f05f83dd70b59cc39d3d2240fad9b291d8d17`
- Retained Next.js BFF, admin, authentication, and TypeScript-agent reference:
  `8c790eba6920a3397d64486bd5162815f28ef96c`
- Compatible isolated Python backend:
  `6a7429f9779537a777c99e89ac6d4b5da2bdc736`

## Migration parity

- The original Vite application was checked and run before application-code
  changes.
- Fifty baseline screenshots cover the approved screens in light and dark
  themes at phone, tablet, and desktop widths, including 767/768 px and
  1179/1180 px boundary pairs. See `baseline/`.
- The same fifty scenarios were captured from the migrated Next.js app with
  the same fixture data and UI state. Pixel comparison reported 50 of 50 exact
  matches (0 differing pixels). See `migration/`.
- Connected-state screenshots using backend-shaped synthetic data are in
  `integration/screenshots/`: admin states, an unsupported-onboarding error,
  persisted knowledge/source state, desktop light workspace, and phone dark
  workspace. The redesigned admin shell also has production-build screenshots
  at 1,440, 1,000, and 390 px using intercepted synthetic reads.

## Final automated results

Run from `frontend/frontend`:

- `npm run check`: passed.
  - design tests: 21 passed
  - stack unit/integration tests: 307 passed across 36 files
  - TypeScript and all agent/BFF/schema/static boundary checks passed
- `npm run build`: passed with Next.js 16.3.3; all App Router pages and route
  handlers compiled and page generation completed.
- Connected production-build Playwright journey: 1 passed in 23.5 seconds.

Run from the isolated backend with `.env` loading disabled and explicit
task-owned database URLs on loopback port 55432:

- full `pytest`: 1,522 passed, 4 skipped in 420.40 seconds
- Ruff: passed
- Import Linter: 5 contracts kept, 0 broken (101 files / 303 dependencies)

The four backend skips are optional Docling/live-provider checks. Anthropic and
Voyage keys were blank; no paid or live-provider call was made.

## Connected journey evidence

The browser journey used the production Next.js server, the isolated compatible
Python service, a disposable PostgreSQL database, synthetic tenant/source data,
fake Python providers, and the server-only deterministic TypeScript model
decision substitute. It exercised:

- unauthenticated route gating, generic credential refusal, internal-passcode
  refusal, and admin access;
- every retained admin module plus client-and-person creation;
- magic-link entry, onboarding state restoration, an honest incompatible-answer
  refusal with retained input, and compatible synthetic test setup;
- source upload, asynchronous atomisation status, reload persistence, and a
  foreign-tenant document returning the same 404 as an absent object;
- chat creation, clarification, reload, grounded generation through the actual
  agent tool loop, persisted citations, direct session links, and UI-only
  cancellation with explicit unsupported-server wording;
- content promotion, editing, immutable version history, direct post links,
  approval, scheduling, rescheduling, authoritative scheduled presentation,
  reload persistence, and logout/cookie invalidation.

Timezone unit coverage pins ordinary Europe/London conversion, spring-forward
normalisation, and the selected later fall-back occurrence. Backend scheduling,
conflict, idempotency, session, RLS, provenance, and worker behavior are also
covered by the complete backend suite.

## Regressions found and resolved during connected verification

- first-turn live streams were discarded before a session envelope existed;
- clarification resumption omitted the backend's explicit clarification field;
- a selected chat variant was not promoted before a user edit/version save;
- direct post links could resolve before asynchronous library data arrived;
- schedule submission could be duplicated and the test could navigate before
  persistence completed;
- a real schedule slot was visually overwritten by the content item's expected
  underlying `approved` state;
- Stop was unreachable during the pre-delta working phase.
- connected drafts discarded version-receipt claim offsets, leaving the
  evidence control with no real spans to reveal;
- Tailwind's explicit source set omitted `src/app/internal`, so admin-only
  responsive grid utilities were missing from the production stylesheet.

Each fix is covered by the final checks and/or the connected browser journey.

## Connected Workspace interaction recheck — 2026-09-15

The approved post-baseline interaction correction was exercised against a
task-owned, loopback-only, read-only fake engine. It returned a restored chat
with two adjacent assistant records and no draft, rejected every non-GET
request, and made no provider call. The production Next.js build was used.

- At 1,440, 1,180, 1,179, 768, 767, and 390 px, the restored session showed a
  chat transcript and composer, did not show the starter prompt, did not invent
  a draft pane, and had no horizontal overflow.
- The two adjacent assistant records appeared as one coherent visual agent turn
  with all text preserved. A screenshot was inspected at 1,440 px.
- Unit coverage pins starter-to-chat transition, clarification idle state,
  pending-user echo before the stream, truthful connected draft visibility,
  settled phase selection, and duplicate assistant suppression.
- Refined route prefetch was disabled and the data provider moved into the
  persistent `/refined` layout. Sidebar navigation no longer repeats the
  content, calendar, campaigns, clients, documents, console, onboarding, and
  profile bootstrap. After the initial Home bootstrap, a Home → Library →
  Workspace sequence produced only three expected route-level `/v1/me` checks
  and one active-session lookup: there were no repeated data-bootstrap or
  exact-session requests. Same-page session query synchronisation no longer
  adds a protected route render, and an active-session envelope is no longer
  fetched again under the id it already returned.

The recheck did not use the operator's `.env.local`, Render deployment, or
Anthropic key. It therefore verifies the UI/BFF state machine and local request
shape, not hosted latency or live-model quality.

## Evidence, transition, and admin-design recheck — 2026-09-15

- Connected draft bodies now load the matching persisted content version and
  reconstruct claim segments from its receipt. The mapping uses Unicode code
  points, preserves paragraph text, exposes real quote/source/locator detail,
  and leaves absent locator fields absent. Two focused tests include an emoji
  before the claim to catch UTF-16 offset regressions.
- **Show evidence** remains in place. It is enabled when claim links exist,
  toggles the visual lens with `aria-pressed`, and numbered claims open receipt-
  backed citation detail. A source-only response is listed honestly but does
  not pretend to provide claim-level highlighting.
- The conversation auto-follow moved out of a synchronous layout effect and is
  coalesced into the next animation frame, removing a forced layout from the
  streaming render path. Desktop draft creation now expands/fades the pane;
  compact results rise into the thread. `prefers-reduced-motion` remains the
  override.
- The admin shell was restyled without removing or renaming any module. Its
  system typography, black actions, warm neutrals, cards, and responsive 1,180
  px shell now follow the client language while remaining isolated under
  `.internal-admin`.
- `e2e/admin-design.spec.ts` passed in production Chromium at 1,440, 1,000 and
  390 px. It asserts the desktop rail width, four-column desktop metrics,
  compact tablet module rail, and zero phone document overflow. The screenshots
  were visually inspected. The first run correctly failed because the desktop
  metric grid had one column; adding the internal route to Tailwind's explicit
  source inventory fixed the production-only omission, and the unchanged test
  then passed.
- A separate browser-use production smoke check at 764 px confirmed the Sign-in
  heading/actions and zero horizontal overflow. A warmed local navigation entry
  reached `domInteractive` at about 107 ms and `loadEventEnd` at about 110 ms;
  this is a local smoke measurement, not a hosted performance promise.

Current frontend gates after these changes: `npm run check` passed (21 design
tests; 307 stack tests across 36 files), `npm run build` passed, and the focused
admin Chromium test passed. The earlier full connected-backend/browser and
backend-suite evidence remains valid for unchanged integration paths; it was
not rerun against Render or Anthropic.

### Pre-draft New post and agent-guidance refinement

- A production build was run against a loopback-only synthetic backend at 764
  px, just below the 768 px navigation breakpoint. A restored clarification
  session had no variant or draft, but exposed **New post**.
- The confirmation used conversation-specific wording. Confirming issued one
  `start_new_post` command, changed the URL from the old authoritative session
  id to the replacement id, removed the old transcript, and restored the fresh
  starter. The synthetic backend counted exactly one replacement command.
- Prompt/skill tests pin concise clarification, delegated topic choice, the
  distinction between an empty topic snapshot and the whole account, and the
  change from mandatory LinkedIn ingredients to preferences.
- Template/intent tests pin complete requests for all four starter cards and
  recognize client-question discovery, account-material discovery, and direct
  “write something” delegation. The overview now projects at most six active
  discovery candidates without source ids or labels; they select a retrieval
  subject and are explicitly non-citable.
- Account-overview unit and static boundary checks pin intent gating, output
  escaping, absence of email/internal identifiers, and use of client-token
  routes only. No service-only engine credential is reachable from the agent.
- Live Anthropic prose quality was not exercised. These checks verify prompt
  policy, context assembly, security boundaries, and UI/session behavior; the
  connected Render/Anthropic pass remains an operator test in
  `E2E-CHEAT-SHEET.md`.

## Honest limits

- Production Anthropic behavior, Voyage embeddings, Docling availability, real
  email, social publishing, hosted storage, Vercel, and a hosted backend were not
  exercised.
- Accepted unsupported operations are enumerated in `FEATURE-GAPS.md`; their
  presentation remains present and is not labelled as integrated.
- Vercel's documented 4.5 MB function request-body limit is below this UI's
  approved 20 MiB upload limit. The operator must choose the documented upload
  transport/hosting resolution before public launch.
- Preview and production still require distinct operator-provided credentials,
  origins, databases, storage, workers, and hosting. See
  `DEPLOYMENT-HANDOFF.md`.

## Isolation evidence

All implementation, generated screenshots, and handoff records are under the
ignored `local/stakeholder-integration/` boundary. The original
`Final Front End` reference and the overhaul repository were not edited. No
commit, push, PR, merge, publish, or deployment was performed.

After the suites completed, the exact task-owned PostgreSQL container
`aa-stakeholder-pg-20260914` and the isolated backend's 109 generated synthetic
raw fixture files were removed. Those disposable test artifacts are not
recoverable and contained no client material.
