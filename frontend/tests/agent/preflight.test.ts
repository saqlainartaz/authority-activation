import { describe, expect, it } from "vitest";

import type { MaterialV1 } from "@/agent/contracts/context";
import type { ModelDraft } from "@/agent/contracts/draft";
import { preflight } from "@/agent/preflight";
import type { HandleMap } from "@/agent/render";

const ATOM_TEXT = "We launched the leadership programme in March 2026.";

function handles(): HandleMap {
  const atom: MaterialV1 = {
    atom_id: "aaa-uuid",
    atom_type: "claim",
    text: ATOM_TEXT,
    trust: "untrusted",
  };
  return new Map([["M1", atom]]);
}

function draft(partial: Partial<ModelDraft> = {}): ModelDraft {
  return {
    body: "We launched the leadership programme in March 2026. It went well.",
    cited_atom_ids: [
      {
        handle: "M1",
        quoted_span: "launched the leadership programme in March 2026",
        claim_text: "We launched the leadership programme in March 2026.",
      },
    ],
    ...partial,
  };
}

describe("preflight", () => {
  it("passes a well-formed draft", () => {
    expect(preflight(draft(), handles())).toEqual([]);
  });

  it("catches a handle that does not resolve", () => {
    const problems = preflight(
      draft({ cited_atom_ids: [{ handle: "M9", quoted_span: "x", claim_text: "y" }] }),
      handles(),
    );

    expect(problems.map((item) => item.kind)).toContain("unknown_handle");
  });

  it("catches a quoted span that is not in its atom", () => {
    const problems = preflight(
      draft({
        cited_atom_ids: [
          { handle: "M1", quoted_span: "we tripled revenue", claim_text: "It went well." },
        ],
      }),
      handles(),
    );

    expect(problems.map((item) => item.kind)).toContain("span_not_in_atom");
  });

  it("catches a quoted span whose wording genuinely differs from the atom, not just its formatting", () => {
    // RECONCILED 2026-08-24 against `product/generation/checks.py`. The brief's
    // original fixture for this test was a whitespace-only difference
    // ("launched  the leadership programme", double space) on the theory that
    // `checks.py`'s span check is "byte-exact... never normalised". That theory
    // is wrong: `checks.py`'s own module docstring says "NORMALISE FOR
    // COMPARISON ONLY, NEVER FOR STORAGE" (checks.py:66-69), and
    // `_normalise_for_comparison` (checks.py:351-394) — NFC, then a strip of
    // characters that render as nothing, then an 11-entry typographic fold,
    // then whitespace-run collapse — runs on BOTH sides of the span-containment
    // test (checks.py:682-692) before comparing. A neighbouring Python test
    // proves it directly:
    // `test_a_span_that_differs_only_by_a_curly_apostrophe_is_accepted`
    // (tests/test_draft_checks.py:249) — "The SPAN check normalises; the CLAIM
    // check does not, and the asymmetry is the whole design." So a
    // whitespace-only difference is NOT a server-side rejection, and this
    // fixture is now a genuine wording difference ("a leadership" vs. "the
    // leadership") that survives normalisation and is still rejected by
    // Python — see the companion test below for the whitespace-tolerant case
    // this replaced.
    const problems = preflight(
      draft({
        cited_atom_ids: [
          { handle: "M1", quoted_span: "launched a leadership programme", claim_text: "It went well." },
        ],
      }),
      handles(),
    );

    expect(problems.map((item) => item.kind)).toContain("span_not_in_atom");
  });

  it("does not reject a span that differs from its atom only by a collapsed whitespace run, matching checks.py's own normalisation", () => {
    // The positive half of the reconciliation above: pre-flight must be no
    // STRICTER than the server either, or it burns the model's one correction
    // on a span Python was always going to accept.
    const problems = preflight(
      draft({
        cited_atom_ids: [
          {
            handle: "M1",
            // Extra internal spaces collapse under `_normalise_for_comparison`
            // just as they do in `checks.py`, so this is a real substring of
            // the atom once normalised.
            quoted_span: "launched  the   leadership programme",
            claim_text: "It went well.",
          },
        ],
      }),
      handles(),
    );

    expect(problems).toEqual([]);
  });

  it("does not reject a span that differs from its atom only by a curly apostrophe, matching checks.py's typographic fold", () => {
    // B5: the ported eleven-entry TYPOGRAPHIC_FOLD had zero test coverage —
    // proved by the reviewer replacing normaliseForComparison's whole body
    // (fold and format-character strip both deleted) with a bare NFC +
    // whitespace-collapse + trim, and watching all 63 tests stay green. This
    // is the fold's own test: `checks.py`'s neighbouring
    // `test_a_span_that_differs_only_by_a_curly_apostrophe_is_accepted`
    // (`tests/test_draft_checks.py:249`) names the asymmetry directly — "The
    // SPAN check normalises; the CLAIM check does not."
    const curlyHandles: HandleMap = new Map([
      [
        "M1",
        {
          atom_id: "ccc-uuid",
          atom_type: "claim",
          text: "The team's programme launched well.",
          trust: "untrusted",
        },
      ],
    ]);

    const problems = preflight(
      draft({
        body: "The team's programme launched well. It went well.",
        cited_atom_ids: [
          {
            handle: "M1",
            // Curly apostrophe (’), where the atom has a straight one (').
            quoted_span: "team’s programme launched",
            claim_text: "It went well.",
          },
        ],
      }),
      curlyHandles,
    );

    expect(problems).toEqual([]);
  });

  it("does not reject a span carrying a zero-width space, matching checks.py's format-character strip", () => {
    // The other half of B5's coverage gap: `_normalise_for_comparison` strips
    // Unicode format characters (category Cf, which a zero-width space
    // belongs to) before comparing — a deletion of that strip alone, with the
    // fold left intact, would also have passed every pre-existing test.
    const zeroWidthHandles: HandleMap = new Map([
      [
        "M1",
        {
          atom_id: "ddd-uuid",
          atom_type: "claim",
          text: "We launched the programme early this year.",
          trust: "untrusted",
        },
      ],
    ]);

    const problems = preflight(
      draft({
        body: "We launched the programme early this year. It went well.",
        cited_atom_ids: [
          {
            handle: "M1",
            // Zero-width space (U+200B) inside the span; the atom has none.
            quoted_span: "laun​ched the programme",
            claim_text: "It went well.",
          },
        ],
      }),
      zeroWidthHandles,
    );

    expect(problems).toEqual([]);
  });

  it("catches a claim_text that is not in the body", () => {
    const problems = preflight(
      draft({
        cited_atom_ids: [
          {
            handle: "M1",
            quoted_span: "launched the leadership programme",
            claim_text: "a sentence the post does not contain",
          },
        ],
      }),
      handles(),
    );

    expect(problems.map((item) => item.kind)).toContain("claim_not_in_body");
  });

  it("catches an empty claim_text as its own named kind, never as claim_not_in_body", () => {
    // FIX ROUND 1, 2026-08-24. `draft.body.includes("")` is `true` for every
    // body in JavaScript, so without a dedicated check an empty `claim_text`
    // silently passed every check here while `checks.py:725-729` rejects it
    // server-side as `claim_text_empty`, ahead of the containment test. The
    // handle and span below are both otherwise valid, so the case cannot pass
    // for one of the other reasons — matching
    // `test_an_empty_claim_text_is_rejected_as_its_own_named_kind`
    // (`tests/test_draft_checks.py:368`).
    const problems = preflight(
      draft({
        cited_atom_ids: [
          {
            handle: "M1",
            quoted_span: "launched the leadership programme",
            claim_text: "",
          },
        ],
      }),
      handles(),
    );

    expect(problems.map((item) => item.kind)).toContain("claim_text_empty");
    expect(problems.map((item) => item.kind)).not.toContain("claim_not_in_body");
  });

  it("admits a whitespace-only claim_text, matching checks.py's deliberate boundary", () => {
    // Python's `not citation.claim_text` is `False` for `" "` — a non-empty
    // string is truthy regardless of content — so a whitespace-only claim
    // falls through to `locate_claim` and is admitted when the body contains
    // that whitespace
    // (`test_a_whitespace_only_claim_is_admitted_and_that_is_the_deliberate_boundary`,
    // `tests/test_draft_checks.py:421`). `draft().body` contains plenty of
    // spaces, so this must be admitted, not treated as empty.
    const problems = preflight(
      draft({
        cited_atom_ids: [
          {
            handle: "M1",
            quoted_span: "launched the leadership programme",
            claim_text: " ",
          },
        ],
      }),
      handles(),
    );

    expect(problems).toEqual([]);
  });

  it("catches a span below the length floor", () => {
    // Floor reconciled to 8 (`checks.py:189`'s `SPAN_MIN_CHARS`), not 12 — see
    // `src/agent/preflight.ts`'s header comment. "in" is 2 characters either
    // way, so this fixture is unaffected by the correction.
    const problems = preflight(
      draft({
        cited_atom_ids: [
          { handle: "M1", quoted_span: "in", claim_text: "It went well." },
        ],
      }),
      handles(),
    );

    expect(problems.map((item) => item.kind)).toContain("span_too_short");
  });

  it("catches a span below the code-point floor even when its UTF-16 unit length clears it", () => {
    // Python's `len(span)` counts code points; a naive `.length` in JS counts
    // UTF-16 code units, and the divergence is LENIENT — exactly the wrong
    // direction. "🎯🎯🎯🎯🎯" is 5 code points (below the floor of 8, and so
    // rejected by `checks.py:683`) but 10 UTF-16 units (clears 8, so a
    // `.length` check here would wrongly admit it). Same shape as LinkedIn's
    // math-bold convention, e.g. "𝐝𝐨𝐮𝐛𝐥𝐞" (6 code points, 12 units).
    const emojiAtom: MaterialV1 = {
      atom_id: "bbb-uuid",
      atom_type: "claim",
      text: "🎯🎯🎯🎯🎯 is the target emoji.",
      trust: "untrusted",
    };
    const emojiHandles: HandleMap = new Map([["M1", emojiAtom]]);

    const problems = preflight(
      draft({
        cited_atom_ids: [{ handle: "M1", quoted_span: "🎯🎯🎯🎯🎯", claim_text: "It went well." }],
      }),
      emojiHandles,
    );

    expect(problems.map((item) => item.kind)).toContain("span_too_short");
  });

  it("catches a draft with no citations at all", () => {
    const problems = preflight(draft({ cited_atom_ids: [] }), handles());

    expect(problems.map((item) => item.kind)).toContain("no_citations");
  });

  it("reports every problem rather than the first", () => {
    // One round trip per problem would burn the tool ceiling. The model should
    // see the whole list and fix it in one rewrite.
    const problems = preflight(
      draft({
        cited_atom_ids: [
          { handle: "M9", quoted_span: "x", claim_text: "nope" },
          { handle: "M1", quoted_span: "not in the atom", claim_text: "also nope" },
        ],
      }),
      handles(),
    );

    expect(problems.length).toBeGreaterThanOrEqual(3);
  });

  it("names the offending citation in the detail", () => {
    const [problem] = preflight(
      draft({ cited_atom_ids: [{ handle: "M9", quoted_span: "x", claim_text: "y" }] }),
      handles(),
    );

    expect(problem.detail).toContain("M9");
  });
});
