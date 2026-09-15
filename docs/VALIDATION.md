# Validation and provenance

> This file records the initial exported baseline. Independent migration and connected-stack evidence is in [baseline/README.md](baseline/README.md), [migration/README.md](migration/README.md), and [VERIFICATION.md](VERIFICATION.md). Its earlier statement that no new browser run occurred is not the status of the completed local migration.

## Source snapshot

- Export date: 14 September 2026, Europe/Warsaw.
- Product source revision: `2a14ac7604e53c473d3c149f0416de28fc69a617`.
- Snapshot includes the unified Knowledge upload dialog, dark mode, desktop draft footer, and latest onboarding auto-advance/collapsed source context.
- The export is separate from the preview checkout. It contains no Sites manifest, source credentials or deployment dependency.

## Browser validation

The product owner stated that end-to-end browser testing has already happened. This handoff records that as owner-reported completion. No new browser session, screenshots or end-to-end run was performed during extraction, and no external test report or run ID was supplied with that statement.

Earlier recorded prototype checks covered selected browser flows; more recent implementation changes were checked with builds and focused logic tests. This record does not expand those earlier checks into a claim that every state of the latest export was independently browser-tested by this export task.

Integration bugs, connected-service behavior and production safeguards will be handled in the destination repository as requested. Existing design acceptance should be retained as the baseline there.

## Included automated checks

`npm test` runs four files:

| File | Scope |
| --- | --- |
| `onboarding.test.mjs` | Required answers, custom text, multiple selection, completion, automatic single-choice progression rules and restoration of saved data after follow-up removal |
| `questions.test.mjs` | Training answer validity, custom/multiple selections, hidden stale text and paragraph preservation |
| `conversation.test.mjs` | Draft placement and partial streaming, assistant replies, rewrites, desktop separation and saved records |
| `documents.test.mjs` | Supported extensions, invalid/empty/oversized files and duplicate identity |

These tests exercise model logic. They do not test real authentication, IndexedDB in a browser, OS file dialogs, backend uploads, model output or publishing. The Vite/TypeScript build checks the extracted dependency graph and production bundling.

The selected dark theme's primary text pairs were previously checked numerically for contrast, including foreground/background, muted text, primary button text, destructive text and citation text. That is not a claim of full accessibility certification.

The final export-build and test results are recorded in `EXPORT-CHECKS.json` in this directory.

## Extraction changes

- Replaced the multi-experiment entry point with only the selected `/refined/*` application.
- Copied the reachable source files and 25 required UI components.
- Moved the shared icon adapter from the old scaffold path to `src/components/icon-placeholder.tsx`, updating its imports.
- Removed comparison-only screen-size/art/frame helpers; actual responsive breakpoints remain 768 and 1180 px.
- Removed the obsolete Tailwind scan of the alternate shadcn implementation.
- Removed old font loaders and comparison assets; the product uses system fonts.
- Replaced preview-specific page metadata and favicon with minimal product metadata and the AA mark.
- Retained fixture data, demo behavior, local-storage names and product routes for a runnable baseline.
- Selected exact direct package versions from the source lockfile; supplied an independent dependency lock for this frontend.

## Exclusions and sensitive data

No credentials, `.openai` configuration, `.env`, browser storage snapshots, uploaded user documents, installed dependency directories or deployment archives are tracked. Git history begins with this prepared handoff; the old preview history is not imported. Source fixtures include sample persona/contact values and business copy; replace them during integration. The demo password is a literal fixture, not a secret or an authentication mechanism.

`dependencies.json` records direct package versions and the license labels reported by the source lockfile. Those labels are an inventory aid; retain the actual upstream notices and license terms when installing or redistributing dependencies. No blanket license is assigned to the product source by this export.

## GitHub preparation

Repository: `saqlainartaz/authority-activation-frontend`. The destination was empty before this upload. The preparation adds root and frontend READMEs, explicit agent instructions, the design-preservation contract, an agent handoff and a pull request template. Application source and dependency files are unchanged from the validated export apart from LF line-ending normalization for consistent Git checkouts. Documentation links, file checksums and tracked-file exclusions were checked before upload. No backend connection or new design changes were made in this step.
