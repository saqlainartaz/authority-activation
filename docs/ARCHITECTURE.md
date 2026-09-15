# Stakeholder application architecture

Status: verified local implementation. It has not been committed, pushed, published, or deployed.

## Pinned inputs

- Approved frontend baseline: `ec2f05f83dd70b59cc39d3d2240fad9b291d8d17` in this repository.
- Preserved previous Next/admin/agent reference: `8c790eba6920a3397d64486bd5162815f28ef96c` in `Final Front End` (2026-08-26).
- Compatible Python backend: `6a7429f9779537a777c99e89ac6d4b5da2bdc736`, held detached in the sibling isolated checkout `../backend`.
- Framework: Next.js `16.3.3`, React `19.3.0`, TypeScript, Node 22.12 or newer.

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
- Connected draft evidence is reconstructed only from the backend version receipt. Unicode code-point offsets are mapped to claim segments in the browser; citation popovers show the receipt's quote, source label, and available locator rather than fixture metadata.
- `next.config.ts` packages the server-only agent instructions and skill files via output tracing. The streaming agent route declares `maxDuration = 300`.
- The exact 768px and 1,180px responsive thresholds are unchanged.

Demo behavior is gated by `NEXT_PUBLIC_AUTHORITY_DEMO=1`. With it unset, supported operations use the real BFF/backend. Unavailable backend operations retain the approved presentation and are described in `FEATURE-GAPS.md`; they are not represented as successful integrations.

## Security and data commitments

- Client identity comes from the backend-validated token in an `httpOnly`, `SameSite=Lax`, production-`Secure` cookie; client ids in URLs or browser state are never trusted as identity.
- Internal administration is fail-closed behind the server-only `INTERNAL_PASSCODE`. This is the previous stack's lightweight admin gate, not a claim of full operator identity management.
- Service and provider keys are server-only. Mutating routes enforce same-origin requests; error translation preserves cross-tenant 404 indistinguishability.
- Draft citations use authoritative atom ids and stored snapshot relationships. Append-only provenance and tenant isolation remain backend-enforced.
- No browser fixture or IndexedDB document is silently uploaded. A disposable synthetic PostgreSQL service was used for verification only.

See `CAPABILITY-MAP.md`, `VERIFICATION.md`, `LOCAL-SETUP.md`, and `DEPLOYMENT-HANDOFF.md` for operational evidence.
