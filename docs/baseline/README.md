# Pre-migration frontend baseline

Status: captured locally on 2026-09-14 before any application-source or dependency change.

## Pinned source and environment

- Repository revision: `ec2f05f83dd70b59cc39d3d2240fad9b291d8d17`.
- Application root: `frontend/`.
- Node: `v24.13.0`; npm: `11.6.2`.
- Stable screenshots: Chrome `152.0.7977.84`, headless, with animations disabled.
- Local origin: `http://127.0.0.1:4173` served by the unchanged Vite application.
- Browser contexts were isolated per scenario. Only the repository's synthetic fixture persona and data were used.

The product's documented minimum is Node 22.12 or newer. Node 24 was the available local runtime for this capture; migration and deployment checks must also state their actual runtime.

## Unchanged checks

From `frontend/`:

```powershell
npm.cmd ci
npm.cmd test
npm.cmd run build
npm.cmd run dev -- --host 127.0.0.1 --port 4173
```

Results:

- Locked install: 451 packages installed; npm reported 0 vulnerabilities.
- Logic tests: 19 passed, 0 failed.
- Production build: passed; Vite transformed 3,954 modules.
- Build warning: the minified application chunk was 1,011.15 kB (312.62 kB gzip), above Vite's 500 kB warning threshold.

## Browser evidence

Run from the repository root while the unchanged application is available at the baseline origin:

```powershell
node docs\baseline\capture-baseline.cjs
```

The capture script defaults to the already-installed Playwright package in the preserved `Final Front End` reference and the installed system Chrome. Override `AA_PLAYWRIGHT_MODULE`, `CHROME_PATH`, or `AA_BASE_URL` when those locations differ. It does not read an environment file.

The run captured 50 of 50 scenarios with no Playwright page errors, no browser console errors, and no measured horizontal document overflow. Exact per-scenario metadata is in `capture-report.json`; PNG evidence is in `screenshots/`.

Coverage includes:

- Home at 390, 767, 768, 1,179, 1,180, and 1,440 CSS pixels, including light and dark themes.
- Workspace empty and generated states on phone, tablet, either side of 1,180, and desktop; completed inline and two-pane drafts; scheduling dialog.
- Library Table, Board, Calendar, and post detail on phone, tablet, and desktop, including the single-lane phone Board.
- Training Questions, Knowledge, Guidance, and the Add files dialog.
- Account, Preferences, and Data settings in desktop dialog and phone drawer presentations.
- Sign-in, recovery, invitation, onboarding, collapsed/expanded source context, and ordinary single-choice auto-advance.
- Direct route entry for every public `/refined` screen represented above.

The two primary responsive transitions were also inspected interactively in the browser:

- At 767px, the desktop sidebar is absent and the bottom navigation is present.
- At 768px, the sidebar is present and the bottom navigation is absent.
- At 1,179px, a completed draft remains inside the conversation presentation.
- At 1,180px, the same completed draft moves to the separate right-hand document pane.

## Existing limitations, not migration regressions

- Authentication, invitation acceptance, recovery, logout, generation, rewriting, uploads, scheduling, usage, source coverage, and most saves are demo/local behavior.
- Application records use origin-local `localStorage`; uploaded blobs use local IndexedDB. There is no tenant or authenticated-user boundary.
- Generation is canned and timer-driven. The prompt used by the capture does not influence the returned fixture draft.
- Home, Library, schedule quick dates, usage, question/source totals, evidence, and persona values include fixed sample data, including March 2026 dates.
- Direct protected routes are accessible without a session.
- The schedule interaction produces local display state rather than an authoritative timezone-resolved backend operation.
- Local file validation and storage do not demonstrate server acceptance, processing, provenance, or authorization.
- The browser matrix verifies representative states and important interactions, not every combinatorial input or accessibility requirement.
- The standalone build has the large JavaScript chunk warning recorded above.

No stable visual defect was observed in the captured matrix. A transient stale frame appeared once immediately after an interactive theme toggle; a subsequent stable screenshot and the automated dark-theme capture rendered the expected palette, so it is not classified as an application defect.

## Migration comparison rule

Use the same fixture state, viewport, theme, route, and interaction before comparing a Next.js capture with these files. Build/type success alone is not parity evidence. Differences caused only by browser antialiasing or capture timing should be separated from layout, typography, color, action placement, responsive, and behavior regressions.
