# Business DNA and connected onboarding design

Status: proposed for product-owner review  
Date: 2026-09-20  
Scope: isolated Authority Activation stakeholder application only

## Purpose

Replace the connected application's client-specific demo onboarding with a
short, truthful setup that works for businesses and personal brands, lets a new
client enter the workspace, and creates useful structured context without
turning onboarding into a long knowledge interview.

Add a sidebar-accessible **Business DNA** profile as the ongoing place to view
and maintain that context. Keep the existing Train Your AI screen and question
deck, but replace its connected-mode local knowledge-building questions with
real knowledge-atom review from the existing backend. The onboarding prompts
such as “never claim” and “avoid phrases” do not appear in this question deck.
Knowledge and Guidance remain present in their existing designs.

The existing demo-mode fixtures remain available only when explicit demo mode
is enabled. No connected client will be shown claims about restaurant groups,
six-week onboarding, “the Engine”, or source conflicts that do not come from
their own account.

## Product principles

1. **Short onboarding; richer profile later.** Setup collects enough information
   to establish identity, direction, proof and a useful writing preference.
   Business DNA remains editable after setup.
2. **Broad language.** Questions say “you or your business” where needed and do
   not assume a company, a particular industry, a sales model or a personal
   brand.
3. **Data-driven, not model-generated.** Runtime questions come from one
   versioned backend catalogue that the authenticated prefill publishes and the
   typed frontend renders. No provider call, probabilistic copy or per-client
   question invention is required.
4. **No invented profile facts.** Empty fields remain visibly empty. The UI does
   not manufacture proof, objections, audiences or differentiators.
5. **One persistence authority.** The previous backend's onboarding record and
   confirmed onboarding atoms remain authoritative. Browser state is only form
   state.
6. **Discovery is not evidence.** The conversational agent may use Business DNA
   to interpret a request or choose a retrieval subject, but a draft may assert a
   profile fact only when the existing generation context returns it as verified
   material.
7. **Preserve the visual system.** Use the current Base UI/shadcn components,
   typography, colors, spacing, themes, motion rules and 768/1180 px responsive
   thresholds.

## Approaches considered

### A. Add one guardrail field to the existing five demo packets

This is the smallest access fix, but connected clients would still see
restaurant, timing and product-name questions fabricated for the approved demo.
It fixes the final 422 while preserving the underlying production defect.

### B. Generate onboarding questions with an LLM

This looks dynamic but adds latency, cost, nondeterminism, prompt-safety work and
a new failure mode before a client can even enter the application. The previous
backend also exposes no reviewed contract for accepting arbitrary generated
question semantics.

### C. Versioned universal catalogue plus mixed inputs — selected

The backend owns stable, reviewed question ids, versions, prompts and ordinary
choice values; the frontend renders that catalogue through the existing typed
packet model. Open text is used where the client's own description matters.
Single choice is used only where a broad option can reduce effort without
pretending to know the client's industry or customer. The same catalogue drives
form rendering, review labels, write mapping and Business DNA presentation.
This removes client-specific hardcoding without inventing a question-generation
subsystem.

## Connected onboarding

### Question sequence

The connected flow contains nine packets. Existing one-packet-per-screen,
automatic ordinary single-choice progression, explicit Next for text and custom
answers, Back, review and Change behavior remain intact.

| Order | Stable id | Review label | Client-facing question | Input | Required | Knowledge destination |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `business_overview` | About you | Tell us about what you or your business does—in your own words. | Long text | Yes | `tldr` |
| 2 | `audience_context` | Audience | Who do you most want your work to reach or help? | Long text | Yes | Profile context; no invented M1 type |
| 3 | `known_for` | Strongest point | What do people usually come to you for, or what do you most want to be known for? | Long text | Yes | `insight` |
| 4 | `distinctive_approach` | What makes you different | What makes your work, approach or experience different? | Long text | No | `insight` |
| 5 | `content_objective` | Main objective | What should your content help you do most right now? | Single choice | Yes | Profile context; no invented M1 type |
| 6 | `problem_or_goal` | The problem | What problem, need or goal does your work address? | Long text | No | `pain_point` |
| 7 | `recurring_questions` | Common questions | What questions, doubts or misunderstandings come up most often about your work? | Long text | No | `objection` |
| 8 | `proof` | Proof | What examples, results, experiences or stories best show the value of what you do? | Long text | No | `proof_point` |
| 9 | `tone` | Writing tone | How should your writing usually sound? | Single choice | No | `tone` |

