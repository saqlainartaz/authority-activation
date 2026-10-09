import "server-only";

/**
 * The Python-facing draft payload — field-identical to `wire.py`'s
 * `Draft`/`Citation`, and pinned to `contracts/draft-schema.json`.
 *
 * THIS IS NOT THE MODEL-FACING SCHEMA (spec §4.6 — conflating the two was a
 * defect in the spec's own first draft). The model never handles a uuid: it is
 * shown short handles (`[M1]`) and cites `M1`, and the runtime substitutes real
 * `atom_id`s when it builds this payload (§4.7 mechanism 1). So `atom_id` below
 * is runtime-injected, per §3's principle — only the draft itself comes from the
 * model.
 *
 * `buildDraftPayload` lands here in Task 6.
 */

export type Citation = {
  atom_id: string;
  quoted_span: string;
  claim_text: string;
};

export type Draft = {
  body: string;
  cited_atom_ids: Citation[];
};

import type { HandleMap } from "@/agent/render";

/** What the MODEL fills in. Carries a handle, never a uuid (§4.6, §4.7). */
export type ModelCitation = {
  handle: string;
  quoted_span: string;
  claim_text: string;
};

export type ModelDraft = {
  body: string;
  cited_atom_ids: ModelCitation[];
};

/**
 * Turn the model's handle-cited draft into the Python-facing payload.
 *
 * The one line that matters: `atom_id` comes from the handle map — server state
 * — and never from the model. That is §3's principle, and it is why the two
 * schemas in §4.6 are allowed to differ.
 *
 * Throws rather than dropping an unresolvable handle. A dropped citation would
 * let a draft reach Python with fewer claims than the model actually made, clear
 * the citation floor on the survivors, and publish an uncited assertion.
 */
export function buildDraftPayload(draft: ModelDraft, handles: HandleMap): Draft {
  return {
    body: draft.body,
    cited_atom_ids: draft.cited_atom_ids.map((citation): Citation => {
      const atom = handles.get(citation.handle);
      if (atom === undefined) {
        throw new Error(
          `citation handle ${citation.handle} does not resolve to material in this snapshot`,
        );
      }
      return {
        atom_id: atom.atom_id,
        quoted_span: citation.quoted_span,
        claim_text: citation.claim_text,
      };
    }),
  };
}

/**
 * The `c4-submit-1` payload, and how it differs from `draft.v1`.
 *
 * **No `snapshot_id` and no `atom_id`.** A v1 submission names a frozen
 * snapshot and resolves handles to real atom uuids before leaving the
 * runtime. A c4 submission names an immutable BASIS and keeps the handles as
 * handles: the server resolves them against its own view, which is the only
 * place that knows what was exposed. Substituting a uuid here would let the
 * runtime name a record the view never issued.
 *
 * **`quoted_text` may be null, and that is not a weaker claim.** Contracts
 * section 5: a null quote "permits attributed paraphrase, not weaker
 * authorization" -- the same eligibility fence runs either way.
 *
 * **`basis_kind` rather than `kind`.** The Python body forbids a field named
 * `kind` on any verbatim-carrying request, because that is how a payload
 * would choose a message kind. Contracts section 1 permits exactly this
 * mechanical spelling adaptation; the two sides agree on the spelling.
 */
export type ClaimBasisV2 = {
  basis_kind: "read" | "task_assertion";
  handle: string;
  quoted_text: string | null;
};

export type ClaimV2 = {
  claim_text: string;
  bases: ClaimBasisV2[];
};

export type DraftSubmissionV2 = {
  schema: "c4-submit-1";
  basis_id: string;
  /** The compare-and-set: the selection this turn STARTED with, or `null`
   *  for "nothing was selected" -- which the server now checks too. Absent
   *  only when the caller states no expectation. See `buildDraftPayloadV2`. */
  expected_variant_id?: string | null;
  body: string;
  /** The Library title the model gave the post (main's library lifecycle,
   *  merged 2026-09-25). Not part of the post; absent when none was given. */
  title?: string;
  claims: ClaimV2[];
  agent_text: string;
  idempotency_key: string;
};

/**
 * Turn the model's handle-cited draft into the c4 payload.
 *
 * Every citation becomes its own claim with one basis. The model cites per
 * claim already, so grouping two citations of one sentence would merge two
 * statements of support into one and lose which words rested on which
 * handle.
 *
 * **Throws on a handle the turn never held**, exactly as `buildDraftPayload`
 * does. Dropping it would send Python a draft with fewer claims than the
 * model made, and the server would fence a narrower set than the model
 * actually wrote from.
 */
export function buildDraftPayloadV2(
  draft: ModelDraft,
  handles: HandleMap,
  options: {
    basisId: string;
    agentText: string;
    idempotencyKey: string;
    expectedVariantId?: string | null;
    title?: string;
  },
): DraftSubmissionV2 {
  return {
    schema: "c4-submit-1",
    basis_id: options.basisId,
    // **THE COMPARE-AND-SET, and it was never sent.** The backend refuses a
    // submit whose `expected_variant_id` no longer matches the session's
    // selection -- C4-12, "preserve both pieces of work rather than let the
    // older turn overwrite the newer choice". Omitted, that check never ran:
    // a turn that began on draft A, with the client switching to B before it
    // submitted, stored anyway, and storing moves the selection -- so the
    // stale turn silently replaced the client's newer choice. The outside
    // review found it; round 2 had rated it serious rather than blocking.
    //
    // Sent whenever the turn began with a selection, not only on a revise:
    // ANY store moves the selection, so any stale turn can overwrite it.
    //
    // **And sent as `null` when the turn began with NONE.** Omitting it then
    // meant "no expectation", so two concurrent first-draft turns each stored
    // and the later silently replaced the earlier's selection (outside review
    // O4, the no-selection half). An explicit null tells the server "nothing
    // was selected when I began"; it refuses the store if something now is.
    // Omitted only when the caller states no expectation at all.
    ...(options.expectedVariantId !== undefined
      ? { expected_variant_id: options.expectedVariantId }
      : {}),
    body: draft.body,
    ...(options.title !== undefined ? { title: options.title } : {}),
    claims: draft.cited_atom_ids.map((citation): ClaimV2 => {
      const material = handles.get(citation.handle);
      if (material === undefined) {
        throw new Error(
          `citation handle ${citation.handle} does not resolve to material in this turn`,
        );
      }
      return {
        claim_text: citation.claim_text,
        bases: [
          {
            // Derived from what the handle IS, not from anything the model
            // said: a model that could choose `read` for a task assertion
            // would route its own supplied fact through an eligibility
            // fence that has nothing to check it against.
            basis_kind:
              material.atom_type === "task_assertion" ? "task_assertion" : "read",
            handle: citation.handle,
            quoted_text: citation.quoted_span.length > 0 ? citation.quoted_span : null,
          },
        ],
      };
    }),
    agent_text: options.agentText,
    idempotency_key: options.idempotencyKey,
  };
}
