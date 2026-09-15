# Next.js migration evidence

Status: Stage 2 migration verified locally on 2026-09-14; backend services remain intentionally unconnected at this gate.

## Implemented boundary

- Framework: Next.js App Router `16.3.3`, React `19.3.0`, TypeScript `6.0.3`.
- Application root remains `frontend/`.
- Public behavior remains under `/refined`: Home, Workspace, Library, Train, sign-in, invitation, and onboarding.
- `/` and unknown `/refined/*` routes redirect to `/refined/home`.
- `post`, `welcome`, and `tab` query parameters are handled through the Next navigation adapter.
- the browser-first product mounts below a Next client-only boundary; there is one App Router, one theme provider, one data provider, one tooltip scope, and one toaster per presentation.
- existing components, CSS, assets, fixture/local-storage keys, Base UI, assistant-ui, DayPicker, and the 768px/1,180px thresholds are unchanged.

The migration removed the obsolete Vite bootstrap/configuration, React Router dependency, and Vite-only build dependencies. It did not alter screen layout or fixture business behavior.

The previous reference used Next `16.2.11`. npm audit reported that version in critical affected ranges below `16.3.3`; the stakeholder application pins patched Next `16.3.3`. The resulting dependency audit reports zero vulnerabilities.

## Automated checks

From `frontend/`:

```powershell
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
npm.cmd audit --audit-level=moderate
```

Results:

- TypeScript: passed.
- Fixture logic: 19 passed, 0 failed.
- Next production build: passed; `/` is static and `/refined/[[...slug]]` is an on-demand App Router route.
- npm audit: 0 vulnerabilities.

## Browser and visual parity

The unchanged baseline capture harness was rerun against the Next dev server with the same Chrome binary, isolated context per scenario, route, theme, viewport, fixture state, and interaction. `capture-report.json` records 50/50 captured, 0 failed, 0 console errors, and 0 page errors. Candidate PNGs are in `screenshots/`.

The comparison command was:

```powershell
node docs\baseline\compare-captures.cjs
```

`visual-comparison.json` records:

- 50 baseline and 50 candidate screenshots.
- 50 comparable dimensions; 0 missing, extra, or dimension-mismatched images.
- channel difference threshold: 16 on the 0–255 RGB scale.
- 50 exact comparisons.
- maximum and mean changed-pixel percentage: 0%.

The first comparison exposed only Next's injected development indicator at a fixed pixel count per viewport. `devIndicators: false` removes that framework-only overlay from the product surface; the complete capture was rerun after the change and produced the exact result above. `agentRules: false` also prevents Next dev from generating nested task-unrelated `AGENTS.md`/`CLAUDE.md` files; the version-matched installed migration guidance was read before making that configuration decision.

This evidence establishes stable raster parity for the captured states, not every possible input or live-service state. The fixtures and unsupported-service limitations listed in `../baseline/README.md` remain intentionally present until the corresponding Stage 4 capability is connected.
