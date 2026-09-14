# Authority Activation frontend

The approved frontend for Authority Activation, ready to connect to the existing backend. This repository contains the selected design and runnable code, not the earlier design experiments.

**Integration must preserve the approved frontend design and user flow.** Replace demo data and handlers with real services; keep the layout, typography, themes, component libraries, responsive behavior and action placement. See the [design contract](docs/DESIGN-CONTRACT.md) for the exact boundary.

## For the integration agent

Start with [AGENTS.md](AGENTS.md), then [the agent handoff](docs/AGENT-HANDOFF.md). The handoff includes an integration sequence, backend discovery checklist, known demo limitations and a ready-to-use instruction for the next agent.

| Document | What it explains |
| --- | --- |
| [Agent instructions](AGENTS.md) | Repository-wide working rules |
| [Agent handoff](docs/AGENT-HANDOFF.md) | How to start and what completion means |
| [Design contract](docs/DESIGN-CONTRACT.md) | What must remain unchanged and which integration changes are allowed |
| [Design and behavior](docs/DESIGN-AND-BEHAVIOR.md) | Screens, routes, interactions, typography, themes and responsive rules |
| [Integration guide](docs/INTEGRATION.md) | Architecture, code map, data shapes and exact backend replacement points |
| [Validation](docs/VALIDATION.md) | Tested scope, source provenance and known limits |
| [Export check results](docs/EXPORT-CHECKS.json) | Recorded build and logic-test results |
| [Frontend README](frontend/README.md) | Application setup and embedding notes |

## Run locally

```sh
git clone https://github.com/saqlainartaz/authority-activation-frontend.git
cd authority-activation-frontend/frontend
npm ci
npm run dev
```

Use Node 22.12 or newer. Open the development URL printed by Vite. The default route is `/refined/home`.

```sh
npm test
npm run build
```

The entry flow is at `/refined/signin`; the demo sign-in password is `preview-only`. This is fixture behavior, not authentication. Other key routes are `/refined/invite`, `/refined/onboarding`, `/refined/workspace`, `/refined/library`, and `/refined/train?tab=knowledge`.

## Included product

- Home with the writing entry point, scheduled activity and summary.
- Workspace with assistant conversation, draft editing, source evidence and preview.
- Direct desktop Keep as draft / Approve controls; full draft inside the compact conversation.
- Library table, board and calendar with responsive controls.
- Train your AI: questions, guidance and one Your data source list.
- Add files dialog with file picker and desktop drag-and-drop.
- Account, Preferences, Usage and Data settings.
- Sign-in, invitation setup and onboarding with review.
- Light, Dark and System appearance.

The selected stack is React/TypeScript, shadcn/ui on Base UI, assistant-ui, React DayPicker, Lucide and Tailwind. The interface uses system fonts; the writing surface uses the selected serif fallback stack.

## Repository structure

```text
AGENTS.md                 Instructions for the next agent
frontend/
  src/refined/            Product screens, state and theme
  src/components/ui/      25 required UI components
  src/components/         Shared icon adapter
  src/shared/             Fixtures and responsive hooks
  src/styles/             Shared design tokens and Tailwind
  public/                 AA favicon
  scripts/                Four logic-test files
  package.json            Application commands and exact direct dependencies
  package-lock.json       Reproducible dependency installation
docs/                     Design, integration and validation documentation
MANIFEST.sha256           Handoff file checksums
```

There are no alternate design implementations, Sites hosting files, credentials, installed dependencies, browser data or build artifacts in the tracked handoff. The code does not depend on the hosted preview or on Codex.

## Current state and ownership

The standalone export passed its production build and all **19 logic tests**. The owner reports end-to-end browser testing complete for the design baseline; the validation document distinguishes that from the export task's recorded checks.

Authentication, agent generation, source processing, shared persistence, scheduling and publishing are still demo/local behaviors. The destination backend repository owns integration, integration bugs, connected-service verification and production safeguards. The integration guide identifies every major replacement point, including fixed dates and sample source counts.

Copy `frontend/` into the backend repository, or integrate this checkout using that repository's existing structure. Carry `AGENTS.md` and `docs/` with it so the design constraints accompany the code. Do not overwrite conflicting destination instructions; merge the applicable rules with the owner's direction taking precedence.

## Updating this baseline

Use the supplied pull request template to state connected behavior, design-contract compliance, actual validation and remaining demo operations. Document any owner-approved design exception. `MANIFEST.sha256` records the handoff snapshot; regenerate it if updating the delivered baseline, rather than treating it as a runtime dependency.
