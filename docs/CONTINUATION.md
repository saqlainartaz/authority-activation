# Compact continuation record

Updated: 2026-09-15, Europe/Warsaw.

## Current result

- Application root: `frontend/frontend`
- Next.js 16.3.3 migration complete; approved `/refined` routes and fixture presentation retained.
- Client-facing BFF, TypeScript marketing-copy agent, and `/internal` admin retained from `Final Front End` revision `8c790eba6920a3397d64486bd5162815f28ef96c`.
- Compatible Python stack pinned at `6a7429f9779537a777c99e89ac6d4b5da2bdc736` in a separate detached checkout.
- Supported capability wiring and accepted gaps are recorded in `CAPABILITY-MAP.md` and `FEATURE-GAPS.md`.
- Vercel/backend operator requirements are in `DEPLOYMENT-HANDOFF.md`.
- The operator-facing connected test sequence is in `E2E-CHEAT-SHEET.md`.
- The approved Workspace correction is implemented: the starter disappears on first send, clarification stays in a streaming chat, and the draft surface appears only after an authoritative draft exists. New post works during pre-draft clarification through the backend's `start_new_post` command. All four template cards now populate complete natural discovery requests instead of label fragments. Agent guidance is concise, accepts delegated topic selection, uses a small non-citable client-authenticated candidate projection to choose a specific retrieval subject, and can answer identity/data questions from the same narrow overview. The `/refined` shell persists across sidebar transitions and speculative protected-route prefetch is disabled.
- Connected evidence now comes from the matching persisted version receipt; Unicode-safe claim spans drive the retained Show evidence control and citation popovers. The chat-to-draft reveal is animated at both layout modes, reduced-motion is honored, and conversation auto-follow is frame-coalesced instead of forcing synchronous layout on streamed updates.
- The admin workflows remain intact, while the shell now follows the approved client visual language. It uses a 238 px desktop rail and a compact horizontal module rail below 1,180 px. A production Chromium test and visually inspected screenshots cover 1,440, 1,000, and 390 px; it also pins the Tailwind admin source inventory so responsive utilities cannot silently disappear from a production build.

## Important operational facts

- No commit, push, PR, merge, deployment, live provider call, real email, or social publication was performed.
- The root overhaul, its databases/services/plans/progress, and preserved `Final Front End` reference were not modified.
- Verification used disposable synthetic data, fake Python providers, and a server-only deterministic TypeScript driver. Production remains the Anthropic driver unless the test flag is explicitly set.
- The 2026-09-15 Workspace rechecks used separate loopback-only synthetic engines; they did not read `.env.local`, contact Render, or call Anthropic. The latest recheck performed only the supported synthetic `start_new_post` write and counted it exactly once.
- The exact task-owned PostgreSQL container and 109 synthetic raw fixture files were removed after verification; no test service or test data was retained.
- Vercel's 4.5 MB function request-body limit is smaller than the approved 20 MiB upload UI; the operator must choose the documented transport/hosting resolution before a public Vercel launch.

## If work resumes

1. Read this file, `ARCHITECTURE.md`, `VERIFICATION.md`, and `FEATURE-GAPS.md`.
2. Check both stakeholder worktrees before editing; do not use the root overhaul as a backend.
3. Recreate a uniquely named disposable database on a non-default loopback port, then use `LOCAL-SETUP.md`.
4. Re-run `npm run check`, `npm run build`, and the connected Playwright test with a freshly seeded synthetic tenant.
5. Treat documented gaps as accepted unless the operator explicitly authorizes the required product/backend change.
