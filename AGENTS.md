# Instructions for agents working in this repository

## Objective

Integrate the approved Authority Activation frontend with the existing backend. Preserve the approved client design and user flow. The product owner later approved the documented conversational transition/evidence refinements and redesign of the retained admin shell in the client's visual language; this is still not a component-library evaluation or authority for unrelated client redesign.

Read, in order:

1. `README.md`
2. `docs/AGENT-HANDOFF.md`
3. `docs/DESIGN-CONTRACT.md`
4. `docs/DESIGN-AND-BEHAVIOR.md`
5. `docs/INTEGRATION.md`
6. `docs/VALIDATION.md`

## Scope

- Inspect the destination backend and use its actual contracts. Do not invent endpoints or credentials.
- Replace fixture data, local persistence and simulated handlers with real services. Frontend implementation changes needed for that wiring are allowed.
- Preserve client layout, spacing, typography, colors, themes, component choices, responsive behavior, navigation, action placement and approved interaction patterns. Preserve every admin module/action while following the admin decisions now recorded in `docs/DESIGN-AND-BEHAVIOR.md`.
- Reuse the existing components and state/presentation boundaries. Do not replace Base UI components with Radix variants, add a new UI library, or rebuild the screens.
- Functional bug fixes and necessary loading/error feedback are allowed when they retain the existing design. Do not do unrelated cleanup, visual polish or dependency upgrades as part of integration.
- A change to the approved visual design or user flow requires explicit product-owner approval. If a backend limitation conflicts with the design, explain the exact conflict and proposed change before implementing the visual/flow change. Continue independent integration work meanwhile.
- The product owner has reported design end-to-end browser testing complete. Preserve that baseline. Test newly connected behavior and integration changes in the destination repository; report only checks actually performed.
- Do not treat a successful build as evidence that authentication, uploading, generation or publishing is production-ready.
- Do not commit secrets, local browser data, uploaded user files, `node_modules`, or build output.

## Verification

In `frontend/`, use `npm ci`, `npm test`, and `npm run build`. Run appropriate integration checks in the destination repository. In change summaries, state what was connected, what remains simulated, how it was verified, and whether the design contract was preserved.

The detailed constraints and integration acceptance criteria are in the linked documents. Later explicit instructions from the product owner take precedence over this baseline.
