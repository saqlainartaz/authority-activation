# Verification record

Verified locally on 2026-09-14 and rechecked through 2026-09-22 (Europe/Warsaw). Nothing in this record is a
deployment or live-provider claim.

## Promo Partner connected recheck — 2026-09-22

- Starting frontend state: `main` at `d2ad713ddfb2c31e696367e76ddfb8b5e7af4944`; backend state: `feat/rehaul-c1c-document-lane` at `e419058` with pre-existing work preserved. No commit, push, PR, merge or deployment was made.
- `ALLOW_MISSING_ENGINE_FIXTURES=1 npm run check` passed after the approved Workspace selector refinement: 22 design tests and 360 Vitest tests across 45 files, TypeScript, and all BFF/agent/static policy gates. The selector defaults new sessions to LinkedIn, uses the approved compact expanding treatment, and no longer contains the temporary A/B/C/D review harness. Standalone schema gates explicitly used their documented no-sibling mode.
- `npm run build` passed with Next.js 16.3.3, including the new post-media upload/download routes.
- `e2e/promo-partner-connected.spec.ts` passed again after the preview refinement (1 test in 1.4 minutes) against the local Next development server, local Python service, deterministic TypeScript driver and isolated PostgreSQL database. It covered distinct LinkedIn/Instagram/X/Facebook drafts and multi-channel reload, media attach/preview/replace/remove/download, presentation-only preview controls, exact history, approval invalidation, schedule/Home/Library projection, Settings removals, and Home overflow/screenshots at 390, 767, 768, 1,179, 1,180 and 1,440 px in light and dark.
- The affected Python gate passed Ruff and 92 tests. Migration 0111's upgrade/downgrade/re-upgrade neutrality proof passed with 38 schema records at head and retained-data downgrade protection separately covered by tests.
- Test data was synthetic. Anthropic and Voyage were explicitly blank, dotenv loading was disabled, and no live/paid provider, external publishing or private client source was used.
- The labelled loopback PostgreSQL container `insidesuccess-promo-partner-pg-20260922`, volume `insidesuccess-promo-partner-pgdata-20260922`, port `55443`, and browser database `promo_partner_browser_20260922` are deliberately preserved for handoff as authorized.
- The browser account was pre-completed through the backend's retained onboarding write contract because this backend checkout's onboarding read does not expose the newer frontend questionnaire catalogue. That compatibility gap predates and is outside the Promo Partner scope; the connected journey from authenticated Home onward used real BFF/Python/database operations.
- Deterministic drafts validate closed-channel routing, skills, state and provenance only. Live writing quality remains unverified and requires separate provider/budget authorization.

## Pinned inputs

- Approved stakeholder frontend initial revision:
  `ec2f05f83dd70b59cc39d3d2240fad9b291d8d17`
- Retained Next.js BFF, admin, authentication, and TypeScript-agent reference:
  `8c790eba6920a3397d64486bd5162815f28ef96c`
- Compatible isolated Python backend:
  `6a7429f9779537a777c99e89ac6d4b5da2bdc736`
- Deployment-port base and structured-intent commit:
  `04e9e9a5080f00ea8b2284d6a30bda36a82ecd43` +
  `12d857299a108ece3324467018a529aac0249369`; the completed compatibility work
  is merged as `66a7ab6f34a57b0f831d56b706d210abd8eb6f1e` through backend PR #32.

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

### Clean frontend PR-branch recheck — 2026-09-21

- The isolated checkout was created from `authority-activation/main` at
  `ef827e32ee452fd6e242bf64df809e7849fa5843`; no `.env*` file was present or
  read. `npm ci` completed with zero reported vulnerabilities.
- `ALLOW_MISSING_ENGINE_FIXTURES=1 npm run check` passed: 22 design tests, 354
  Vitest tests across 43 files, TypeScript, and all agent/BFF/static gates.
  The two cross-repository schema comparisons explicitly used their documented
  standalone mode because the clean frontend worktree has no sibling backend;
  their full comparison remains covered by the earlier connected verification.
- `npm run build` passed with Next.js 16.3.3, producing 23 static pages and all
  listed dynamic BFF routes.
- Nineteen isolated Playwright checks passed against a loopback-only synthetic
  `/v1/me` identity service: Business DNA (7 tests), Train Your AI (3 tests),
  and onboarding (9 tests, including the responsive matrix at 390, 767, 768,
  1,179, 1,180, and 1,440 px). Browser API responses were deterministic
  fixtures; no backend
  data, retained database, Render service, or provider was contacted.