`content_objective` offers these ordinary values, in this order:

1. Build recognition and trust.
2. Explain what I do more clearly.
3. Start conversations with potential customers.
4. Share useful expertise and ideas.
5. Support an offer, launch or change.
6. Stay visible to the people who matter.

`tone` offers these ordinary values, in this order:

1. Clear and direct.
2. Warm and conversational.
3. Thoughtful and authoritative.
4. Bold and energetic.
5. Calm and measured.

The existing **Something else, I will type it** choice remains last on every
single-choice packet. An ordinary choice advances immediately. Something else
reveals the current writing field and stays on the packet until the client enters
non-whitespace text and presses Next. Selecting an ordinary answer while editing
from review returns directly to review. The auto-advance rule does not apply to
Train Your AI.

Optional packets retain the same footer and Next action as every other packet;
Next is enabled without an answer and the instruction identifies the packet as
optional. No Skip, Not yet, secondary action or new progression control is
introduced. Required packets still require a real answer before Next enables.

The connected flow does not ask `never_claim` or `avoid_phrases`. Existing
non-empty legacy guardrail values are preserved during a confirmation and are
not cleared merely because the approved flow no longer asks them. Tone remains
an optional client-authored preference rather than a mandatory access gate.

The welcome uses the authenticated `display_name` once when present, for
example, “Hi Sarah, let’s help your AI understand your business.” The name may
appear once more on the final review. It is not interpolated into every question
or stored as part of question provenance. Missing names use the same copy with
the salutation omitted.

### Runtime question model

A versioned backend catalogue describes each packet:

- stable id, catalogue version and knowledge destination;
- headline, explanation, review label and placeholder;
- input type and required/optional state;
- answer normalisation and maximum display length;
- ordered ordinary choices where the input is single choice;
- applicability to demo or connected mode.

The authenticated onboarding prefill publishes the catalogue and the client's
saved response envelope. The frontend validates the shape into its existing
packet types and renders it. JSX does not contain a parallel set of
business-specific questions or request mappings. Unknown question types,
versions or malformed options fail the connected prefill rather than falling
back to fixtures.

This is “dynamic” in a deterministic product sense: server options, server
prompts, saved answers and required states shape the rendered sequence. It is
not an LLM-authored questionnaire.

### Loading and restoration

Connected onboarding waits for `GET /api/client/onboarding` before presenting a
question. A failure renders the existing entry-flow error treatment with Retry;
it never falls back to fixture data.

Stored answers hydrate the corresponding packets. A client returning to an
incomplete flow resumes at the first required unanswered packet. A confirmed
client who opens onboarding sees the review state populated from the
authoritative record.

### Question–answer ingestion contract

The browser submits response objects rather than anonymous answer lists. Each
object carries the stable question id, catalogue version and typed answer. The
backend resolves the authoritative question text and choice labels from its
catalogue; it does not trust browser-authored prompt text.

For every answered packet, the canonical onboarding source preserves:

- question id and catalogue version;
- exact authoritative question shown;
- selected ordinary value or the client's custom/open text;
- answer timestamp and submission ordinal.

Only the client's normalized answer becomes atom text. The system-authored
question remains source/provenance context and is never represented as a client
claim. Atom provenance carries the question id, catalogue version, answer
ordinal and source document. A profile-only response still lands in the
canonical source and Business DNA record; it is not forced into an inaccurate
M1 atom type merely to increase atom count.

The Python backend remains the persistence and knowledge-ingestion authority.
The Next.js server adapter authenticates, validates and forwards the envelope;
the TypeScript writing agent consumes the resulting profile and retrieved
knowledge but does not maintain a second onboarding database.

Previously saved legacy answers remain readable and are projected into the new
response envelope where their meaning is unambiguous. A legacy value with no
safe question mapping remains preserved outside the new packets and is reported
as legacy data rather than silently relabelled.

### Save boundary

Introduce a server-only profile adapter shared by onboarding and Business DNA.
It reads the current onboarding record, merges only allowlisted changes, and
sends the complete response envelope plus every retained legacy list to
`PUT /v1/onboarding`. This prevents a partial browser edit from silently
clearing an existing answer under the backend's replace-whole-record semantics.

The browser never supplies `actor`, client id, user id or service credentials.
The adapter returns the stored answer envelope; the UI updates and redirects
only after that authoritative success. A failed write preserves every form
answer and leaves the client on review with an actionable error.

## Business DNA

### Name and route

