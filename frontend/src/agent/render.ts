import "server-only";

import type { MaterialV1 } from "@/agent/contracts/context";

/**
 * §4.7 mechanisms 1 and 2 — rendering material so citations can actually be valid.
 *
 * NOT FORMATTING. `checks.py` runs TWO different containment tests, not one,
 * and they disagree on normalisation: the SPAN check normalises both sides
 * before comparing (`_normalise_for_comparison`, `checks.py:351`), while
 * `claim_text` containment against the post body is byte-exact
 * (`locate_claim`, `checks.py:348`, `body.find` and nothing else). Emitting
 * atom text UNMODIFIED here is correct under EITHER regime — a normalised
 * comparison tolerates it trivially, and a byte-exact one requires it — so
 * this function's behaviour does not change with which check is looking at
 * it. What it must not do is add its OWN transformation on top — re-wrapping,
 * collapsing whitespace, smart quotes, markdown re-rendering — because that
 * moves the atom text further from whichever regime is comparing it, and
 * breaks every citation silently. The rejection would then arrive from Python
 * looking like a model failure, and the actual bug would be here.
 *
 * Two rules, and they are the whole file:
 *
 * 1. The model sees SHORT HANDLES, never uuids. It cites `M1`; the runtime
 *    substitutes the real `atom_id` when it builds the Python-facing payload
 *    (see `buildDraftPayload`). This is §3's principle applied rather than
 *    excepted — the id is injected by the runtime and the model merely points at
 *    material it was shown.
 * 2. Atom text is emitted UNMODIFIED inside a delimiter.
 *
 * Handles are POSITIONAL. Two atoms with identical text get two handles, because
 * deduplicating would make one of them uncitable.
 *
 * NO ESCAPING, DELIBERATELY. Unlike the sibling module `transcript.ts` — which
 * escapes `&` and `<` in every body it wraps, because a client-forged
 * `</client-message>` there could impersonate a different, more-trusted role —
 * this module escapes nothing. Nothing byte-compares a transcript body, so
 * escaping it is free; `checks.py`'s SPAN check compares atom text against the
 * model's quoted span (normalised, per the note above — not byte-exact, but an
 * HTML-escaped span still fails that comparison, since `_normalise_for_
 * comparison` does not un-escape entities), so escaping it here would corrupt
 * every citation containing `&`, `<`, or `>` and fail containment silently.
 * Same shape, opposite answer, because the two texts are checked differently
 * downstream.
 */

export type HandleMap = Map<string, MaterialV1>;

export function renderMaterial(material: MaterialV1[]): { text: string; handles: HandleMap } {
  const handles: HandleMap = new Map();
  const blocks: string[] = [];

  material.forEach((atom, index) => {
    const handle = `M${index + 1}`;
    handles.set(handle, atom);
    // Attribute values are ours (a handle we minted, a type from a closed
    // vocabulary). Only the BODY is client-derived, and it goes between the tags
    // untouched — no escaping, because escaping would change the bytes.
    // The leading `[M1]` label is a visual anchor only, placed outside the
    // delimiter tag so it is easy for the model to see and point at. The
    // CITED VALUE is the bare handle (`"M1"`, no brackets) — Task 6's
    // `ModelCitation.handle` and the `handles.get(citation.handle)` lookups in
    // `buildDraftPayload`/`preflight` are keyed on the bare form, and a
    // bracketed echo would fail every one of them. Nothing here parses or
    // strips the bracket back off; it is cosmetic, not part of the contract.
    blocks.push(
      `[${handle}] <material handle="${handle}" type="${atom.atom_type}" trust="untrusted">\n` +
        `${atom.text}\n` +
        `</material>`,
    );
  });

  return { text: blocks.join("\n"), handles };
}
