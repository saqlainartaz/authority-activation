# Start here: backend integration agent

## Your task

Connect the selected frontend to the existing backend in the owner's integration repository. The design is settled. Do not restart research, compare component libraries, or redesign screens. Read `DESIGN-CONTRACT.md` before changing the application.

This repository is a portable frontend baseline. The backend repository has not been supplied here, so no endpoint inventory or integration implementation has been fabricated. Discover the real services, data model and authentication flow in the destination before writing bindings.

## Read order

1. [Design contract](DESIGN-CONTRACT.md): scope and non-negotiable product behavior.
2. [Design and behavior](DESIGN-AND-BEHAVIOR.md): screens, routes, theme, responsive rules and interaction details.
3. [Integration guide](INTEGRATION.md): code map, current types, service replacement points and fixture locations.
4. [Validation](VALIDATION.md) and [export checks](EXPORT-CHECKS.json): known evidence and its limits.

## Establish the baseline

```sh
cd frontend
npm ci
npm test
npm run build
npm run dev
```

Use the development URL printed by Vite. The default route opens Home. Entry routes are `/refined/signin`, `/refined/invite` and `/refined/onboarding`. The demo sign-in password is `preview-only`. It does not provide authentication.

The initial extraction passed 19 logic tests and a standalone production build. The owner reports end-to-end browser testing complete for the design baseline. No new browser test report is included with this handoff. Connected-backend checks and any integration bug fixes belong in the destination repo.

## Discover before integrating

Inspect and record:

- Host framework, package manager, router, environment conventions and existing API client.
- Session establishment, invitations, recovery, logout and user/organization identities.
- Post and draft identity types, versions, approval statuses and conflict behavior.
- Agent request/stream transport, cancellation and result/citation schema.
- Source upload, extraction/indexing states, source access and file downloads.
- Questions, onboarding, guidance, preferences and profile persistence.
- Scheduling timezone model, approval versus scheduling, publishing queue and platform integrations.

Map existing services to the frontend operations in `INTEGRATION.md`. Record actual gaps without inventing backend capabilities. Use the backend's established contracts through adapters; do not make visual changes to compensate for a naming/type mismatch.

## Integration sequence

| Step | Work | Completion evidence |
| --- | --- | --- |
| 1 | Mount the frontend and reconcile dependencies/router/theme | Build passes; selected screens render through the host entry point |
| 2 | Connect session and account-scoped initial data | Real session restoration, correct identity, logout and isolation |
| 3 | Connect profile, settings, guidance, training and onboarding | Saves persist for the correct user; failed writes are truthful; progression unchanged |
| 4 | Connect Library and drafts | Real IDs load/update reliably, including direct post links and versions |
| 5 | Connect sources and citations | Upload/processing states are accurate; excerpts refer to actual documents |
| 6 | Connect agent streaming and draft actions | Partial output, cancellation, edits and saving work without duplicated/stale output |
| 7 | Connect approval, scheduling and publishing | Distinct statuses and timezone-correct execution; confirmed outcomes |
| 8 | Finish integration bugs and production safeguards | Destination-specific checks pass; remaining limitations documented |

Do not mark a step complete solely because its UI already exists. Do not label sources learned before the backend confirms processing. Do not show a successful save/schedule/email receipt before that operation succeeds.

## Preserve the front end while changing its internals

Use existing provider/hooks as seams. The current synchronous operations are demo implementations, not mandatory service architecture. You may introduce adapters, asynchronous state, cache invalidation and appropriate pending/error handling. The selected components, layouts and interaction patterns remain the baseline.

Keep native controls and accessibility behavior. Avoid creating a second BrowserRouter or competing theme provider. If the host is server-rendered, adapt browser-only initialization without changing the screens. Retain the `/refined` prefix during initial integration; rename routes only as an explicit, coordinated requirement.

Do not carry user browser storage from the preview into production automatically. The repository includes source fixtures, not a production data migration. Calendar dates and source counts are hardcoded examples and must become real data.

## Known implementation limitations to address there

- Sign-in, invitation acceptance, recovery and logout are frontend demonstrations.
- Data provider writes are local; files are in origin-local IndexedDB.
- Generation and rewriting are timer-driven fixtures; X output is a fixed example.
- Source counts, coverage, citation lookup and several Home/Usage values are fixed samples.
- Calendar quick dates use March 2026; schedule payloads are not authoritative timestamps.
- Post IDs are numeric and generated locally; UUID-backed services need coordinated mapping.
- Current unsaved conversation state is not a durable server conversation.
- The initial standalone build produces a large JavaScript bundle; performance work may split loading without changing UI behavior.

These limitations are enumerated with file locations in the integration guide. They are not requests to redesign the product.

## Report at handoff or in a pull request

State:

1. Which real services are now connected and the files/adapters changed.
2. Which operations still use fixtures or local storage.
3. Tests actually run and any failures or unverified paths.
4. Whether the design contract is preserved; identify any explicitly approved exception.
5. Remaining integration work, including production safeguards owned by the destination.

## Suggested initial instruction from the owner

> Read AGENTS.md and the documents it references. Integrate this frontend with the existing backend in this repository. Preserve the approved design, component libraries, responsive layouts and user flows. Start by inspecting backend contracts and mapping them to the documented frontend seams. Implement the integration and appropriate functional checks without redesigning the frontend. Ask me only if a real backend constraint requires a change to the approved visual design or flow.
