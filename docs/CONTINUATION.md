# Compact continuation record

Updated: 2026-09-20, Europe/Warsaw.

## Current result

- Application root: `frontend/frontend`
- Next.js 16.3.3 migration complete; approved `/refined` routes and fixture presentation retained.
- Client-facing BFF, TypeScript marketing-copy agent, and `/internal` admin retained from `Final Front End` revision `8c790eba6920a3397d64486bd5162815f28ef96c`.
- Compatible previous-stack verification checkout pinned at `6a7429f9779537a777c99e89ac6d4b5da2bdc736`. The deployment port is isolated in `backend-main-port`: pushed commit `12d857299a108ece3324467018a529aac0249369` on `fix/stakeholder-flexible-agent-intent`, plus local uncommitted browser-receipt and disposable-harness changes. It is not merged or deployed.
- Supported capability wiring and accepted gaps are recorded in `CAPABILITY-MAP.md` and `FEATURE-GAPS.md`.
- Vercel/backend operator requirements are in `DEPLOYMENT-HANDOFF.md`.
- The operator-facing connected test sequence is in `E2E-CHEAT-SHEET.md`.
- The approved Workspace correction is implemented: the starter disappears on first send, clarification stays in a streaming chat, and the draft surface appears only after an authoritative draft exists. New post works during pre-draft clarification through the backend's `start_new_post` command. All four template cards now populate complete natural discovery requests instead of label fragments. Agent guidance is concise, accepts delegated topic selection, uses a small non-citable client-authenticated candidate projection to choose a specific retrieval subject, and can answer identity/data questions from the same narrow overview. The `/refined` shell persists across sidebar transitions and speculative protected-route prefetch is disabled.
- Generation no longer depends on documentary-specific or `about ...` phrase rewriting. Every TypeScript-agent preparation now carries the client's unchanged request, an explicit non-evidentiary subject, and a standalone semantic retrieval query. The compatible Python backend uses the query only to select tenant-scoped material, uses the subject only for readiness, and persists the original request. Legacy callers remain accepted. Provenance and draft verification still prevent a nearby but unsupported passage from becoming a draft fact.
- Connected evidence now comes from the verified temporary chat-variant receipt before save and the matching persisted version receipt after promotion. The browser receives claim spans immediately, while the TypeScript model/runtime remains unable to read receipts or locators. Unicode-safe spans drive the retained Show evidence control and citation popovers. The chat-to-draft reveal is animated at both layout modes, reduced-motion is honored, and conversation auto-follow is frame-coalesced instead of forcing synchronous layout on streamed updates.
- The admin workflows remain intact, while the shell now follows the approved client visual language. It uses a 238 px desktop rail and a compact horizontal module rail below 1,180 px. A production Chromium test and visually inspected screenshots cover 1,440, 1,000, and 390 px; it also pins the Tailwind admin source inventory so responsive utilities cannot silently disappear from a production build.
- Onboarding now consumes the backend-owned `business-dna/1.0.0` catalogue and
  persists exact question/version/answer pairs. Business DNA is available as a
  minimal sidebar profile, Train Your AI Questions reviews real provisional
  atoms, and the TypeScript agent receives a bounded non-citable client brief.
- The final clean connected run passed against the isolated previous backend
  with true `engine_app`/`engine_worker` role separation. A session-restoration
  race found by that run is fixed: send waits for the authoritative active-
  session read and retains the user's text.

## Important operational facts

- The isolated backend compatibility branch and commit above were pushed for review in an earlier authorized step. No later receipt/harness change was committed or pushed; no PR, merge, deployment, real email, or social publication was performed. The two inherited live-smoke calls made by the final backend suite are recorded below.
- The root overhaul, its databases/services/plans/progress, and preserved `Final Front End` reference were not modified.
- Verification used disposable synthetic data, fake Python providers, and a server-only deterministic TypeScript driver. Production remains the Anthropic driver unless the test flag is explicitly set.
- The 2026-09-15 Workspace rechecks used separate loopback-only synthetic engines; they did not read `.env.local`, contact Render, or call Anthropic. The latest recheck performed only the supported synthetic `start_new_post` write and counted it exactly once.
- The 2026-09-20 recheck passed the full frontend gate (21 design tests and 315 stack tests across 36 files), a Next.js 16.3.3 production build, and the complete connected Playwright journey in 26.9 seconds. The browser run verified direct flexible drafting, claim-level evidence before save and after reload, edit/version persistence, scheduling/rescheduling, cross-tenant denial, deterministic client-side Stop behavior, and logout. The deployment-port affected backend set passed 61 tests, and its clean broad regression selection completed with 2,745 passed and 2 skipped across 2,747 collected tests. The broad run excluded only the documented non-terminating `test_unban.py` and hard-coded-ambient-database `test_worker_operational_guards.py`. Its inherited database harness now requires explicit loopback-only disposable URLs. No `.env.local` content was inspected or printed; Next.js loaded it as the configured build environment. Render was not contacted. The backend process inherited an Anthropic key, so its two explicitly live smoke tests ran before that was identified; the key was not read or printed, and the connected application journey itself remained deterministic and keyless. This is recorded as a verification incident, not as live-agent validation.
- The exact task-owned PostgreSQL container and anonymous volume were removed after verification, and no task service or database remains. The 109 synthetic raw fixture files and two extracted Playwright trace directories remain as ignored task-owned files because the environment safety layer refused recursive deletion after their exact paths were validated; they contain no client material.
- Vercel's 4.5 MB function request-body limit is smaller than the approved 20 MiB upload UI; the operator must choose the documented transport/hosting resolution before a public Vercel launch.
- Latest goal verification: 22 design tests, 350 stack tests across 42 files,
  envless Next production build, 162 affected backend tests, one complete
  connected browser journey, and six connected breakpoint checks all passed.
  The disposable service used loopback port 55443 and fake/deterministic
  providers. No action in this goal was committed, pushed, merged or deployed.
  One source-tree build attempt was stopped when Next reported automatically
  loading `.env.local`; no value was inspected or printed. The authoritative
  production build passed in the zero-env-file mirror.
  The exact labelled 55443 disposable container/volume and task-owned Next/
  backend processes were removed after evidence capture.

## If work resumes

1. Read this file, `ARCHITECTURE.md`, `VERIFICATION.md`, and `FEATURE-GAPS.md`.
2. Check both stakeholder worktrees before editing; do not use the root overhaul as a backend.
3. Recreate a uniquely named disposable database on a non-default loopback port, then use `LOCAL-SETUP.md`.
4. Re-run `npm run check`, `npm run build`, and the connected Playwright test with a freshly seeded synthetic tenant.
5. Treat documented gaps as accepted unless the operator explicitly authorizes the required product/backend change.