- The first browser attempt correctly failed at sign-in because browser route
  interception cannot satisfy the Next proxy's server-side identity check. The
  successful run supplied that missing server-side identity fixture; no product
  authentication bypass or retry was added.
- This recheck packages the application implementation commit `9f5b26a` for
  an explicitly authorized frontend PR. It does not authorize or claim a merge
  or deployment.

### Business DNA/onboarding completion recheck — 2026-09-20

- Envless frontend mirror:
  `C:/Users/saqla/AppData/Local/Temp/authority-aa-envless-20260920`;
  zero `.env*` files were present before verification.
- Production-application diff SHA-256 (`frontend/src`, package manifests and
  Next config): `083c7fbb2306785e2c9cbf6724c7b1ff25d2c400f0f3736b6f22eae93e507e5b`.
  The production session-boundary file has identical source/mirror UTC write
  time `2026-09-20T19:43:40.2642528Z`; later source-only changes were tests,
  screenshots and documentation.
- `npm run check`: passed — 22 design tests and 350 Vitest tests across
  42 files, plus TypeScript and all agent/BFF/schema/static gates.
- `npm run build`: passed in the envless mirror with Next.js 16.3.3; 23 static
  pages and all listed dynamic BFF routes compiled.
- One attempted source-checkout build announced that Next had automatically
  loaded `.env.local`; it was stopped immediately. No value was printed or
  inspected, and that run is not completion evidence. The passing build above
  was performed only after confirming the mirror contained zero `.env*` files.
- Affected backend gate: 162 tests passed; Ruff passed; Import Linter kept all
  8 contracts.
- Connected Playwright journey: 1 passed in 1.1 minutes against fake Python
  providers, the deterministic TypeScript driver, and disposable database
  `aa_stakeholder_e2e_onboarding_20260920` on loopback port 55443. The serving
  API used `engine_app`, the worker used `engine_worker`, and only migrations
  used the admin role, so the foreign-tenant document assertion exercised RLS
  and returned 404.
- Connected responsive matrix: 6 passed at 390, 767, 768, 1,179, 1,180 and
  1,440 px; dark at 390/1,179 and light elsewhere. Screenshots are under
  `docs/integration/screenshots/business-dna-connected-*` and were visually
  inspected for overflow, action placement and breakpoint continuity.
- The journey covered the nine-question onboarding, optional/custom choices,
  Business DNA edit/cancel/failure retention/reload, real provisional-atom
  decisions and replay, client-brief identity answer, source async state,
  cross-tenant denial, streaming/evidence, new-session restoration, draft
  versions, scheduling/rescheduling, cancellation wording and logout.
- During verification, an immediate send after a workspace reload reproduced a
  real race between active-session restoration and session creation. The
  composer now distinguishes “not restored yet” from “confirmed no active
  session,” preserves the prompt, disables send for that brief window, and is
  pinned by unit plus the connected journey.
- No paid/live provider, Render service, email, publication, deployment,
  commit, push, PR or merge was used for this goal.
- After evidence capture, the exact labelled disposable container
  `authority-aa-onboarding-pg-20260920` and volume
  `authority-aa-onboarding-pgdata-20260920` were removed. Their synthetic test
  data is not recoverable; no task-owned server remains listening on ports
  55443, 8001 or 3100.

Run from `frontend/frontend`:

- Earlier retained gate: `npm run check` passed.
  - design tests: 21 passed
  - stack unit/integration tests: 315 passed across 36 files
  - TypeScript and all agent/BFF/schema/static boundary checks passed
- `npm run build`: passed with Next.js 16.3.3; all App Router pages and route
  handlers compiled and page generation completed.
- Connected production-build Playwright journey: 1 passed in 26.9 seconds.

Run from the isolated backend with `.env` loading disabled and explicit
task-owned database URLs on loopback port 55432:

- full `pytest`: 1,522 passed, 4 skipped in 420.40 seconds
- Ruff: passed
- Import Linter: 5 contracts kept, 0 broken (101 files / 303 dependencies)

The four backend skips are optional Docling/live-provider checks. Anthropic and
Voyage keys were blank; no paid or live-provider call was made.

