# Shared demo onboarding — local handoff

<!-- context-status: change-record -->

2026-09-23. The operator authorized one fixed six-question demo intake for all
accounts. The separate frontend and backend worktrees contain the demo edits.
See current Git status and PRs for publication state; this record describes
local checks.

The backend publishes `clarification_questions` separately from the retained
Business DNA `questions` catalogue. `PUT /v1/onboarding` accepts versioned
`clarifications` or partial `business_dna_responses`, stores separate envelopes,
and writes question-qualified atoms from the intake in the tenant transaction.
The frontend renders single, multiple and optional long answers, then a success
screen; Business DNA sits in Train your AI after Knowledge and saves separately.
Old confirmed clients are not forced through onboarding again. Dynamic,
client-specific question generation and a general-client fallback are not built.

Verification performed:

- Frontend `npm run check`: 22 design tests and 352 Vitest tests, TypeScript and
  static boundaries passed with the documented standalone fixture override.
- Frontend `npm run build`: passed after the agent intent-wire correction.
- Backend against an isolated loopback-only test database on the fixture's
  hard-coded port 5432: 58 focused and 158 adjacent onboarding/chat/Library/
  route tests passed. Scoped Ruff and diff hygiene passed. The task-owned
  container and its anonymous volume were removed after the run; no existing
  database was altered.
- Browser Use could not start its local daemon. A fallback Playwright attempt
  against the already-running frontend redirected to sign-in because the
  server-side `/v1/me` gate requires a real authenticated backend; no browser
  completion claim is made.

Before release: complete a connected authenticated onboarding → knowledge writeback →
Business DNA save/reload journey; check mobile and desktop layout; and ensure
the scenario-specific questions are not exposed to real clients.
