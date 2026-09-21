# Capability and integration map

Evidence baseline: stakeholder frontend at initial revision `ec2f05f...`, previous BFF/admin/agent at `8c790eb...`, connected previous-stack backend at `6a7429f...`, and the deployment-compatible backend merged as `66a7ab6...` through backend PR #32. “Verified” means local synthetic checks against the isolated backend, not a live provider.

| Surface / workflow | Implemented path and authoritative backend evidence | Persistence / async behavior | Status and verification |
| --- | --- | --- | --- |
| Client magic-link entry | `/api/client-login` exchanges an onboarding token through `GET /v1/me` and stores it only in `aa_client_token` | Backend token row; httpOnly cookie | Integrated; one-time access and route restoration exercised |
| Password sign-in / invitation setup | `/api/login` → `POST /v1/auth/login`; `/api/set-password` → invite/reset backend endpoint | Backend session/invite rows | Integrated; credential refusal contracts retained |
| Session restoration / logout | Next proxy resolves `GET /v1/me`; `/api/client-logout` revokes backend session when applicable and clears cookie | Authoritative backend session expiry/revocation | Integrated; reload and post-logout denial exercised |
| Onboarding read/write | `/api/client/onboarding` → backend-owned `business-dna/1.0.0` catalogue and canonical exact question-answer records | Atomic replace-whole response envelope; answer provenance; retained UI input on refusal | Integrated and deterministic-provider verified; long/single/custom/optional/auto-advance/reload covered |
| Account identity and timezone | `/api/client/profile`, `/api/client/timezone` → `GET /v1/me`, client/campaign reads, client timezone update | Client row | Identity/timezone integrated; profile editing unsupported |
| Business DNA profile | `/refined/profile` projects authenticated identity and canonical onboarding responses; section PUTs use the compatibility adapter | Backend onboarding response envelope; identity remains read-only | Integrated; populated/empty/edit/cancel/failure retention/reload and responsive matrix verified |
| Training questions | `/api/client/atoms` and `/api/client/atoms/[atomId]/decision` feed the existing Questions card | Backend provisional atoms and append-only decision/idempotency behavior | Integrated for confirm and eligible deprecate; failure retention and replay verified |
| Guidance rules | Approved add/edit/enable UI | Browser local storage only | Demo/local; documented |
| Writing preferences | Approved Settings controls | Browser local storage only | Demo/local; documented |
| Source listing/upload | `/api/client/documents` → client document endpoints | Backend document row + background pipeline job | Integrated; accepted/processing/atomised/failed are rendered truthfully |
| Source inspect/reprocess/remove | `/api/client/documents/[documentId]` → client-scoped read/reprocess/delete endpoints | Backend state and idempotent operations | Integrated; cross-tenant/absent ids share 404 |
| Original source download/name | No previous backend response or route exposes the immutable raw object or original filename to this caller | Raw bytes exist in backend storage but no client contract | Unsupported; local IndexedDB files retain local download |
| Knowledge/evidence | `/api/client/atoms`, constraints routes, browser chat-session variant receipts, and `/api/client/content-items/[id]/versions` receipts | Backend atoms, decisions, snapshots, verified temporary receipts, durable receipt claim spans and citations | Integrated; claim-backed drafts enable the evidence lens before save and retain it after promotion/reload; runtime/model envelopes still exclude locators; Unicode-safe mapping is unit- and browser-tested |
| Agent conversation | `/api/client/chat/sessions/*`; Next Node TypeScript agent receives a bounded non-citable client brief, then calls context/draft tools with the unchanged request, non-evidentiary subject and semantic retrieval query | Backend transcript/session; tenant-scoped retrieval; SSE; server-verified draft; allowlisted identity/Business DNA context | Integrated; identity answer, fresh-session restoration race, grounded streaming, citations, reload and retry-safe ids exercised locally |
| End conversation / New post | `start_new_post` chat command from the pre-draft or drafted Workspace | Backend atomically finishes the old session and returns the authoritative replacement | Integrated; pre-draft confirmation and single-command replacement browser-tested |
| Deterministic keyless validation | `AUTHORITY_AGENT_DRIVER=deterministic` selects a server-only model-decision substitute; it still uses the real loop, Python context, material handles, draft submission and verification | No external model call; real backend state | Test-only and clearly separated from production Anthropic path |
| Stop/cancel | Browser aborts the open SSE display | Backend has no cancellation signal/endpoint; a turn may finish server-side | Client-side only; UI says so explicitly; deterministic browser coverage holds the request open so the state is exercised without a race |
| LinkedIn draft create/edit/version | Agent submit, `/content-items/[id]/edit`, version reads | Immutable backend content versions and claims | Integrated; multi-version persistence and reload exercised |
| X generation | No previous backend channel contract or generation profile | Existing approved fixture/local behavior only | Unsupported; never labelled integrated |
| Keep draft / Library | Content-item read/create/edit endpoints | Backend ids, versions, transition state | Integrated; direct post link and reload exercised |
| Approve | `POST /content-items/[id]/approve` | Backend transition ledger | Integrated; remains distinct from scheduling |
| Schedule/reschedule | schedule endpoint and `/schedule-slots/[slotId]/reschedule`; zone resolved from the authoritative client | Backend slot instant + `slot_zone` | Integrated; reload plus Europe/London normal/DST unit coverage |
| Unschedule but remain approved | No compatible previous-backend operation | — | Unsupported; no success simulation |
| Publish/social outcome | No publishing provider integration in the compatible stack | — | Unsupported; no invented posted result |
| Home and Library statistics | Content/library/calendar/profile reads | Derived from backend results where present | Integrated; absent usage/provider totals render neutral values |
| Data export / password recovery email | No compatible operation/provider | — | Unsupported presentation retained |
| Admin login gate | `INTERNAL_PASSCODE` checked server-side on every internal BFF request | No browser-readable server secret | Retained previous supported gate |
| Admin People | clients, users, client summary endpoints | Backend client/user rows | Retained; list, create client + first person, inspect |
| Admin Sources | internal client document list/upload/reprocess | Backend documents/jobs/raw store | Retained |
| Admin Knowledge | atoms/search/decisions endpoints | Backend atoms and decision ledger | Retained |
| Admin Voice profile | voice-profile read/write/approve endpoints | Versioned backend voice profile | Retained |
| Admin Access | user invites and onboarding-token issue/revoke endpoints; BFF returns same-origin link | Backend token/user rows | Retained; link issuance, not email delivery |
| Admin Held drafts | held queue and release endpoint | Backend held content and transitions | Retained |
| Admin presentation | Isolated `/internal` shell around the unchanged module workflows | UI state only; no new backend capability | Redesigned in the approved client visual language; Chromium-verified at desktop, tablet, and phone widths with all module buttons retained |

## Verification coverage

- Unit/contract suites cover BFF boundaries, auth, agent event/stream semantics, idempotency, tools, citations, scheduling conversion, and UI adapters.
- `e2e/connected-application.spec.ts` covers the supported client/admin journey against the isolated Python service and disposable PostgreSQL data.
- `e2e/connected-responsive-matrix.spec.ts` covers the connected Business DNA
  state at 390, 767, 768, 1,179, 1,180 and 1,440 px in light/dark themes.
- `e2e/admin-design.spec.ts` uses intercepted synthetic responses to pin the redesigned production admin shell at 1,440, 1,000, and 390 px without touching a backend or provider.
- The compatible backend's own complete suite is the authority for RLS, cross-tenant denial, provenance, append-only ledgers, job claims, auth, scheduling, and API wire behavior.
- Live Anthropic/Voyage, real email, external publishing, and hosted infrastructure were deliberately not exercised.
