import "server-only";

import type { ModelDraft } from "@/agent/contracts/draft";
import type { HandleMap } from "@/agent/render";

/**
 * §4.7 mechanism 3 — a faster error message, and nothing else.
 *
 * PRE-FLIGHT HAS NO AUTHORITY. Python re-validates everything against the
 * STORED snapshot regardless (§6.1 step 1), and this must never be presented as
 * a reason to relax that. The erosion §5.3 describes for streaming arrives here
 * by a different route: "the runtime already checked it" is how a server-side
 * guarantee quietly becomes advisory.
 *
 * What it buys is real all the same: a problem caught here is returned to the
 * model immediately, with no Python round trip and WITHOUT CONSUMING one of
 * §5.5's two `submit_draft` attempts, because it never reached Python.
 *
 * RECONCILED AGAINST `product/generation/checks.py` DIRECTLY (2026-08-24), not
 * assumed from a stated default. Two things the reconciliation actually
 * changed:
 *
 * 1. THE FLOOR IS 8, NOT 12. `checks.py:189`'s `SPAN_MIN_CHARS = 8` is the real
 *    server-side minimum. See `DEFAULT_MINIMUM_SPAN` below.
 * 2. THE SPAN CHECK NORMALISES — IT IS NOT BYTE-EXACT. `checks.py`'s module
 *    docstring reads "NORMALISE FOR COMPARISON ONLY, NEVER FOR STORAGE"
 *    (`checks.py:66-69`), and `_normalise_for_comparison`
 *    (`checks.py:351-394`) — NFC, then a strip of the characters that render
 *    as nothing, then an 11-entry typographic fold, then whitespace-run
 *    collapse — runs on BOTH the length floor and the containment test for
 *    `quoted_span` (`checks.py:682-692`), before either is evaluated. A
 *    neighbouring Python test names the asymmetry directly:
 *    `test_a_span_that_differs_only_by_a_curly_apostrophe_is_accepted`
 *    (`tests/test_draft_checks.py:249`) — "The SPAN check normalises; the
 *    CLAIM check does not, and the asymmetry is the whole design." A
 *    preflight that treated the span as byte-exact would be STRICTER than
 *    Python in exactly that case — safe in direction, but it would spend the
 *    model's one correction rejecting a span the server was always going to
 *    accept, for a reason that is not real. `normaliseForComparison` below is
 *    a direct port of `_normalise_for_comparison`, kept under a matching name
 *    so the two stay easy to diff against each other.
 *
 * `claim_text` containment is the OTHER half of that asymmetry and IS
 * genuinely byte-exact, matching `locate_claim` (`checks.py:326-348`, `body.
 * find` and nothing else) — plan 05-09's stored character offsets index the
 * body exactly as the provider returned it, so no normalisation is applied
 * there, on either side.
 *
 * 3. AN EMPTY `claim_text` HAS ITS OWN NAMED KIND, CHECKED BEFORE CONTAINMENT
 *    — FIX ROUND 1, 2026-08-24. `"".includes("")` is `true` in every string in
 *    JavaScript, so `draft.body.includes(citation.claim_text)` never fires on
 *    an empty `claim_text` — that is a JavaScript artefact of `.includes`, not
 *    "the claim is a real substring of the body" in the sense this check
 *    means. Python has a dedicated branch for exactly this, ahead of
 *    `locate_claim` (`checks.py:725-729`):
 *
 *      if not citation.claim_text:
 *          return DraftRejection(kind=REJECTION_CLAIM_TEXT_EMPTY, ...)
 *
 *    and its own module docstring records why: before this branch existed, an
 *    empty `claim_text` slipped past every check, reached the receipt writer
 *    as `body_end == body_start`, and `content_claims_body_span_ck` refused
 *    the row — taking the WHOLE transaction down with a raw Postgres 23514
 *    instead of producing a named, held rejection (`checks.py:119-132`). A
 *    pre-flight that let this through would send the model to `submit_draft`
 *    believing the draft was clean, burning one of only two attempts on
 *    exactly the failure this module exists to catch for free.
 *
 *    WHITESPACE-ONLY IS NOT EMPTY, AND THAT BOUNDARY IS DELIBERATE ON BOTH
 *    SIDES. Python's `not citation.claim_text` is `False` for `" "` — a
 *    non-empty string is truthy regardless of content — so a whitespace-only
 *    claim falls through to `locate_claim` and is ADMITTED if the body
 *    contains that whitespace, per
 *    `test_a_whitespace_only_claim_is_admitted_and_that_is_the_deliberate_boundary`
 *    (`tests/test_draft_checks.py:421-441`): "A one-character claim is
 *    degenerate but it is REPRESENTABLE... Rejecting it would mean deciding
 *    how short a claim is too short — a second judgement about the same text
 *    D-06 explicitly refused to make." `citation.claim_text === ""` below
 *    draws the identical line: `" "` is not `""`, so it is left to the
 *    containment check exactly as Python leaves it to `locate_claim`.
 *
 * PRE-FLIGHT MIRRORS FOUR OF PYTHON'S SEVEN REJECTION KINDS —
 * `span_not_verbatim` (as two kinds here, `span_not_in_atom` /
 * `span_too_short`, split because a model correcting one needs to know which),
 * `claim_not_in_body`, `claim_text_empty`, and `no_valid_citation` (here
 * `no_citations`) — plus `unknown_handle`, which has no Python analogue: it
 * fires on a handle that never resolves to material at all, a TypeScript-only
 * concept upstream of the uuid `citation_absent` tests in Python.
 * `control_characters` and `blacklist_phrase` are DELIBERATELY NOT covered
 * here — both are server-only checks over data pre-flight does not have
 * (the client's banned-phrase list, full Unicode-category screening of the
 * whole body), not a gap to close later.
 *
 * Every check below is at least as strict as the server's. A pre-flight more
 * lenient than the server is worse than no pre-flight: it approves a draft
 * the server will reject, and spends the single correction doing it.
 */

