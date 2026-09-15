import { describe, expect, it } from "vitest";

import type { MaterialV1 } from "@/agent/contracts/context";
import { buildDraftPayload, type ModelDraft } from "@/agent/contracts/draft";
import type { HandleMap } from "@/agent/render";

function handleMap(entries: Record<string, string>): HandleMap {
  const map: HandleMap = new Map();
  for (const [handle, atomId] of Object.entries(entries)) {
    const atom: MaterialV1 = {
      atom_id: atomId,
      atom_type: "claim",
      text: "some material",
      trust: "untrusted",
    };
    map.set(handle, atom);
  }
  return map;
}

const draft: ModelDraft = {
  body: "We launched in March.",
  cited_atom_ids: [
    { handle: "M1", quoted_span: "launched in March", claim_text: "We launched in March." },
  ],
};

describe("buildDraftPayload", () => {
  it("substitutes the real atom_id for the handle", () => {
    const payload = buildDraftPayload(draft, handleMap({ M1: "aaa-uuid" }));

    expect(payload.cited_atom_ids[0].atom_id).toBe("aaa-uuid");
  });

  it("produces exactly the Draft field set and nothing else", () => {
    // §4.6: this is the PYTHON-FACING payload, and it must be field-identical to
    // `wire.py`'s Draft/Citation. `scripts/assert-draft-schema.mjs` pins the same
    // property against the vendored schema; this pins it against a real call.
    const payload = buildDraftPayload(draft, handleMap({ M1: "aaa-uuid" }));

    expect(Object.keys(payload).sort()).toEqual(["body", "cited_atom_ids"]);
    expect(Object.keys(payload.cited_atom_ids[0]).sort()).toEqual([
      "atom_id", "claim_text", "quoted_span",
    ]);
  });

  it("carries no `handle` field through to Python", () => {
    // The handle is a runtime concept. Leaking it would make the payload a
    // superset of `Draft`, and `Draft` is `additionalProperties: false`.
    const payload = buildDraftPayload(draft, handleMap({ M1: "aaa-uuid" }));

    expect(JSON.stringify(payload)).not.toContain("handle");
    expect(JSON.stringify(payload)).not.toContain("M1");
  });

  it("throws on a handle that does not resolve", () => {
    // Never silently drop a citation. A dropped citation is how a draft arrives
    // at Python with fewer claims than the model made, passes the citation floor
    // on the survivors, and ships an uncited assertion.
    expect(() => buildDraftPayload(draft, handleMap({ M2: "bbb-uuid" }))).toThrow(
      /M1/,
    );
  });

  it("copies spans and claims byte-for-byte", () => {
    // E5, 2026-08-24: the fixture used to carry no `&`, `<`, `>` — exactly the
    // characters the sibling module `transcript.ts` escapes via
    // `escapeForBody` for the bodies IT wraps. This payload builder must NOT:
    // Python byte-compares `claim_text` against the body (`locate_claim`) and
    // the model's `quoted_span` against atom text, so an HTML-escaped copy
    // would corrupt every citation containing one of these characters and
    // fail containment silently, exactly as the sibling module's own docs
    // warn against doing to rendered material.
    const awkward = 'he said "we doubled" — twice & grew 20% <link> more';
    const payload = buildDraftPayload(
      {
        body: `A post. ${awkward}. The end.`,
        cited_atom_ids: [{ handle: "M1", quoted_span: awkward, claim_text: awkward }],
      },
      handleMap({ M1: "aaa-uuid" }),
    );

    expect(payload.cited_atom_ids[0].quoted_span).toBe(awkward);
    expect(payload.cited_atom_ids[0].claim_text).toBe(awkward);
    // Unescaped survival, specifically: an escaped copy (`&amp;`, `&lt;`,
    // `&gt;`) would also satisfy a looser substring check on a mangled
    // string, so assert the exact original bytes are present and no escaped
    // form crept in.
    expect(payload.cited_atom_ids[0].quoted_span).toContain("&");
    expect(payload.cited_atom_ids[0].quoted_span).toContain("<link>");
    expect(JSON.stringify(payload)).not.toContain("&amp;");
    expect(JSON.stringify(payload)).not.toContain("&lt;");
    expect(JSON.stringify(payload)).not.toContain("&gt;");
  });

  it("keeps the body exactly as the model wrote it", () => {
    // The body is what `body_sha256` is computed over and what `locate_claim`
    // takes offsets into. Trimming it here would hand Python a body that is not
    // the one the offsets describe.
    const body = "  leading space, trailing newline\n";
    const payload = buildDraftPayload(
      { body, cited_atom_ids: [] },
      handleMap({}),
    );

    expect(payload.body).toBe(body);
  });
});
