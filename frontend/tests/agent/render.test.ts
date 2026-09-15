import { describe, expect, it } from "vitest";

import type { MaterialV1 } from "@/agent/contracts/context";
import { renderMaterial } from "@/agent/render";

function atom(partial: Partial<MaterialV1>): MaterialV1 {
  return {
    atom_id: "5b1f9a2c-0000-4000-8000-000000000001",
    atom_type: "claim",
    text: "We launched the leadership programme in March.",
    trust: "untrusted",
    ...partial,
  };
}

describe("renderMaterial", () => {
  it("labels material [M1], [M2], … in order", () => {
    const { text, handles } = renderMaterial([
      atom({ atom_id: "aaa", text: "first" }),
      atom({ atom_id: "bbb", text: "second" }),
    ]);

    expect(text).toContain("[M1]");
    expect(text).toContain("[M2]");
    expect(handles.get("M1")?.atom_id).toBe("aaa");
    expect(handles.get("M2")?.atom_id).toBe("bbb");
  });

  it("never puts a uuid in front of the model", () => {
    // §4.7 mechanism 1. The model transcribing 36 characters is a well-known
    // source of silent corruption, and a corrupted atom_id fails containment in
    // a way that looks like the model hallucinating a citation.
    const { text } = renderMaterial([
      atom({ atom_id: "5b1f9a2c-0000-4000-8000-000000000001" }),
    ]);

    expect(text).not.toContain("5b1f9a2c-0000-4000-8000-000000000001");
    expect(text).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/);
  });

  it("emits atom text byte-identically", () => {
    // §4.7 mechanism 2, and the whole reason this is not "formatting".
    // `checks.py` runs two containment tests that disagree on normalisation:
    // the SPAN check normalises both sides before comparing
    // (`_normalise_for_comparison`, `checks.py:351`), while `claim_text`
    // containment against the post body is byte-exact (`locate_claim`,
    // `checks.py:348`). Emitting atom text unmodified is correct under EITHER
    // regime, so this function's behaviour does not need to know which check
    // is looking at it — but a pretty-printer that turns a straight quote into
    // a curly one still breaks verbatim containment SILENTLY under the
    // byte-exact half, and the resulting rejection points at the model.
    const awkward = 'He said "we doubled" — then paused.\n\tTwice.  Two spaces.';
    const { text, handles } = renderMaterial([atom({ text: awkward })]);

    expect(text).toContain(awkward);
    expect(handles.get("M1")?.text).toBe(awkward);
  });

  it("round-trips every atom's text out of the rendered block", () => {
    // Non-vacuity for the byte-equality claim: extract the text back OUT of the
    // rendered string and compare, rather than trusting that `toContain` on one
    // handcrafted string covers the general case.
    const texts = [
      "plain",
      "with\nnewlines\n",
      "  leading and trailing  ",
      "unicode — em dash, curly ‘quotes’, emoji 🎯",
      // `&`, `<` are exactly what the sibling module `transcript.ts` escapes
      // via `escapeForBody` for bodies it wraps (`>` is deliberately left
      // alone there too — it cannot open a tag, per `transcript.ts`'s own
      // docstring). render.ts must NOT: copy-pasting that helper in here
      // would corrupt every citation containing one of these characters, and
      // pass every other test.
      "Revenue grew 20% & margin > 10% <this> quarter",
    ];
    const { text } = renderMaterial(texts.map((value, index) =>
      atom({ atom_id: `id-${index}`, text: value }),
    ));

    for (const value of texts) {
      // Unescaped survival, specifically: an escaped copy (`&amp;`, `&lt;`,
      // `&gt;`) would also satisfy a looser substring check on a mangled
      // string, so assert the exact original bytes are present.
      expect(text).toContain(value);
    }
    expect(text).not.toContain("&amp;");
    expect(text).not.toContain("&lt;");
    expect(text).not.toContain("&gt;");
  });

  it("wraps each atom in a delimiter that marks it untrusted", () => {
    const { text } = renderMaterial([atom({ atom_type: "claim" })]);

    expect(text).toContain('<material handle="M1" type="claim" trust="untrusted">');
    expect(text).toContain("</material>");
  });

  it("returns an empty string and an empty map for no material", () => {
    const { text, handles } = renderMaterial([]);

    expect(text).toBe("");
    expect(handles.size).toBe(0);
  });

  it("gives two atoms with identical text distinct handles", () => {
    // Deduplicating by text would collapse two atoms into one handle and make
    // one of them uncitable. Handles are positional, not content-derived.
    const { handles } = renderMaterial([
      atom({ atom_id: "aaa", text: "same" }),
      atom({ atom_id: "bbb", text: "same" }),
    ]);

    expect(handles.size).toBe(2);
    expect(handles.get("M1")?.atom_id).toBe("aaa");
    expect(handles.get("M2")?.atom_id).toBe("bbb");
  });
});