export type PreflightProblem = {
  kind:
    | "unknown_handle"
    | "span_not_in_atom"
    | "claim_not_in_body"
    | "span_too_short"
    | "claim_text_empty"
    | "no_citations";
  detail: string;
};

/** `checks.py:189`'s `SPAN_MIN_CHARS`, reconciled 2026-08-24 (this file
 *  previously assumed 12). Measured on the NORMALISED span
 *  (`normaliseForComparison`), never the raw one — `checks.py:375-376` is
 *  explicit that the floor is measured on the normalised value specifically
 *  so whitespace padding cannot buy a citation past it. A raw-length check
 *  here would be more lenient than Python's in exactly that case. Kept as an
 *  option so a further server change is a one-line follow-up here rather than
 *  a hunt through the file. */
const DEFAULT_MINIMUM_SPAN = 8;

/** `checks.py:213-227`'s `TYPOGRAPHIC_FOLD`, copied entry for entry and in the
 *  same order. A model that tidies a quote mark has not changed what it said. */
const TYPOGRAPHIC_FOLD: ReadonlyArray<readonly [string, string]> = [
  ["‘", "'"], // left single quotation mark
  ["’", "'"], // right single quotation mark / curly apostrophe
  ["‚", "'"], // single low-9 quotation mark
  ["“", '"'], // left double quotation mark
  ["”", '"'], // right double quotation mark
  ["„", '"'], // double low-9 quotation mark
  ["–", "-"], // en dash
  ["—", "-"], // em dash
  ["−", "-"], // minus sign
  [" ", " "], // non-breaking space
  ["…", "..."], // horizontal ellipsis
];

/** `checks.py:269`'s `_FORBIDDEN_CATEGORIES` (`Cc`, `Cf`, `Zl`, `Zp`), minus
 *  `\n`/`\t`, which `checks.py:276`'s `_ALLOWED_CONTROL_CHARACTERS` carves
 *  back out. JS's `\p{...}` Unicode property escapes (ES2018) give the same
 *  category test natively — no lookup table, no new dependency. */
