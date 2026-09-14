# Integration guide

## 1. What is being handed over

Authority Activation is a React and TypeScript frontend for writing source-informed social posts. The selected implementation uses shadcn/ui components built on Base UI, assistant-ui for the conversation, and React DayPicker for calendars. It includes Home, Workspace, Library, Train your AI, Settings, sign-in, invitation setup and onboarding.

The export preserves the selected screen code and behavior. The extraction replaces the comparison application's entry point with a small standalone router, removes unused libraries and comparison-only utilities, relocates the icon helper, and supplies a minimal build configuration. It does not introduce a backend or redesign the product.

The backend repository is the correct place to own integration, subsequent bug fixes and production safeguards. Its existing API contracts should drive the connection work. The mappings below describe what the frontend needs; they are not claims that any particular endpoint already exists.

## 2. Running and placing the frontend

`frontend/` is an independent Vite application with exact direct dependency versions and a package lock. It needs a browser runtime and Node 22.12 or newer for development/builds.

```sh
npm ci
npm test
npm run build
npm run dev
```

The build outputs `dist/`. There is no environment file or required secret in the export. Configure the destination project's API origin, proxy, authentication and environment handling using that project's conventions. Do not put private service credentials into frontend environment variables.

### Option A: keep it as a separate frontend app

Copy `frontend/` to a directory such as `apps/web/`, retain its package/build configuration, then add it to the destination monorepo's workspace setup if applicable. This is the least disruptive starting point when the backend is a separate service. Set the development proxy or API client base URL in that repository.

### Option B: merge into an existing React frontend

Copy the `src/refined`, required `src/components`, `src/hooks`, `src/shared`, and `src/styles` directories. Reconcile the dependency versions and lockfile with the host project rather than overwriting them. Keep a single React instance and a single browser router. Do not overwrite the host's similarly named UI components without checking their APIs: these are Base UI-backed components, and they are not interchangeable with every Radix-backed shadcn installation.

Mount the product under the current path while integrating:

```tsx
// Inside the existing BrowserRouter:
<Route path="/refined/*" element={<Refined />} />
```

The exported `src/main.tsx` is a standalone bootstrap example; do not mount its extra `BrowserRouter` inside a host router. The `@/*` alias must resolve to the exported source root. If the host already uses that alias differently, relocate imports deliberately or give this app its own package boundary.

Keep `/refined` initially. Navigation strings, entry detection and query handling currently assume that prefix. Renaming it requires updating `main.tsx`, the route parsing in `refined/index.tsx`, and links/navigation in the screens together. The server must return the frontend entry document for direct requests to SPA routes, while keeping backend API routes outside that fallback.

This code is browser-first: storage, `window`, media queries and IndexedDB are used directly. If the destination framework renders on the server, mount this subtree in its supported client-only boundary or adapt initialization for server rendering. Do not assume it is currently SSR-safe.

## 3. Code map

| File under `src/refined/` | Responsibility / integration boundary |
| --- | --- |
| `index.tsx` | Providers, route selection, Settings visibility, question count, toast theme |
| `Shell.tsx` | Desktop sidebar, collapse, mobile bottom navigation, appearance toggle |
| `Home.tsx` | Greeting, workspace entry, today's scheduled posts, sample statistics |
| `Workspace.tsx` | Draft canvas, compact inline draft, preview, evidence, composer, actions and scheduling UI |
| `useWorkspace.ts` | Demo writing state machine, draft/rewrite timers, save and approval handlers |
| `AgentThread.tsx` | assistant-ui external-store runtime and message presentation |
| `conversation.ts` | Converts state into messages and places the compact draft in the conversation |
| `Library.tsx` | Post views, filtering, post preview and schedule confirmation |
| `Schedule.tsx` | Date/time selection and approval without a date |
| `Training.tsx` | Questions, guidance editing and Knowledge tab |
| `questions.ts` | Typed training questions and answer validation |
| `Knowledge.tsx` | Unified source list, upload dialog, file details and local actions |
| `documents.ts` | File checks, duplicate key, IndexedDB reads/writes/deletion |
| `Settings.tsx` | Account, Preferences, Usage and Data sections |
| `state.tsx` | Local data provider and mutations; primary persistence replacement point |
| `Auth.tsx` | Demo sign-in, invitation password setup and recovery receipt |
| `Onboarding.tsx` | Question navigation, source context, custom answers and review |
| `setup-packets.ts` | Onboarding packet types, answers, completion, auto-advance and saved-data restoration |
| `Theme.tsx` | Light/Dark/System preference and root dark class |
| `refined.css`, `entry.css`, `knowledge.css`, `dark.css` | Product styling; see the design specification |

