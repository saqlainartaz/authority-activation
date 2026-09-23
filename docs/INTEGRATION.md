# Integration guide

> Historical design-export guide. The operator-approved Next.js migration and previous-stack integration have now been implemented. For authoritative current status use [ARCHITECTURE.md](ARCHITECTURE.md), [CAPABILITY-MAP.md](CAPABILITY-MAP.md), [FEATURE-GAPS.md](FEATURE-GAPS.md), and [DEPLOYMENT-HANDOFF.md](DEPLOYMENT-HANDOFF.md). Statements below that the app is Vite-only, unconnected, or still requires future integration describe the initial `ec2f05f` input, not the delivered local application.

## Current Promo Partner integration — 2026-09-22

### Workspace streaming scroll — 2026-09-23

Owner-approved local change: the workspace is the sole conversation scroll owner;
assistant-ui automatic scrolling (including run start/history/thread switch) is off.
`ConversationScroll` follows the live edge until the reader scrolls up or an inline
post is visible. Content/viewport resizing does not resume a paused reader.
An explicit **New response** button resumes following. In compact layouts with a
completed post, it is replaced by directional **Go to post** when the post is
offscreen, or **Go to response** when the post is visible and its following reply
is below the viewport. Clicking targets the beginning, not the end, and pauses
following. Only one jump appears. Compact Save draft / Approve actions are
content-sized and right-aligned, sharing a wrapping row with quiet revision buttons.
These use existing buttons above the composer, not an overlay on post text.
Native scroll anchoring is disabled on this scroller so it does not compete with
the controller. No backend, generation, storage or publishing behavior changes.

Verification: typecheck, production build and all 22 design, 367 stack and 5 rendering tests passed.
`PLAYWRIGHT_CHANNEL=chrome node scripts/check-conversation-scroll.mjs` passed at
390 and 1280 px using the actual controller with synthetic DOM content: following,
scroll-up pause, explicit resume, visible-post protection, View post and unchanged
document scroll position. This isolated check is not an authenticated live agent
journey or full-screen visual review. No AI calls, production writes or deployment.

Follow-up preview refinement: removed the Show evidence lens control in both
layouts. Desktop and compact drafts share a collapsed-by-default Sources section;
expansion preserves source names and locators, and citation data is unchanged.
The loopback-only, login-free preview uses actual Workspace components and fixture
streaming, with network operations stubbed. At 390/1280 px, Sources was verified
collapsed initially and expandable, Show evidence absent, and the mobile View post
button absent while the post was visible. Mobile screenshot inspected. This does
not test live generation or production authentication.

### Assistant response formatting — 2026-09-23

Workspace toolbar follow-up: compact Preview/Attach controls now share one row;
an attached image uses the existing Replace/Remove handlers. Empty media no longer
occupies a separate row, and Edit text sits on the divider. Jump controls are
rounded arrows with accessible destination names and native title tooltips.
Local fixture browser checks at 320/390 px confirmed aligned Preview/Attach,
one attachment button and accessible jump naming; 320/390/1280 had no horizontal
overflow. The 390 px screenshot was inspected. Typecheck and all 394 tests passed.
Actual upload persistence was not exercised in the network-disabled preview.

Desktop card follow-up: removed forced card minimum height and 96px bottom
padding; Sources is now a sibling footer to the padded body. Attach image moved
to the right-side header controls without changing its upload handler. Mobile
was unchanged. Fixture browser checks: a short post at 1440x1000 had equal
pane client/scroll heights (775px), Sources ended 1px inside the card border,
and disclosure expanded. At 1280x650 the longer post had 546px content in a
425px pane and scrolled 121px. Screenshot reviewed; typecheck and 394 tests passed.

Assistant conversation text now renders CommonMark paragraphs, bold/italic,
lists, headings, quotes and code through `AssistantMarkdown`. The assistant-ui
Text component override does not change user-message rendering, the separate
draft result, stored bodies or citation spans. Response text uses the existing
foreground token rather than muted text; bold is weight 700 in both themes.