The deployment-port checkout was then rechecked on 2026-09-20 against a newly
created, labelled PostgreSQL container bound only to loopback port 55444. The
clean regression selection completed at 100% with exit code 0: 2,745 passed and
2 skipped across 2,747 collected tests. `tests/test_unban.py` was excluded because its
assertions complete but its inherited process does not terminate, and
`tests/test_worker_operational_guards.py` was excluded because it hard-codes an
ambient `localhost:5432` database. The migration-neutrality maintenance URL and
all three application-role URLs were explicitly pinned to the disposable
container. The affected chat/context set also passed 61 tests and Ruff. Render
was not contacted. A presence-only environment check after the run established
that the process inherited an Anthropic key, so the inherited suite's two tests
explicitly marked as live Anthropic smoke tests ran and passed; the Voyage and
Docling checks were the two skips. The key was neither read nor printed, and the
connected application journey itself remained deterministic and keyless. The
live calls were outside the intended keyless verification profile and are
recorded here as a verification incident, not as production-agent validation.

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
- chat creation, delegated grounded generation through the actual agent tool
  loop, browser-only temporary-variant claim receipts, evidence availability
  before save and after reload, persisted citations, direct session links, and
  deterministic UI-only cancellation with explicit unsupported-server wording;
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
- connected drafts exposed only source labels until promotion, leaving the
  pre-save evidence control with no real spans to reveal; the browser session
  now receives an allowlisted temporary receipt while runtime/model responses
  continue to exclude receipts and locators;
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
tests; 315 stack tests across 36 files), `npm run build` passed, and the focused
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

### Flexible agent retrieval refinement — 2026-09-19

- Root cause: the TypeScript agent previously had to encode intent inside one
  prose `message`, while the compatible backend could resolve a subject from
  only a few phrase shapes. A documentary-specific normalizer improved one
  example but retained the same brittle coupling.
- `prepare_generation` now requires three distinct values: the client's
  meaning-preserving request, a subject/selection target, and a standalone
  semantic retrieval query assembled from the conversation. This single
  contract covers named or unnamed sources, delegated topic choice, recurring
  client questions, concrete topics, revisions, and resumed clarification.
- The Python context endpoint accepts the two new values optionally for rolling
  compatibility. The retrieval query drives the existing tenant-scoped hybrid
  retrieval; the subject drives readiness only. Neither is inserted into facts,
  evidence, references, citations, or provenance, and the immutable snapshot
  records the canonical writing task rather than the search query.
- Agent instructions permit one meaningfully different re-retrieval when the
  first material is mismatched, prohibit equivalent query loops, and retain the
  hard `answer_needed` and verified-draft boundaries. An empty result remains a
  statement about that query, not the whole account.
- Test-first frontend runs failed on the missing fields, rewritten request, and
  deterministic-driver payload before implementation. After the change,
  `npm run check` passed (21 design tests and 315 stack tests across 36 files)
  and the Next.js 16.3.3 production build completed successfully.
- The affected backend set passed 61 tests. It includes varied phrase-agnostic
  subject cases, proof that subject intent never replaces evidence, proof that
  the retrieval query selects context without replacing the persisted task,
  legacy answer-needed behavior, idempotency conflict detection when structured
  intent changes under a reused key, proof that semantic query wording cannot
  bypass canonical-task conflict filtering, and the real FastAPI context endpoint against
  a migrated loopback-only disposable PostgreSQL container. That container was
  removed after the run.
- No `.env.local` content was inspected or printed; the ordinary Next.js build
  did load it as its configured environment source. Render was not contacted.
  The later broad backend run did execute the two inherited Anthropic live-smoke
  tests described above; this does not validate live agent decision quality or
  hosted retrieval latency, which remain for the operator's documented demo
  smoke test.

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
`Final Front End` reference and the overhaul repository were not edited. The
backend compatibility work was merged by the operator through PR #32. The
frontend work is isolated on its own delivery branch for the authorized pull
request; it remains unmerged, unpublished, and undeployed.

After the suites completed, the exact task-owned PostgreSQL container
`aa-stakeholder-pg-20260914` and the isolated backend's 109 generated synthetic
raw fixture files were removed. Those disposable test artifacts are not
recoverable and contained no client material.

For the 2026-09-20 recheck, the exact labelled container
`aa-stakeholder-flex-e2e-pg-20260920` and its anonymous data volume were removed;
ports 8001, 3102, and 55444 were no longer listening. The latest 109 synthetic
raw fixtures and two locally extracted Playwright trace directories remain only
as ignored task-owned files because the environment safety layer refused their
recursive deletion after exact-path validation. They contain no client material
and are not services or databases.
