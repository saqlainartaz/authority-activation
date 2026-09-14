# Design preservation contract

## Owner direction

The frontend in this repository is the approved design baseline. Integration must connect it to real services without redesigning it. Code may change to support integration; the selected visual presentation and user flow must remain intact.

This distinction matters: preserving the frontend does not mean retaining fake data or timer-based behavior. It means replacing those implementation details while maintaining the same product experience.

## Changes allowed during integration

| Allowed change | Boundary |
| --- | --- |
| API clients, authentication/session handling, query/cache adapters | Use the existing backend and repository conventions |
| Replace sample records, names, dates, statistics and source coverage | Real data may change text length and content; retain the existing composition |
| Replace local storage/IndexedDB with server persistence | Keep the same visible save, upload and source-list flows |
| Replace simulated generation with streaming | Keep the conversation, canvas and compact inline draft behavior |
| Map backend IDs and response types | Keep links and state consistent; avoid unrelated routing changes |
| Loading, retry and error states required by real operations | Compose existing primitives and keep actions in their existing locations |
| Functional bugs, accessibility defects and integration tests | Fix the defect with the smallest change that preserves the intended design |
| Remove preview-only notices once their services work | Do not claim a service works before it is connected and verified |
| Host framework adaptation | Preserve rendered output; avoid duplicating routers or conflicting theme providers |

## Changes requiring explicit owner approval

- New theme, fonts, color scheme, density, spacing system or visual redesign.
- Replacement or introduction of a component library.
- Changes to navigation destinations, information architecture or screen hierarchy.
- Moving primary actions or replacing direct controls with menus.
- Removing, hiding or substantially restructuring an approved screen or panel.
- New onboarding steps, skip/follow-up flows, or changes to answer progression.
- New permanent sections, banners, dashboards or configuration screens that are not necessary to the existing flow.
- Changing supported mobile/tablet interaction patterns to accommodate a backend implementation preference.

An implementation inconvenience is not sufficient reason to redesign. First seek an adapter or state mapping that preserves the interface. If a conflict cannot be resolved that way, document the backend fact, affected screen and smallest proposed exception for the owner.

## Screen invariants

| Area | Preserve |
| --- | --- |
| Foundation | shadcn/ui on Base UI, assistant-ui conversation, React DayPicker, Lucide |
| Typography | System sans-serif UI; serif draft prose, quotations and selected statistics |
| Themes | Approved light and charcoal dark palettes; Light/Dark/System behavior, including portals |
| Desktop navigation | Sidebar and collapse, with Settings and theme access |
| Phone navigation | Bottom navigation with active state and refined top headers |
| Home | Existing greeting, dark writing card, Today and summary composition |
| Desktop Workspace | Conversation beside draft; Keep as draft and Approve directly in the document footer |
| Compact Workspace | Full draft in the agent stream; in-place preview; actions above the composer |
| Templates | Desktop grid; phone carousel with arrows, count and next-card indication |
| Draft tools | Evidence/context and preview stay accessible; do not restore Shorter/Longer/Punchier chips |
| Library | Table/Board/Calendar, phone view selector, search/Filters arrangement and Compact rows |
| Phone Board | Status tabs and one vertical lane, not horizontally scrolling columns |
| Knowledge | One Your data list; Add files opens the drop/picker dialog; uploads join that list |
| Guidance | Active-first numbered rules, switches and restrained editing UI |
| Training questions | Dark question deck, custom alternatives, short/long writing, explicit Save answer |
| Onboarding | One packet per screen; normal single choice advances; custom/multi/text stays for Next |
| Onboarding context | Source excerpts retained behind collapsed View source context, not embedded in each option |
| Onboarding review | Editable answers followed by Open my workspace; no follow-up checkbox |
| Settings | Account, Preferences, Usage, Data; mobile section navigation |
| Entry flow | Split sign-in card on desktop, stacked phone layout, invitation setup and recovery within the entry flow |

## Implementation-sensitive files

Treat the following as design-sensitive rather than automatically rewriting them:

- `frontend/src/refined/refined.css`, `entry.css`, `knowledge.css`, `dark.css`.
- `frontend/src/styles/shadcn.css` and `frontend/src/components/ui/`.
- Layout and JSX in `Shell.tsx`, `Home.tsx`, `Workspace.tsx`, `Library.tsx`, `Training.tsx`, `Knowledge.tsx`, `Settings.tsx`, `Auth.tsx`, `Onboarding.tsx`.
- Responsive thresholds in `frontend/src/shared/frame.ts`, `frontend/src/hooks/use-mobile.ts`, and CSS media queries.

These are not immutable files: event handlers and data bindings in screen files will need work. Review their rendered layout and class changes carefully. Prefer wiring at `state.tsx`, `useWorkspace.ts`, `documents.ts` and dedicated adapters before altering presentation.

The two principal viewport thresholds are 768 px for phone navigation and 1180 px for the Workspace's two-pane layout. Backend integration should not change them.

## Definition of a design-preserving integration change

The same screen, with comparable content and viewport, retains its layout and action placement. Data comes from the backend, loading/failure states are truthful, and the existing interactions still work. Longer real content must wrap or truncate according to the existing pattern without causing overflow.

Record design-contract compliance in each integration change summary. If an owner-approved exception exists, link its approval and state exactly what changed. Do not mark the design as changed merely because fixture copy was replaced with real content.