Dependency review: pinned `react-markdown@10.1.0`, MIT license inspected in the
installed package; upstream [documentation](https://github.com/remarkjs/react-markdown)
reviewed. No raw HTML plugin is enabled. Raw HTML and images are excluded, and
only explicit HTTP/HTTPS/mailto links are clickable, with noopener/noreferrer.
The install audit reported zero vulnerabilities at this checkpoint.

Verification: typecheck and production build passed; 22 design, 367 existing
Vitest and 5 new rendering tests passed. Client-render tests use a separate
normal-React configuration without changing the agent tests' react-server
conditions. `node scripts/check-assistant-markdown.mjs` renders the actual
component with production CSS in an isolated browser using synthetic text.
With `PLAYWRIGHT_CHANNEL=chrome`, light/dark checks at widths 390 and 1280 passed:
real bold/list elements, correct foreground colors and no horizontal overflow.
Screenshots were inspected. This is not an authenticated production chat test.
The browser-use skill was attempted but its installed CLI differs from the skill;
the isolated Playwright check was used instead. No live AI or production writes.

### Concise social writing defaults — 2026-09-23

LinkedIn skill 1.2.2 aims for 100-150 words, below 180 unless a longer post is
explicitly requested, with no padding to meet the range. Shared instructions
1.5.3 prohibit em dashes in generated bodies/titles across LinkedIn, Instagram,
X and Facebook, including revisions. Source citation quotes remain verbatim;
claim spans must match the rewritten copy. These are generation instructions,
not a post-save text transformation or a hard length validator. Existing saved
posts are untouched. Deterministic instruction tests do not prove live model
compliance; no paid writing evaluation was run for this refinement.

### Broad business writing refinement — 2026-09-23

The server-side agent reads a bounded, balanced set of live overview, named-term,
insight, need, proof and objection candidates for broad business-promotion and
basic account questions. This account overview is a retrieval hint, not citable post evidence.
When the backend supplies a small full corpus as `background`, the agent uses it
to distinguish businesses, offers and audiences while choosing an angle and
retrieval query. It cannot cite that background or silently convert inferred
profile fields into confirmed client answers.
The agent must still use `prepare_generation` and cite its returned material;
the backend snapshot now reserves up to eight source-linked business-brief atoms
for explicit business-writing requests. A Business DNA answer saved by the
client already writes a confirmed provenance-tracked atom. Uploaded-source
suggestions do not silently overwrite editable Business DNA fields.

The runnable application is the Next.js app in `frontend/`, invoked from this repository's `frontend/` directory (`frontend/frontend/` from the parent backend workspace). The current connected path uses a closed LinkedIn/Instagram/X/Facebook registry from browser toggles through BFF validation, channel-bound Python chat/session persistence and dedicated TypeScript-agent skills. Multi-channel requests coordinate separate sessions/content items sequentially.

Post media uses `POST /api/client/post-media` for multipart upload and `GET /api/client/post-media/{media_id}` for authorized preview/download. Browser-supplied tenant identity or storage paths are never trusted. An edit may bind `media_id` plus optional alt text, replace that binding or explicitly remove it; version history returns the exact immutable binding for every content version. Static JPEG, PNG and WebP images are limited to 4 MB and 8,192 × 8,192. Editing an approved/scheduled post invalidates approval and moves its active slot to `needs_reapproval`.

Home owns the shared calendar projection and selected-day agenda. Library consumes the same content/calendar reads for Table/Board and has no Calendar view. Appearance is controlled only in Settings. These current facts supersede conflicting Vite-era mappings below; the older sections remain as historical extraction guidance.

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

The Library reads the provider's posts and applies client-side query, channel, status and date filtering. Table and Board share that data; Home owns the calendar and selected-day agenda over the same authoritative post/schedule projection. The phone board uses status tabs and one vertical lane. The Compact rows control affects table density; it is not another stored post view.

Date labels and the calendar are based on a fixed March 2026 fixture. Replace fixed dates in `Home.tsx`, `Library.tsx` and `Schedule.tsx` with a timezone-aware clock. Quick actions such as Tomorrow and Next Monday currently point at fixed fixture days.

`Schedule.tsx` returns a display label plus an optional ISO calendar date. The chosen timezone is included in the label; there is no authoritative UTC timestamp. Introduce a real scheduling payload with separate timezone/local time and server-resolved execution time. Do not parse display strings to schedule posts. Handle invalid/past dates and daylight-saving boundaries using the backend's scheduling conventions.

Keep approval and scheduling distinct: Approve without a date produces approved status; a selected date produces scheduled status. Actual publishing, platform tokens, queues and retries are not implemented. Reconcile a persistent confirmation with the real result before showing success.

## Whole-client understanding — 2026-09-23

The chat server reads authenticated `GET /v1/knowledge-context` on every turn and
places escaped source documents before the transcript, with an ephemeral provider
cache marker. The backend is reread each turn; no application cache hides source
edits/removals. Failure is labelled unavailable, not empty. Saved Business DNA is
still included separately. Instructions 1.5.2 ask the existing loop agent to build
a working business/offer/audience map from both, with neither automatically taking
priority. This is not a second persisted summary or a required onboarding step.

Generation now receives whole-source `source_passage` handles as well as retrieved
atoms. Exact quote checks and server-owned receipts remain in force. Source text
is untrusted data, and does not make proposals, old events or claims true/current.
Backend support must deploy before this frontend; the frontend degrades to normal
retrieval when that read is unavailable. No visual design changes are included.

The backend owns `WHOLE_CLIENT_CONTEXT_ENABLED` (default false). Set true on the
backend and restart it to opt in; no Vercel/frontend feature flag is needed.
When false, the authenticated response is `disabled` with no source text and a
null document count (not counted). The agent receives only a disabled marker and
uses saved DNA/ordinary retrieval. New backend snapshots stop full-source reads
and citation-anchor creation; compatibility for retained drafts/citations remains.
Existing conversations and in-flight requests can still contain previous context.
Use a new chat when testing disablement. This is a feature-off recovery path, not
a database restore or an instruction to deploy an older incompatible backend.

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
