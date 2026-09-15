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
