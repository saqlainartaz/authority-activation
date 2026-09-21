# Stakeholder application architecture

Status: verified local implementation. This onboarding/Business DNA goal made
no commit, push, PR, merge, publication, or deployment. The backend checkout
already had an isolated review-branch commit before this goal; all changes
described below remain reviewable local work on top of the pinned revisions.

## Pinned inputs

- Approved frontend baseline: `ec2f05f83dd70b59cc39d3d2240fad9b291d8d17` in this repository.
- Preserved previous Next/admin/agent reference: `8c790eba6920a3397d64486bd5162815f28ef96c` in `Final Front End` (2026-08-26).
- Compatible previous-stack backend base: `6a7429f9779537a777c99e89ac6d4b5da2bdc736`, retained in the sibling isolated checkout `../backend` and used for the connected browser verification.
- Deployment-port base: remote `main` at `04e9e9a5080f00ea8b2284d6a30bda36a82ecd43`. Isolated branch `fix/stakeholder-flexible-agent-intent` contains pushed commit `12d857299a108ece3324467018a529aac0249369`; its local `backend-main-port` worktree additionally contains the browser-only temporary-variant receipt and fail-closed disposable-test-harness changes. Those local changes are not committed or pushed.
- Framework: Next.js `16.3.3`, React `19.3.0`, TypeScript, Node 22.12 or newer.
- Current stakeholder checkout HEAD: `ef827e32ee452fd6e242bf64df809e7849fa5843`
  on `main`, with the documented uncommitted stakeholder diff.
- Current isolated backend HEAD: `12d857299a108ece3324467018a529aac0249369`
  on `fix/stakeholder-flexible-agent-intent`, with the documented uncommitted
  compatibility diff.

The backend revision was selected by matching the old BFF's real `/v1` callers, auth token shapes, chat context/draft endpoints, persistence models, migrations, worker behavior, and tests. Date proximity was not used as proof.

## Runtime boundaries

```text
Browser
  |-- /refined/*  approved client UI (isolated refined CSS/providers)
  |-- /internal   retained admin workflows (isolated, client-aligned operator UI)
  `-- same-origin /api/*
          |
          | Next.js Node runtime: auth BFF, server-only service key,
          | session cookies, TypeScript marketing-copy agent, SSE stream
          v
     Python engine (separate host/process)
          |-- engine_app: tenant-scoped request work under RLS
          |-- engine_worker: background job claims
          |-- PostgreSQL: authoritative product/provenance state
          `-- persistent raw-file storage
```

Python continues to supply structured knowledge, provenance, verification, scheduling state, persistence, and background processing. The copied TypeScript agent remains responsible for client-facing marketing copy. Provider and service credentials never enter browser bundles.

## Next.js migration

- `src/app/layout.tsx` owns metadata and the approved frontend CSS graph.
- `/` redirects to `/refined/home`; a persistent `/refined` layout owns the client shell and data provider, while its optional catch-all leaf retains all public `/refined/*` URLs, direct links, refreshes, and query parameters without remounting the connected data graph on each sidebar transition.
- `src/refined/navigation.tsx` is the only routing adapter; no competing browser router remains.
- Refined links disable speculative prefetch because every protected server render validates the session. Same-page Workspace query-state updates use the native history API supported by the App Router, avoiding an otherwise redundant protected render while preserving direct-link and back/forward behavior.
- The approved browser-first tree stays behind a client boundary so local storage, IndexedDB, media queries, portals, theme ownership, Base UI, assistant-ui, and DayPicker retain their behavior.
- The admin route keeps its own CSS/provider boundary, but deliberately mirrors the client surface's system type, black actions, warm neutral surfaces, radii, and 1,180 px layout threshold. The boundary prevents either surface from leaking component styles into the other.
- Connected draft evidence is reconstructed from the verified temporary variant's browser-only receipt while the conversation remains active, then from the matching durable version receipt after **Keep as draft**. The model/runtime response omits both receipts and locators. Unicode code-point offsets are mapped to claim segments in the browser; citation popovers show the receipt's quote, source label, and available locator rather than fixture metadata.
- `next.config.ts` packages the server-only agent instructions and skill files via output tracing. The streaming agent route declares `maxDuration = 300`.
- The exact 768px and 1,180px responsive thresholds are unchanged.

Demo behavior is gated by `NEXT_PUBLIC_AUTHORITY_DEMO=1`. With it unset, supported operations use the real BFF/backend. Unavailable backend operations retain the approved presentation and are described in `FEATURE-GAPS.md`; they are not represented as successful integrations.

## Business DNA and onboarding boundary

- Python owns the versioned `business-dna/1.0.0` nine-question catalogue,
  accepted choice values, required/optional rules, canonical response envelope,
  completion timestamp, exact question text/version provenance, and atom
  writeback. The browser never invents a second authoritative questionnaire.
- The Next adapter decodes that wire shape, renders the existing onboarding
  system, and sends answer-only replacements. Long answers, ordinary single
  choices, auto-advance, optional blank Next, and the persistent **Something
  else** path are presentation behavior; canonical persistence stays server-owned.
- Business DNA is a minimal projection of authenticated identity plus canonical
  responses. Section edits replace only their owned response fields and retain
  unsaved input on a failed write.
- Train Your AI's existing Questions design now reviews real provisional atoms.
  Confirm/deprecate actions use the backend decision ledger and retry one
  decision with one idempotency key; Guidance and Preferences remain local gaps.
- Each TypeScript-agent turn receives one bounded, escaped, non-citable client
  brief derived from an allowlist of identity and Business DNA fields. It aids
  identity/reference resolution and retrieval selection, but is never evidence
  for a draft; `prepare_generation` and verified source material remain required.

## Security and data commitments

- Client identity comes from the backend-validated token in an `httpOnly`, `SameSite=Lax`, production-`Secure` cookie; client ids in URLs or browser state are never trusted as identity.
- Internal administration is fail-closed behind the server-only `INTERNAL_PASSCODE`. This is the previous stack's lightweight admin gate, not a claim of full operator identity management.
- Service and provider keys are server-only. Mutating routes enforce same-origin requests; error translation preserves cross-tenant 404 indistinguishability.
- Draft citations use authoritative atom ids and stored snapshot relationships. Append-only provenance and tenant isolation remain backend-enforced.
- No browser fixture or IndexedDB document is silently uploaded. A disposable synthetic PostgreSQL service was used for verification only.

See `CAPABILITY-MAP.md`, `VERIFICATION.md`, `LOCAL-SETUP.md`, and `DEPLOYMENT-HANDOFF.md` for operational evidence.