`src/shared/data.ts` contains fixture posts, text, citations, templates, user identity and UI copy. `src/shared/frame.ts` contains only the layout hooks needed by this product. `src/hooks/use-mobile.ts` is the sidebar component's own hook; keep its breakpoint aligned with the product hook.

## 4. Replace local persistence first

`DataProvider` currently seeds the product with sample data, restores it from local storage, and exposes synchronous mutations. Its key is `authority-refined-local-v1`. Stored data includes posts, training answers, onboarding, guidance rules, writing preferences, timezone and profile.

The following UI-facing operations already exist:

| Current operation | Destination responsibility |
| --- | --- |
| `savePost(post)` | Create/update a draft or post and return its authoritative identity and version |
| `answer(id, values)` | Save a training answer and refresh pending questions |
| `setRule(rule)` | Create/update a guidance rule and enabled state |
| `setPreference(index, checked)` | Save named writing/learning preferences |
| `setTimeZone(zone)` | Persist the user's scheduling timezone |
| `setProfile(profile)` | Save account/display profile |
| `setSetupAnswer(id, answer)` | Save onboarding progress |
| `completeSetup()` | Validate completion on the server and finish onboarding |
| `exportData()` | Export the user's authorized data using the backend's actual export policy |

Use the destination repository's existing API client/query layer. Convert successful local mutations to confirmed server operations or controlled optimistic updates with rollback. Add pending, failure, retry and conflict states where real network operations require them. A toast must not claim a save succeeded before it has been accepted.

The current provider has no user or organization scoping. Replace that before supporting multiple accounts. Browser fixture storage is not a migration source by default; do not silently upload locally stored examples or documents to an account.

### Current shapes

```ts
type Channel = 'li' | 'x';
type Status = 'draft' | 'approved' | 'scheduled';
type SetupAnswer = { selected: string[]; text: string };
type Rule = { id: string; text: string; enabled: boolean };
// Post includes numeric id, channel, name, snippet, status and display dates.
// SavedPost adds body, optional ISO date and optional structured Version.
```

Treat these as UI types. Map backend IDs explicitly: post IDs currently use numbers and `Date.now()`, and Workspace looks up a post using `Number(queryParam)`. A backend using UUIDs requires updating those comparisons/types together.

Preferences are currently an ordered boolean array: source-only writing, learning from edits, and learning from rejected output. Map them to stable named backend fields, not undocumented positional fields.

## 5. Authentication and onboarding

`Auth.tsx` currently validates the shape of an email, accepts the literal demo sign-in password `preview-only`, and navigates after a timer. Invitation mode accepts a password of at least eight characters for demonstration. It does not send or store passwords. Recovery only renders a receipt; it sends no email. Settings Log out navigates to sign-in while retaining local records.

Replace those handlers with the existing authentication system. Load the invitation email from a verified invitation token, restore the session on application entry, enforce authorization on the backend, and use real session invalidation on logout. Direct product routes currently remain accessible with no route guard.

Onboarding packets are seeded in `setup-packets.ts`: audience, onboarding timing, services, a short definition and a company description. Each answer is saved on change. Completion requires every packet. There is no Skip control or follow-up checkbox. The removed follow-up flags are discarded during local restoration while existing answers are retained.

For server-provided questions, preserve stable IDs and the distinctions between single selection, multiple selection, short text and long text. `pick_source` behaves as a single-choice question whose supporting context is available on demand. Single-choice answers advance immediately; custom choices and multiple-selection/text questions require Next. Editing a single-choice answer from review returns directly to review.

The final action enters `/refined/workspace?welcome=1`; the initial assistant welcome uses the saved company answer. That parameter is a prototype handoff, not a durable server event. Decide how the real system records and displays first-run completion to avoid repeating a welcome on refresh.

## 6. Connect generation without replacing the conversation UI

The demo state machine is `empty → reading → streaming → record`. Rewrites also use a `typing` state. `useWorkspace.ts` generates fixed FULL/SHORT content with timers; requests mentioning shorter/punchier/longer select a fixture. Other requests receive a demo explanation.

Replace timers and fixture selection with the real agent's transport. Retain `AgentThread.tsx` and `conversation.ts` as presentation boundaries where practical. Adapt the server stream into stable message IDs, text, draft output, citations, tool/status events and completion/error state. Cancellation should cancel the backend request as well as stop UI updates. Reconnect/retry must not duplicate a post or replay stale chunks into a newer draft.

The structured draft has paragraphs with segments, optional citation references, and optional unsupported-paragraph flags. The evidence lens and preview depend on this structure. `CITES` is currently a separate static dictionary keyed by citation number; replace it with citations returned for the actual draft, including source identity, excerpt and location. Do not lose the association between a highlighted claim and its supporting document during streaming or edits.