const FORBIDDEN_FORMAT_CHARACTER = /^[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]$/u;
const ALLOWED_CONTROL_CHARACTERS = new Set(["\n", "\t"]);

const WHITESPACE_RUN = /\s+/g;

/**
 * Port of `checks.py:351-394`'s `_normalise_for_comparison`, comparison path
 * only — the result is never stored or shown to anyone, exactly as on the
 * Python side. Order matters and is copied verbatim: NFC, then the
 * format-character strip, then the typographic fold, then whitespace-run
 * collapse and trim. No casefold: `checks.py` only casefolds for the
 * blacklist check, which is out of scope here — pre-flight covers six
 * problem kinds (see `PreflightProblem["kind"]` above), not the server's
 * seven.
 */
function normaliseForComparison(value: string): string {
  let folded = value.normalize("NFC");
  folded = Array.from(folded)
    .filter(
      (character) =>
        ALLOWED_CONTROL_CHARACTERS.has(character) || !FORBIDDEN_FORMAT_CHARACTER.test(character),
    )
    .join("");
  for (const [character, replacement] of TYPOGRAPHIC_FOLD) {
    folded = folded.split(character).join(replacement);
  }
  return folded.replace(WHITESPACE_RUN, " ").trim();
}

export function preflight(
  draft: ModelDraft,
  handles: HandleMap,
  options: { minimumSpan?: number } = {},
): PreflightProblem[] {
  const minimumSpan = options.minimumSpan ?? DEFAULT_MINIMUM_SPAN;
  const problems: PreflightProblem[] = [];

  if (draft.cited_atom_ids.length === 0) {
    problems.push({
      kind: "no_citations",
      detail: "the draft cites nothing; every claim needs material behind it",
    });
  }

  for (const citation of draft.cited_atom_ids) {
    const atom = handles.get(citation.handle);
    if (atom === undefined) {
      problems.push({
        kind: "unknown_handle",
        detail: `${citation.handle} is not one of the handles you were shown`,
      });
      continue;
    }

    // `checks.py:682-692`: both the floor and the containment test run on the
    // NORMALISED span, and containment is tested against the NORMALISED atom
    // text — never the raw one.
    const normalisedSpan = normaliseForComparison(citation.quoted_span);
    const normalisedAtomText = normaliseForComparison(atom.text);

    if (!normalisedAtomText.includes(normalisedSpan)) {
      problems.push({
        kind: "span_not_in_atom",
        detail: `${citation.handle}: the quoted span is not a verbatim slice of that material`,
      });
    }
    if (Array.from(normalisedSpan).length < minimumSpan) {
      problems.push({
        kind: "span_too_short",
        detail: `${citation.handle}: the quoted span is shorter than ${minimumSpan} characters`,
      });
    }
    // Checked BEFORE containment, mirroring `checks.py:725-729`'s branch
    // ahead of `locate_claim`. `"".includes("")` is always `true` in
    // JavaScript, so without this the containment check below can never
    // catch an empty `claim_text` — see the header comment for why that is
    // exactly the failure mode this module exists to prevent. `" "` is NOT
    // empty and falls through to containment, matching Python's `not
    // citation.claim_text` being `False` for a non-empty string.
    if (citation.claim_text === "") {
      problems.push({
        kind: "claim_text_empty",
        detail: `${citation.handle}: the claim text is empty`,
      });
    } else if (!draft.body.includes(citation.claim_text)) {
      // BYTE-EXACT, unlike the span checks above — mirrors `locate_claim`
      // (`checks.py:326-348`), which is `body.find` and nothing else.
      problems.push({
        kind: "claim_not_in_body",
        detail: `${citation.handle}: the claim text does not appear in the post body`,
      });
    }
  }

  return problems;
}
