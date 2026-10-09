import "server-only";

/**
 * The TypeScript mirror of Python's `context.v1` — a HAND-WRITTEN copy of
 * `src/product/api/context_wire.py`, and hand-written copies drift.
 *
 * `scripts/assert-context-schema.mjs` is what stops that, by comparing these
 * names against `contracts/context-schema.json`, which is generated from the
 * Pydantic model and pinned in the repo that owns it.
 *
 * WHY THE MIRROR IS ALLOWED TO EXIST AT ALL. The handover's §2 guardrail forbids
 * "a second context system inside the frontend or a TypeScript wrapper". A type
 * declaration is not a second system: it adds no field, derives no value and
 * decides nothing. The line it must not cross is computing context here rather
 * than reading it — so nothing in this file has a function in it, deliberately.
 */

export type MaterialV1 = {
  atom_id: string;
  atom_type: string;
  text: string;
  trust: "untrusted";
};

export type BackgroundV1 = {
  source_type: string;
  text: string;
  trust: "untrusted";
};

export type VoiceV1 = {
  tone: string[];
  audience: string | null;
  do_phrases: string[];
  /** Stylistic preference. NOT `ContextV1.banned_phrases`, which is a hard
   *  constraint enforced by Python's `checks.py`. The names differ because the
   *  existing vocabulary invites confusing them. */
  avoid_phrases: string[];
};

export type QuestionV1 = {
  prompt: string;
  fact_key: string;
};

export type GapV1 = {
  id: string;
  label: string;
};

export type ConflictV1 = {
  id: string;
  label: string;
  values: string[];
  trust: "untrusted";
};

export type ContextV1 = {
  contract_version: "context.v1";
  /** The `chat_snapshots` row primary key, NOT the payload-internal
   *  `TaskSnapshotV1.snapshot_id`. Both are uuids, both were called
   *  `snapshot_id`, and the first implementation of `/drafts` queried the wrong
   *  one. Settled 2026-08-24; see spec §4.2. */
  snapshot_id: string;
  platform: "linkedin" | "instagram" | "x" | "facebook";
  status: "ready" | "answer_needed";
  question: QuestionV1 | null;
  subject: string | null;
  task: string;
  voice: VoiceV1;
  material: MaterialV1[];
  background: BackgroundV1[];
  banned_phrases: string[];
  gaps: GapV1[];
  conflicts: ConflictV1[];
};

/**
 * `context.v2` — the C4 projection, returned when the request asks for it.
 *
 * Two fields beyond v1, both closing a product defect rather than adding
 * decoration.
 *
 * `selected_draft` carries the EXACT stored body of the draft being revised.
 * Before it, a revise turn gave the model the prior task string with
 * "Revision direction: …" appended and left it to reconstruct the post from
 * the transcript, so "shorten this" shortened a paraphrase.
 *
 * `sources` names what the material came from. v1 returned only a question
 * when readiness blocked — no material, no sources — so a request phrased
 * "based on my documentary" produced an empty-handed question while the
 * documentary sat in the same snapshot.
 *
 * v1 above is untouched and still the default. Python pins both shapes with
 * `extra="forbid"` and distinct `contract_version` literals, so the two can
 * never be mistaken for one another.
 */
export type SelectedDraftV2 = {
  variant_id: string;
  version_no: number;
  body: string;
  /** SHA-256 of `body`, so a consumer can prove what it rendered. NOT
   *  authorization: the submission fence rechecks eligibility regardless. */
  body_digest: string;
  /** The draft's read citations that the session's view still binds to the
   *  same material. A pointer, not permission: each must be re-read this turn
   *  before it can be cited again. Absent from a server older than the field,
   *  which is read as "none". */
  citations?: DraftCitationV2[];
};

/** One claim the selected draft made, and the read handle it rests on. */
export type DraftCitationV2 = {
  handle: string;
  claim_text: string;
};

export type SourceLabelV2 = {
  label: string;
  processing: "ready" | "pending" | "failed";
};

/**
 * Who the turn writes as. `mode` without a ref is `neutral`, which
 * attributes nothing — the server derives the permitted choices and the
 * model cannot name one, so there is no field here it could set.
 */
export type PerspectiveV2 = {
  mode: "personal" | "brand" | "neutral";
  author: { kind: string; id: string; revision: number } | null;
  brand: { kind: string; id: string; revision: number } | null;
  label: string | null;
};

/**
 * The one saved writing guideline for this perspective.
 *
 * NO `actor_id`: contracts §4 keeps actor ids server-only and the prompt
 * receives "scoped text and a safe version handle". `text_digest` is that
 * handle — a retained draft pins which text it was written under even after
 * the text is purged.
 */
export type GuidelineV2 = {
  guideline_id: string;
  revision: number;
  text_digest: string;
  text: string;
  precedence: "saved_default";
};

export type ContextV2 = {
  contract_version: "context.v2";
  snapshot_id: string;
  platform: "linkedin" | "instagram" | "x" | "facebook";
  status: "ready" | "answer_needed";
  question: QuestionV1 | null;
  subject: string | null;
  task: string;
  voice: VoiceV1;
  material: MaterialV1[];
  background: BackgroundV1[];
  banned_phrases: string[];
  gaps: GapV1[];
  conflicts: ConflictV1[];
  selected_draft: SelectedDraftV2 | null;
  sources: SourceLabelV2[];
  perspective: PerspectiveV2;
  guideline: GuidelineV2 | null;
  /** The facts the client stated in this conversation and confirmed for this
   *  piece (`TA{n}`), from the same set the basis records. Bound on every
   *  prepare, so a revision can keep citing them. Absent from a server older
   *  than the field, which is read as "none". */
  task_assertions?: TaskFactV2[];
};

export type TaskFactV2 = {
  handle: string;
  text: string;
};