The proposed product name is **Business DNA**, replacing the temporary “XYZ”.
It is concise, works for businesses and personal brands, and describes identity
rather than marketing configuration. The route is `/refined/profile`.

Add Business DNA as a primary destination using the existing desktop sidebar
item treatment. This is the only approved navigation change: existing items are
not renamed, reordered, resized, restyled or removed. On compact layouts it uses
the same mobile navigation language and active-state behavior as the existing
destinations; the implementation plan must verify that the added destination
does not overflow at 390 px.

### Information architecture

The page uses the current top bar, content width, cards, labels, inputs and
buttons. It is a profile, not a dashboard of invented scores.

1. **Identity**
   - display name and profession, read-only from authenticated identity;
   - company/person summary (`business_overview`).
2. **Who it is for**
   - audience in the client's own words (`audience_context`);
   - main objective (`content_objective`);
   - client problem or goal (`problem_or_goal`).
3. **What makes it credible**
   - strongest point (`known_for`);
   - distinctive approach (`distinctive_approach`);
   - common questions or doubts (`recurring_questions`);
   - proof, results and experience (`proof`).
4. **How it should sound**
   - optional tone (`tone`);
   - existing legacy language constraints remain preserved but are not promoted
     into new onboarding questions or presented as a new guidance-rule system.

Each section has one restrained Edit action and explicit Save/Cancel controls
using the current settings/dialog patterns. Empty optional values read “Not
added yet”; they do not receive examples masquerading as client data. Saving a
section calls the server-side merge adapter, disables duplicate submission and
shows success only after the backend responds.

The first release does not add profile completeness percentages, AI-generated
biographies, personality labels, benchmarks, recommendations, scores or public
profile sharing.

## Train Your AI

The screen, tabs, dark question card, position indicator, navigation arrows,
completion card, typography and spacing remain in the existing design system.
The connected data and actions change; this is not a new visual treatment.

In connected mode, the Questions tab replaces the six local fixture questions
with the client's provisional knowledge atoms from `GET /v1/atoms`. Each card
asks the client to verify one extracted item and presents:

- the full atom text as escaped plain text, never HTML or rendered Markdown;
- the existing client-facing label for its atom type;
- the server-authored `source_label` as provenance context;
- **Confirm**, which posts `decision: "confirm"` to
  `POST /v1/atoms/{atom_id}/decision`;
- **Not accurate**, which posts `decision: "deprecate"` only when the row's
  authoritative `can_deprecate` value is true.

The client route does not support `override`, so the screen does not offer an
edit or correction control and does not imply that it can rewrite extracted
text. Adding client-authored corrections is a separate product and contract
decision, not part of this temporary implementation.

Only atoms whose authoritative `status` is `provisional` count as waiting and
enter the question-card queue. A successful Confirm promotes an atom to
`confirmed`; a successful Not accurate decision suppresses it without deleting
its source. In both cases the card leaves the queue only after the backend
responds successfully. Every mutation carries a newly generated idempotency
key. Duplicate submits are disabled, and an `unchanged: true` replay is treated
as a quiet success rather than a second claimed action.

Atoms that are already confirmed remain part of the backend's live knowledge
set but do not reappear as unanswered questions. When no provisional atoms are
returned, the existing caught-up card appears. An empty atom list is a truthful
empty state, not a “not available” state. A read or decision failure uses the
current inline error/toast language, preserves the active card, and never
decrements the waiting count or shows success.

This is an explicitly temporary presentation of the previous backend's real M1
atom-review capability until the overhaul replaces it. The limitation is stated
in documentation, not as a new banner or visual state inside the product. It
does not hardcode a replacement questionnaire and it does not mix onboarding
guardrail prompts into atom review.

Guidance remains in its current design and behavior under this goal; it is not
removed, replaced or redesigned. Knowledge remains fully connected and
unchanged. Explicit demo mode retains the existing six fixture questions and
fixture guidance interactions for baseline inspection.

## Agent context

### Always-available client brief

On each connected conversational turn, fetch the onboarding prefill through the
existing authenticated client path and project a small allowlisted brief:

```text
identity: display name, profession
business: summary, audience, strongest point, distinctive approach
direction: content objective, client problem or goal
market: recurring questions, doubts or misunderstandings
credibility: proof, results and experience
language: tone
```

The projection caps list counts and string lengths. It excludes email,
tenant/user ids, document ids, source locators, raw documents, audit data and
guardrail text already handled by the authoritative generation context.

