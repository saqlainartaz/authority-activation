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


/**
 * An append-only handle namespace, for the `c4` contract.
 *
 * Under `context.v1` the executor does `state.handles = rendered.handles` on
 * every prepare — a fresh Map replacing the old one. That is precisely the
 * defect D8 names: "a second search must not reassign yesterday's M1 to new
 * text". With a replacing Map, `M1` after the second prepare means whatever
 * the second read put first, and a citation the model wrote against the first
 * read now points at different material. Nothing errors.
 *
 * So under `c4` the namespace is append-only and `set` REFUSES an existing
 * key rather than overwriting it. Refusing is the point: a silent overwrite is
 * the bug, and a loud one is a bug report.
 *
 * Re-setting a key to the *same* value is allowed, because a later read
 * legitimately re-exposes material the model already has, and the server
 * re-issues the same handle for it by design.
 */
export class AppendOnlyHandles {
  private readonly entries = new Map<string, MaterialV1>();

  set(handle: string, material: MaterialV1): void {
    const existing = this.entries.get(handle);
    if (existing !== undefined) {
      if (existing.atom_id === material.atom_id && existing.text === material.text) {
        return; // the same binding, re-exposed. Not a reassignment.
      }
      throw new Error(
        `handle ${handle} is already bound to different material; handles are immutable`,
      );
    }
    this.entries.set(handle, material);
  }

  get(handle: string): MaterialV1 | undefined {
    return this.entries.get(handle);
  }

  has(handle: string): boolean {
    return this.entries.has(handle);
  }

  get size(): number {
    return this.entries.size;
  }

  /** A read-only view, for the places that still want a plain Map. */
  asMap(): HandleMap {
    return new Map(this.entries);
  }
}

/**
 * Render material the SERVER has already handled, under `c4`.
 *
 * The difference from `renderMaterial` is the whole point: no `M{index+1}` is
 * minted here. The handle arrives with the material, issued once by
 * `ke/retrieval/views.py` and stable for the life of the view, so two reads
 * cannot disagree about what `K3` means.
 *
 * Text is still emitted UNMODIFIED and unescaped, for the reasons in this
 * module's header — those apply to the bytes, not to who chose the label.
 */
export function renderServerMaterial(
  material: { handle: string; atom: MaterialV1 }[],
  into: AppendOnlyHandles,
): { text: string } {
  const blocks: string[] = [];
  for (const { handle, atom } of material) {
    into.set(handle, atom);
    const open =
      `<material handle="${handle}" type="${atom.atom_type}" trust="untrusted">`;
    blocks.push(`[${handle}] ${open}\n${atom.text}\n</material>`);
  }
  return { text: blocks.join("\n") };
}

/**
 * Render prepared material as BACKGROUND, under `c4`. Nothing is citable.
 *
 * **The defect this fixes.** Under c4 the executor used to run
 * `renderMaterial(prepared.material)` and feed its `M{n}` handles into the
 * append-only namespace. Two things went wrong at once, and the second
 * independent review found both:
 *
 * 1. **The model was invited to cite material the fence cannot admit.** A c4
 *    citation is resolved by `ke/retrieval/views.py` against the view that
 *    issued the handle. `M1` was minted HERE, in the runtime, and exists in no
 *    view — so a model that did as it was told got its draft refused for
 *    citing what it had just been shown.
 * 2. **A second prepare threw.** `M{n}` is positional, so the second call
 *    re-mints `M1` for different material and `AppendOnlyHandles.set` — quite
 *    correctly — refuses the rebind. §5.4 calls re-retrieval a feature, and
 *    this cycle's own namespace fix had turned it into an exception.
 *
 * The resolution is not a cleverer numbering. It is that under c4 the citable
 * namespace belongs to the SERVER: `read_knowledge` and `use_task_material`
 * issue `K`/`E`/`C`/`S`/`A`/`TA` handles from a real view, and prepared
 * material is context for writing — voice, background, what the piece is
 * about — not a source of record. So it carries no handle at all. A model
 * cannot cite what it was never given a name for, which is a stronger
 * guarantee than an instruction telling it not to.
 *
 * Text is emitted UNMODIFIED for the same reason as everything else here.
 */
export function renderBackgroundMaterial(material: MaterialV1[]): { text: string } {
  const blocks = material.map(
    (atom) =>
      `<background type="${atom.atom_type}" trust="untrusted" citable="no">\n` +
      `${atom.text}\n` +
      `</background>`,
  );
  return { text: blocks.join("\n") };
}
