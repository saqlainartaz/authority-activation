import { describe, expect, it } from "vitest";

import type { MaterialV1 } from "@/agent/contracts/context";
import {
  AppendOnlyHandles,
  renderMaterial,
  renderServerMaterial,
} from "@/agent/render";

/**
 * The append-only handle namespace, and the defect it replaces.
 *
 * D8: "a second search must not reassign yesterday's M1 to new text." Under
 * `context.v1` the executor does `state.handles = rendered.handles` on every
 * prepare — a fresh Map replacing the old one — and `renderMaterial` mints
 * `M{index+1}` from position. Two reads therefore both call their first item
 * `M1`, and a citation written against the first read silently points at the
 * second read's material. Nothing errors; the draft just cites the wrong
 * thing, with a receipt.
 *
 * The control test below reproduces exactly that on the v1 path, so the
 * append-only assertions are measured against a real failure rather than a
 * hypothetical one.
 */

function material(id: string, text: string): MaterialV1 {
  return { atom_id: id, atom_type: "insight", text, trust: "untrusted" };
}

describe("the v1 handle map reassigns, which is the defect", () => {
  it("gives two different reads the same handle for different text", () => {
    const first = renderMaterial([material("a1", "Membership costs 49.")]);
    const second = renderMaterial([material("a2", "We closed for renovations.")]);

    expect(first.handles.get("M1")?.text).toBe("Membership costs 49.");
    expect(second.handles.get("M1")?.text).toBe("We closed for renovations.");
    // Same label, different material, no error anywhere. This is what the
    // append-only namespace exists to make impossible.
    expect(first.handles.get("M1")).not.toEqual(second.handles.get("M1"));
  });
});

describe("the c4 append-only namespace", () => {
  it("keeps a handle bound to the material it was issued for", () => {
    const handles = new AppendOnlyHandles();
    handles.set("K1", material("a1", "Membership costs 49."));
    handles.set("E2", material("a2", "We closed for renovations."));

    expect(handles.get("K1")?.text).toBe("Membership costs 49.");
    expect(handles.size).toBe(2);
  });

  it("refuses to rebind a handle to different material", () => {
    // Loudly, not silently. A silent overwrite is the bug; a thrown error is
    // a bug report.
    const handles = new AppendOnlyHandles();
    handles.set("K1", material("a1", "Membership costs 49."));

    expect(() => handles.set("K1", material("a2", "Something else."))).toThrow(
      /already bound/,
    );
    expect(handles.get("K1")?.text).toBe("Membership costs 49.");
  });

  it("allows the same binding to be re-exposed", () => {
    // A later read legitimately returns material the model already holds, and
    // the server re-issues the same handle for it by design. Treating that as
    // a collision would make ordinary re-reading an error.
    const handles = new AppendOnlyHandles();
    handles.set("K1", material("a1", "Membership costs 49."));

    expect(() => handles.set("K1", material("a1", "Membership costs 49."))).not.toThrow();
    expect(handles.size).toBe(1);
  });

  it("survives a second read that adds to it", () => {
    const handles = new AppendOnlyHandles();
    renderServerMaterial([{ handle: "K1", atom: material("a1", "First read.") }], handles);
    renderServerMaterial([{ handle: "K2", atom: material("a2", "Second read.") }], handles);

    expect(handles.get("K1")?.text).toBe("First read.");
    expect(handles.get("K2")?.text).toBe("Second read.");
    expect(handles.size).toBe(2);
  });

  it("hands out a copy, so a caller cannot mutate the namespace through it", () => {
    const handles = new AppendOnlyHandles();
    handles.set("K1", material("a1", "Membership costs 49."));

    const view = handles.asMap();
    view.set("K1", material("a2", "Rewritten."));

    expect(handles.get("K1")?.text).toBe("Membership costs 49.");
  });
});

describe("server-issued handles", () => {
  it("renders the handle it was given rather than minting one", () => {
    // The whole point: the label comes from `ke/retrieval/views.py`, issued
    // once and stable for the life of the view, so two reads cannot disagree
    // about what K3 means.
    const handles = new AppendOnlyHandles();
    const { text } = renderServerMaterial(
      [{ handle: "K7", atom: material("a1", "Membership costs 49.") }],
      handles,
    );

    expect(text).toContain('handle="K7"');
    expect(text).toContain("[K7]");
    expect(text).not.toContain("M1");
  });

  it("emits the text unmodified", () => {
    // Escaping or re-wrapping here would move the bytes away from whatever is
    // comparing them downstream and break every quote silently.
    const body = 'He said "49 & rising" <loudly>';
    const handles = new AppendOnlyHandles();
    const { text } = renderServerMaterial(
      [{ handle: "K1", atom: material("a1", body) }],
      handles,
    );

    expect(text).toContain(body);
  });

  it("does not deduplicate identical text under different handles", () => {
    // Two items with the same words are two citable things. Collapsing them
    // would make one uncitable.
    const handles = new AppendOnlyHandles();
    renderServerMaterial(
      [
        { handle: "K1", atom: material("a1", "Same words.") },
        { handle: "K2", atom: material("a2", "Same words.") },
      ],
      handles,
    );

    expect(handles.size).toBe(2);
  });
});