Render it to the model as escaped data inside a distinct
`<client-profile trust="client-authored-untrusted" citable="false">` block.
Agent instructions permit it for understanding identity, interpreting ambiguous
references and choosing a retrieval subject. They forbid using it as evidence
for a draft claim.

### Gated knowledge overview

Keep the existing atom-count/source-count/discovery-candidate overview behind
its deterministic intent gate. Refactor it to reuse the already-fetched
onboarding prefill on gated turns so the new brief does not duplicate the same
backend request. Concrete generation continues through `prepare_generation` and
the backend-owned `context.v1` material, constraints, voice and verification
receipt.

An onboarding answer can support a draft only if the backend retrieval path
returns its confirmed onboarding atom as material. The profile block itself is
never a citation source and does not weaken candidate verification.

## Component and data boundaries

### Verified implementation starting point

Read-only inspection on 20 September 2026 established these current facts:

- the isolated frontend is at `ef827e32ee452fd6e242bf64df809e7849fa5843`
  with existing uncommitted stakeholder integration work preserved;
- the isolated previous backend is at
  `12d857299a108ece3324467018a529aac0249369` on
  `fix/stakeholder-flexible-agent-intent`, with its existing chat-agent changes
  preserved;
- `onboarding_responses.answers` is already JSONB, and the onboarding atom write
  already creates a canonical raw JSON source document containing its payload
  and entries, so the versioned response envelope needs no database migration;
- the existing confirm route writes the profile row, source document, atoms and
  append-only audit event in one tenant-scoped transaction, which remains the
  required atomic save boundary;
- the existing request validator currently demands at least one legacy
  guardrail answer even when dynamic knowledge answers are present; this is the
  reproduced client-entry blocker the compatible contract change removes;
- the Next.js onboarding proxy already keeps credentials server-side and
  allowlists every forwarded field, but it does not yet accept response pairs;
- the client atom read and confirm/deprecate decision APIs, idempotency key and
  `can_deprecate` authority already exist through browser-safe Next.js routes;
  `Training.tsx` still renders and saves only the local fixture deck;
- the agent already has a gated authenticated workspace overview with display
  name, counts and discovery candidates. It does not yet receive the approved
  capped Business DNA brief on ordinary turns;
- the refined router and shell do not yet know a `profile` destination, and
  connected profile editing currently reports itself as unavailable.

These findings establish extension points; they are not completion evidence.
No `.env` file, live provider or retained/shared database was used to obtain
them.

The same preflight ran two environment-independent frontend baselines from
`frontend/`:

- `npm run test:design` — 21 passed, 0 failed;
- `npm run typecheck` — exited 0.

These prove the current pure design logic and TypeScript graph before this
change. They do not prove connected onboarding, Business DNA, atom review,
agent context or production readiness. `next build`, Vitest and browser runs
were deliberately not invoked during this pre-approval pass because those
toolchains may load the existing `.env.local`, which is outside this goal's
read boundary.

Expected frontend areas:

- typed connected-onboarding catalogue decoder and mapping helpers;
- shared server-only onboarding/profile merge adapter;
- connected `Onboarding` data binding and review;
- new Business DNA route and screen using existing primitives;
- Shell destination registration and compact-navigation fit;
- connected-mode Train atom-review adapter using the existing deck and the
  existing client atom read/decision BFF routes;
- client-profile projection and agent transcript assembly;
- unit, integration, browser and visual evidence;
- capability, gap, architecture, verification and handoff documentation.

Expected isolated previous-backend areas:

- versioned onboarding question catalogue and prefill projection;
- compatible request/response schema for typed response envelopes;
- canonical question–answer source payload and atom provenance;
- validation that allows completion from the approved required questions rather
  than demanding a legacy guardrail;
- legacy-answer preservation and compatibility tests.

This is a small extension of the existing onboarding route and derived-atom
write path, not a new Python subsystem. No database schema or retention-policy
change is planned; the existing JSON answer/source payloads carry the versioned
pairs. Evidence that this cannot be done safely without a schema or shared
contract change returns to design review instead of importing overhaul code.

## Error and safety behavior

- An expired session follows the existing generic authentication path.
- Prefill failure never reveals fixture questions.
- Validation errors name the affected profile section without discarding input.
- A conflicting save remains on the page and reloads nothing until the operator
  chooses to retry; no optimistic success is shown.
- Repeated clicks cannot duplicate an atom decision or claim a second success.
- Existing non-empty lists are preserved unless the client explicitly clears
  the corresponding Business DNA field.
