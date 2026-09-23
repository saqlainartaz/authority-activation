# Onboarding and Business DNA separation — proposal

<!-- context-status: change-record -->

Recorded 2026-09-23 at the operator's request for later discussion. This is a
proposal, not approval to implement the general redesign. No client source
material or client-specific questions belong in this Git-tracked record.

## Demo exception — 2026-09-23

The operator subsequently chose one fixed six-question stakeholder-demo intake
for every account, rather than tenant-specific question generation now. Local
code separates those answers from the retained nine-field Business DNA and moves
the latter into Train your AI. This is a narrow demo implementation, not the
general product design below. Its scenario-specific wording must be replaced or
made tenant-specific before onboarding real clients. The database-backed route
tests now pass in an isolated local fixture; the authenticated browser journey
remains unverified in this worktree.

## Intended experience

- Move Business DNA from the primary navigation into Train your AI, after
  Knowledge and before Guidance. A new client's fields start empty and are
  independently editable. Saving writes attributable field/value revisions;
  onboarding answers do not silently populate or overwrite them.
- Keep existing clients' stored answers visible through an explicit transition
  decision rather than hiding or deleting retained data.
- Treat initial onboarding as a short clarification pass over what the client's
  processed knowledge leaves missing, ambiguous, or contradictory. Do not
  require the same business-profile questionnaire from every client.
- Let an operator generate and review a bounded client-specific question set
  after knowledge preparation. Support single choice, multiple choice, short
  text where useful, and long text, including a custom answer where appropriate.
- Store the exact question/version, answer, actor, client, and supporting
  gap/source rationale. Promote an answer into knowledge only through a
  truthful, provenance-preserving mapping; otherwise retain it as a question–
  answer record. No answer should silently replace unrelated knowledge.
- When the bounded onboarding pass is complete, show a simple success state and
  enter the product. LinkedIn connection is not an onboarding requirement.

## Current gap observed 2026-09-23

The connected backend publishes one fixed nine-question Business DNA catalogue
to every client. The current Business DNA screen edits that same onboarding
response through a merge adapter. The operator's Prepare onboarding card maps
missing atom types to a static catalogue but has no generation action. The
connected backend question contract accepts single-choice and long-text only;
the preview design also demonstrates multiple-choice and short-text controls.
The current completion gate uses onboarding confirmation, so a shorter or
zero-question pass needs an explicit server-side completion rule.

## Proposed delivery sequence and estimate

1. Separate Business DNA storage/read/write and move its screen to the third
   Train your AI tab; decide the existing-data transition.
2. Introduce versioned, tenant-bound onboarding question sets and an operator
   generate/review/publish action with a safe no-question path.
3. Extend the connected answer contract for multiple-choice and text controls;
   persist each answer and evidence lineage without a broad replace-whole write.
4. Verify end-to-end isolation, retries, old-answer retention, knowledge
   writeback, and the client journey at desktop and phone widths.

Planning estimate: 2–3 focused engineering days for independent Business DNA
and shorter onboarding; another 3–5 days for client-specific question generation,
review, all answer types, safe writeback, and end-to-end verification. Quality
evaluation or new provider access may extend the latter. These are estimates,
not a delivery commitment.

## Open decisions

- Whether existing questionnaire answers migrate into Business DNA, remain as
  historical onboarding evidence, or are displayed separately during transition.
- Maximum first-pass question count and whether every question is optional.
- Which knowledge gaps qualify for a question, and which answers need operator
  review before they influence generation.
- Whether the operator can edit generated choices and wording before publishing.