Desktop presents conversation and a document pane. Compact layouts insert the draft into the agent stream. Keep these as two presentations of the same result, not separately saved draft models. Keep/Approve actions are disabled during rewrites. Saving or approving currently resets the Workspace after a local save; a real failure should keep the unsaved work available.

Current X output is a fixed thread and inline X editing is disabled. Decide how the backend represents per-channel drafts and thread items; map that deliberately rather than assuming one string covers both channels.

## 7. Knowledge intake

The page has one Your data list. Add files opens a native dialog with desktop drag/drop and a native multi-file picker. New documents join the same list as the fixture sources. There is no separate documents section or permanent upload panel.

`documents.ts` currently stores actual file blobs in IndexedDB database `authority-refined-documents`, object store `documents`, version 1. The record contains `id`, `name`, `size`, `lastModified`, `addedAt`, and `file`. Its local duplicate key combines filename, size and last-modified time. It is not a content hash or backend identity.

Supported extensions are PDF, DOC/DOCX, TXT/MD, CSV, XLS/XLSX and PPT/PPTX, up to 20 MB each. The UI handles unsupported files, empty files, size limits, duplicates and storage failures. File details support downloading the original and removing it. Local documents are explicitly marked as stored on this device and not yet learned.

Replace IndexedDB operations with the backend's source upload/storage API. Typical stages to map are upload acceptance, extraction, indexing, available and failed, but use the actual backend's states. Show learned/available only after the processing pipeline confirms it. Client file extension checks are UI validation only; the destination owns server-side validation, access control and processing safeguards.

Replace `SOURCES` and the hardcoded count/coverage arrays in `Knowledge.tsx` with backend data. The page currently says 14 fixture sources but displays six representative rows; the three coverage cards are sample indicators. New local files do not recalculate those indicators. Real counts, coverage and source statuses must come from consistent backend data.

Links, websites and calls are represented in the fixture list but cannot currently be added through the file dialog. The current Add files label intentionally describes only supported intake. Extend to Add sources when the destination provides other source types.

## 8. Library and scheduling

The Library reads the provider's posts and applies client-side query, channel, status and date filtering. Table, Board and Calendar share that data. The phone board uses status tabs and one vertical lane. The Compact rows control affects table density; it is not another stored post view.

Date labels and the calendar are based on a fixed March 2026 fixture. Replace fixed dates in `Home.tsx`, `Library.tsx` and `Schedule.tsx` with a timezone-aware clock. Quick actions such as Tomorrow and Next Monday currently point at fixed fixture days.

`Schedule.tsx` returns a display label plus an optional ISO calendar date. The chosen timezone is included in the label; there is no authoritative UTC timestamp. Introduce a real scheduling payload with separate timezone/local time and server-resolved execution time. Do not parse display strings to schedule posts. Handle invalid/past dates and daylight-saving boundaries using the backend's scheduling conventions.

Keep approval and scheduling distinct: Approve without a date produces approved status; a selected date produces scheduled status. Actual publishing, platform tokens, queues and retries are not implemented. Reconcile a persistent confirmation with the real result before showing success.

## 9. Remaining fixture locations

| Location | Replace during integration |
| --- | --- |
| `shared/data.ts` | Posts, persona, templates, output, citations and reply fixtures |
| `Home.tsx` | Fixed date, greeting/statistics and sample activity assumptions |
| `Training.tsx`, `questions.ts` | Static question queue and sample guidance initialization |
| `Knowledge.tsx` | Source rows, source totals, coverage scores |
| `Settings.tsx` | Usage balance, plan labels, account/password/data operations |
| `Auth.tsx` | Prefilled email, demo credential, timer, recovery receipt and support link |
| `useWorkspace.ts` | Timers, canned output, generated local IDs, welcome parameter |
| `Schedule.tsx`, `Library.tsx` | Fixed calendar dates and local status updates |
| `state.tsx`, `documents.ts` | Origin-local persistence and fixture seeding |

Prototype labels should be removed when their operation becomes real, not earlier. The backend repo should also replace display character counts and source counts with values computed from authoritative content.

## 10. Recommended integration order

1. Run this export unchanged in the destination and establish a baseline.
2. Add real session handling and user-scoped loading; keep the visual shell.
3. Replace provider persistence for profiles, settings, guidance, questions and onboarding.
4. Connect posts and Library; agree on identities and version/conflict handling.
5. Connect Knowledge upload and processing, then citations.
6. Connect agent generation, stream events, cancellation and draft saving.
7. Connect approval, scheduling and publishing.
8. Resolve integration bugs and implement the destination's production safeguards there.

The product owner reports browser end-to-end testing of the design has already happened. That baseline should accompany the integration work. Checks of newly connected backend behavior belong in the destination repo and do not require repeating the design exploration.