- Single-choice values are accepted only from the versioned server catalogue;
  custom answers are normalized and retained as custom text.
- Every profile field displayed to the model remains escaped, marked untrusted
  and excluded from citation handles.
- No provider key, service key or raw onboarding credential reaches a browser
  bundle or documented artifact.

## Verification requirements

### Automated

1. Question-catalogue tests cover order, version, required/optional progression,
   the exact content-objective and tone choices, custom-answer validation,
   ordinary-choice auto-advance and answer mapping.
2. Adapter tests prove a partial profile edit preserves every unedited populated
   response and legacy list and never forwards identity/actor fields.
3. Onboarding component tests cover load, resume, review, retained input after
   validation or transport failure, display-name and missing-name greetings,
   duplicate-submit prevention and authoritative completion.
4. Backend contract tests prove the canonical source retains each exact
   authoritative question–answer pair, atom text contains only the client
   answer, provenance names the question/version, profile-only responses are not
   assigned false atom types, and legacy answers survive reconfirmation.
5. Business DNA tests cover populated and empty profiles, edit/save/cancel,
   explicit clearing and reload persistence.
6. Train tests prove connected Questions render provisional atoms in the
   existing deck, escape atom text, show type/source context, and send real
   confirm/deprecate decisions with idempotency keys. They cover `can_deprecate`
   false, already-confirmed exclusion, quiet replays, duplicate-submit
   prevention, retained card/error state on failure, authoritative waiting
   counts and the caught-up state. Guidance and Knowledge retain their existing
   presentation.
7. Agent tests prove every turn receives only the capped allowlisted profile,
   gated turns do not fetch onboarding twice, all client text is escaped, and
   email/ids/locators never appear.
8. Grounding tests prove profile data cannot become a citation handle and draft
   submission still depends on `context.v1` material.
9. Existing frontend design, agent, BFF and schema gates remain green; production
   build succeeds.

### Connected browser journey

Using synthetic data, the isolated previous backend and deterministic providers:

1. issue a new client link and enter connected onboarding;
2. verify no demo-specific prompt or source quote appears;
3. verify ordinary content-objective and tone choices auto-advance, Something
   else stays for text, answer required questions, leave an optional packet blank
   using its ordinary Next action, review and open the workspace without
   operator-side seeding;
4. reload and confirm onboarding completion/session restoration;
5. open Business DNA from the sidebar, inspect the persisted profile, edit an
   optional field and prove persistence after reload/new session;
6. verify connected Train Questions show a real provisional atom, confirm it,
   reload and prove it no longer counts as waiting; deprecate an eligible
   synthetic atom and prove it disappears without changing the deck design;
   verify Guidance and Knowledge remain present;
7. ask the agent who the client is and inspect the structured profile answer;
8. request a draft and prove profile-only text cannot bypass evidence and receipt
   requirements;
9. repeat representative states in light/dark at phone, tablet and desktop,
   including 767/768 px and 1179/1180 px boundaries.

## Non-goals

- Adaptive question generation from corpus gaps.
- LLM-authored onboarding or profile synthesis.
- Importing any overhaul question, profile, database or service implementation.
- A new backend entity, subsystem or retention policy.
- Arbitrary guidance-rule CRUD.
- Personality typing, psychometrics or inferred private traits.
- Public profile pages, social publishing or provider-account changes.
- Workspace, Home, Library, admin or any unrelated screen redesign.
- Renaming, reordering, restyling or removing existing sidebar destinations.
- Removing or replacing the Train Your AI design, Guidance tab or Knowledge tab.
- Commits, pushes, PRs, merges or deployments under this design approval.

## Completion criteria

- A new connected client can complete onboarding without synthetic operator
  intervention.
- Connected onboarding contains no account-independent client-specific fixtures.
- Connected onboarding mixes open text with the approved universal choices,
  preserves Something else, and retains exact question–answer provenance.
- Business DNA displays and persists the defined profile fields truthfully.
- Connected Train Questions review the backend's actual provisional atoms and
  persist supported confirm/deprecate decisions through the existing
  question-deck design; onboarding guardrail prompts are not substituted into
  this section, and Guidance and Knowledge remain present.
- The conversational agent receives the safe structured brief; authoritative
  generation and citations remain unchanged.
- Responsive visual behavior matches the approved system.
- Deterministic checks and the complete connected browser journey pass.
- Documentation distinguishes verified behavior from deferred overhaul work.
- The overhaul remains untouched and nothing is committed, pushed or deployed.
