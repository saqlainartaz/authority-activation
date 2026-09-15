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
  platform: "linkedin";
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
