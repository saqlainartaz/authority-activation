import fs from "node:fs";
import path from "node:path";

import { FORBIDDEN_LOCATOR_FIELDS } from "./lib/forbidden-locator-fields.mjs";
import { checkSiblingFixture } from "./lib/sibling-fixture.mjs";

/* ---------------------------------------------------------------------------
 * §4.6 — the single point where two languages could drift silently.
 *
 * The load-bearing assertion is TS payload builder === vendored schema, and it
 * ALWAYS RUNS. The sibling check below is a bonus: when the backend checkout
 * happens to be the parent directory, a stale vendored copy fails hard. It is
 * deliberately NOT the primary assertion, because a check that skips when its
 * target is absent is the decorative assertion this repo's convention forbids —
 * and `CLAUDE.md` has a live example of exactly that decaying.
 *
 * FIX ROUND 1 (2026-08-24). The field-presence scan originally ran against the
 * WHOLE FILE, not `buildDraftPayload`'s own body. Every field name in
 * `draft.ts` also appears in the `Citation`/`ModelCitation` TYPE declarations,
 * so a whole-file `.includes(name + ":")` scan passed even when the builder's
 * own return object stopped setting a field — the exact drift this guard
 * exists to catch. Proven by the literal Step-6 drill: deleting only the
 * `quoted_span:` line from `buildDraftPayload`'s return object stayed green.
 * The scan is now scoped to the function's own extracted text; the
 * type-declaration scan is kept as a SEPARATE, separately-named assertion so
 * the two claims ("the builder sets it" vs. "the type still declares it")
 * stay distinguishable.
 *
 * FIX ROUND 2 (2026-08-24). The type-declaration check from round 1 fixed the
 * WORDING but not the DEFECT: it concatenated all four type blocks
 * (`Citation`, `Draft`, `ModelCitation`, `ModelDraft`) before scanning, so a
 * field name missing from `Citation` alone was still "found" via
 * `ModelCitation`'s copy of the same name — the reviewer proved this by
 * deleting only `Citation`'s `quoted_span: string;` and watching the guard
 * stay green, while deleting `atom_id` (unique to `Citation`, since
 * `ModelCitation` doesn't have it) correctly tripped red. The comment beside
 * the round-1 code claimed a "separate, separately-named assertion" per
 * concern, when the scan was still whole-block, not per-block.
 *
 * Now each of `Draft` and `Citation` is extracted on its own via
 * `extractBracedBlock` and scanned against ONLY its own field list from the
 * vendored schema (`Draft` against `schema.properties`, `Citation` against
 * `schema.$defs.Citation.properties`). `ModelDraft`/`ModelCitation` are the
 * MODEL-facing types — `handle`, not `atom_id` — a deliberately different
 * shape per §4.6, and are correctly never scanned against the wire contract.
 *
 * This is a textual scan, not a type checker, and cannot see e.g. a field
 * present under the wrong TYPE (`quoted_span: number`). `tsc --noEmit` does
 * catch that class of error today, and Task 12 wires a `typecheck` script
 * into the aggregate `check`, making it real defence in depth alongside this
 * guard — not a reason to leave this guard's own scan any looser than it
 * claims to be.
 * ------------------------------------------------------------------------- */

const root = process.cwd();
const failures = [];
let siblingCompared = false;

const vendoredPath = path.join(root, "src/agent/contracts/draft-schema.json");
const builderPath = path.join(root, "src/agent/contracts/draft.ts");
const siblingPath = path.join(root, "..", "..", "backend", "tests", "fixtures", "draft_schema.json");

/**
 * Pure field scan: which of `names` do NOT appear as `${name}:` in
 * `text`. Extracted so the mutation control below can drive it in both
 * directions independently of the real schema/builder on disk — a scan that
 * always finds everything, or always finds nothing, must be caught either way.
 */
function missingFields(text, names) {
  return names.filter((name) => !text.includes(`${name}:`));
}

/** Does `text` declare a field named `name`, optional marker (`?`) or not?
 *  FIX (item 4, 2026-08-24): the previous check was `text.includes(
 *  \`${name}:\`)`, which does not match `source_locator?: string` — the `?`
 *  sits between the name and the colon. That is exactly the form the
 *  reviewer's own B1 mutation used, and it was only ever caught by
 *  assert-context-schema.mjs's invented-field direction, never by this
 *  blacklist. `\b` keeps `document_id` from matching inside a longer
 *  identifier like `document_id_list`. */
function hasLocatorField(text, name) {
  return new RegExp(`\\b${name}\\s*\\??\\s*:`).test(text);
}

/**
 * Extract one braced block's full text — from `marker` through the `{` that
 * follows it, to the MATCHING closing `}` (brace-depth counted, not the first
 * `}` found). Works for `export function NAME(...) { ... }` and for
 * `export type NAME = { ... }` alike, since both are "marker, then a brace
 * block" shapes.
 *
 * This is a depth counter, not a parser — it is fooled by unbalanced braces
 * inside a string or comment, which `draft.ts` does not have. A template
 * literal's `${...}` interpolation is self-balancing (one `{`, one `}`), so it
 * does not upset the count.
 */
function extractBracedBlock(fileText, marker) {
  const start = fileText.indexOf(marker);
  if (start === -1) return null;
  const braceStart = fileText.indexOf("{", start);
  if (braceStart === -1) return null;
  let depth = 0;
  for (let i = braceStart; i < fileText.length; i++) {
    if (fileText[i] === "{") depth++;
    else if (fileText[i] === "}") {
      depth--;
      if (depth === 0) return fileText.slice(start, i + 1);
    }
  }
  return null; // unbalanced — never matched back to depth 0
}

if (!fs.existsSync(vendoredPath)) failures.push("src/agent/contracts/draft-schema.json is missing");
if (!fs.existsSync(builderPath)) failures.push("src/agent/contracts/draft.ts is missing");

if (failures.length === 0) {
  const schema = JSON.parse(fs.readFileSync(vendoredPath, "utf8"));
  const builder = fs.readFileSync(builderPath, "utf8");

  const draftFields = Object.keys(schema.properties).sort();
  const citationFields = Object.keys(schema.$defs.Citation.properties).sort();
  const allFields = [...draftFields, ...citationFields];

  // THE LOAD-BEARING CLAIM: buildDraftPayload's OWN BODY sets every field —
  // scoped to the function's extracted text, not the whole file.
  const functionText = extractBracedBlock(builder, "export function buildDraftPayload");
  if (functionText === null) {
    failures.push("draft.ts's buildDraftPayload body could not be extracted (missing, or unbalanced braces)");
  } else {
    for (const name of missingFields(functionText, allFields)) {
      failures.push(`buildDraftPayload never sets ${name}`);
    }
  }

  // A SEPARATE claim, distinguishable by name and message: the CONTRACT
  // types (`Draft`, `Citation`) still name every field the vendored schema
  // requires of THEM SPECIFICALLY. Scanned PER BLOCK, not concatenated —
  // concatenating would let a field missing from `Citation` alone hide
  // behind `ModelCitation`'s copy of the same name, which is exactly the
  // fix-round-1 comment's false claim that the reviewer caught in round 2.
  // `ModelDraft`/`ModelCitation` are intentionally excluded: they are the
  // model-facing shape (`handle`, not `atom_id`) and are not this contract.
  const draftTypeText = extractBracedBlock(builder, "export type Draft");
  if (draftTypeText === null) {
    failures.push("draft.ts's Draft type declaration could not be extracted");
  } else {
    for (const name of missingFields(draftTypeText, draftFields)) {
      failures.push(`draft.ts's Draft type doesn't declare ${name}`);
    }
  }
  const citationTypeText = extractBracedBlock(builder, "export type Citation");
  if (citationTypeText === null) {
    failures.push("draft.ts's Citation type declaration could not be extracted");
  } else {
    for (const name of missingFields(citationTypeText, citationFields)) {
      failures.push(`draft.ts's Citation type doesn't declare ${name}`);
    }
  }

  if (schema.additionalProperties !== false) {
    failures.push("the Draft schema stopped forbidding additional properties");
  }
  if (!builder.includes("export function buildDraftPayload")) {
    failures.push("draft.ts no longer exports buildDraftPayload");
  }
  // The model must never be handed a locator, and the payload must never carry
  // one back (PROV-01, §4.4). Eleven-name list, shared with
  // assert-context-schema.mjs and tests/agent/contracts.test.ts via
  // `FORBIDDEN_LOCATOR_FIELDS` — this file previously carried its own
  // five-name copy, which is exactly the kind of divergence the shared
  // constant exists to make impossible now.
  for (const name of FORBIDDEN_LOCATOR_FIELDS) {
    if (hasLocatorField(builder, name)) failures.push(`draft.ts declares a locator field: ${name}`);
  }

  const siblingResult = checkSiblingFixture({ siblingPath, schema, schemaLabel: "draft" });
  siblingCompared = siblingResult.compared;
  failures.push(...siblingResult.failures);
}

/* Mutation control, both directions: a scan that always finds everything or
 * always finds nothing would pass every check above vacuously. */
if (missingFields("body: x", ["cited_atom_ids"]).length === 0) {
  failures.push("mutation control does not trip: the field scan found a field that isn't there");
}
if (missingFields("body: x; cited_atom_ids: y", ["body", "cited_atom_ids"]).length !== 0) {
  failures.push("mutation control does not trip: the field scan missed fields that are there");
}

/* Mutation control for the locator blacklist, in BOTH the required and the
 * optional-marker form. The optional form is the one that actually slipped
 * through — the reviewer's own B1 mutation used `source_locator?: string;`,
 * and `text.includes(\`${name}:\`)` does not match it because the `?` sits
 * between the name and the colon. */
{
  const requiredForm = "  source_locator: string;";
  if (!FORBIDDEN_LOCATOR_FIELDS.some((name) => hasLocatorField(requiredForm, name))) {
    failures.push("mutation control does not trip: the draft.ts locator blacklist missed the required form");
  }

  const optionalForm = "  source_locator?: string;";
  if (!FORBIDDEN_LOCATOR_FIELDS.some((name) => hasLocatorField(optionalForm, name))) {
    failures.push("mutation control does not trip: the draft.ts locator blacklist missed the optional (?) form");
  }
}

/* Mutation control for extractBracedBlock: it must capture everything inside
 * its own braces and nothing past the matching close. */
{
  const probe = 'export function buildDraftPayload() { return { a: 1 }; }\nconst outside = { leaked: true };';
  const probeText = extractBracedBlock(probe, "export function buildDraftPayload");
  if (probeText === null || !probeText.includes("a: 1")) {
    failures.push("mutation control does not trip: extractBracedBlock missed text inside its own braces");
  }
  if (probeText === null || probeText.includes("leaked")) {
    failures.push("mutation control does not trip: extractBracedBlock leaked text past its closing brace");
  }
}

/* Mutation control proving the NEW SCOPE actually works — this is fix round
 * 1's regression guard. A synthetic builder body missing a field must be
 * caught by the function-scoped scan EVEN WHEN a type-shaped decoy containing
 * that same field name sits elsewhere in the same probe text. Before this
 * round, a whole-file scan would have found the decoy and passed vacuously —
 * which is exactly what happened to the real `quoted_span` drill. */
{
  const decoy = [
    "export type Decoy = { cited_atom_ids: string };",
    "export function buildDraftPayload() {",
    "  return { body: draft.body };",
    "}",
  ].join("\n");
  const decoyFunctionText = extractBracedBlock(decoy, "export function buildDraftPayload");
  if (decoyFunctionText === null || missingFields(decoyFunctionText, ["cited_atom_ids"]).length === 0) {
    failures.push(
      "mutation control does not trip: the scoped function scan found a field from outside the function",
    );
  }
}

/* Mutation control proving fix round 2's per-type-block scoping actually
 * works. A field missing from the FIRST of two synthetic type blocks, but
 * PRESENT in the second, must still be caught when scanning the first block
 * alone — this is exactly the case the round-1 concatenated-type scan
 * missed: `quoted_span` gone from `Citation` but still in `ModelCitation`. */
{
  const twoBlocks = [
    "export type Citation = { atom_id: string; claim_text: string };",
    "export type ModelCitation = { atom_id: string; quoted_span: string; claim_text: string };",
  ].join("\n");
  const firstBlock = extractBracedBlock(twoBlocks, "export type Citation");
  if (firstBlock === null || missingFields(firstBlock, ["quoted_span"]).length === 0) {
    failures.push(
      "mutation control does not trip: the per-type scan found a field belonging to a different type block",
    );
  }
}

/* Mutation control for the cross-repo half (B6): a missing sibling with the
 * opt-out unset must fail and NAME the opt-out; a missing sibling WITH the
 * opt-out set must pass without claiming a comparison happened. Driven
 * against a path that cannot exist, independent of this machine's real
 * directory layout. */
{
  const neverExists = path.join(root, "__assert-draft-schema-mutation-control__", "absent.json");
  const ambient = process.env.ALLOW_MISSING_ENGINE_FIXTURES;

  delete process.env.ALLOW_MISSING_ENGINE_FIXTURES;
  const withoutOptOut = checkSiblingFixture({ siblingPath: neverExists, schema: {}, schemaLabel: "probe" });
  if (withoutOptOut.compared !== false || withoutOptOut.failures.length === 0) {
    failures.push("mutation control does not trip: a missing sibling passed without the opt-out set");
  }
  if (!withoutOptOut.failures.some((message) => message.includes("ALLOW_MISSING_ENGINE_FIXTURES"))) {
    failures.push("mutation control does not trip: the missing-sibling failure does not name its own opt-out");
  }

  process.env.ALLOW_MISSING_ENGINE_FIXTURES = "1";
  const withOptOut = checkSiblingFixture({ siblingPath: neverExists, schema: {}, schemaLabel: "probe" });
  if (withOptOut.compared !== false || withOptOut.failures.length !== 0) {
    failures.push("mutation control does not trip: the opt-out did not silence the missing-sibling failure");
  }

  if (ambient === undefined) delete process.env.ALLOW_MISSING_ENGINE_FIXTURES;
  else process.env.ALLOW_MISSING_ENGINE_FIXTURES = ambient;
}

if (failures.length > 0) {
  console.error("assert-draft-schema failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(
  siblingCompared
    ? "assert-draft-schema — the outbound payload matches wire.py's Draft, vendored copy checked against the backend sibling"
    : "assert-draft-schema — the outbound payload matches wire.py's Draft (backend sibling NOT compared — ALLOW_MISSING_ENGINE_FIXTURES was set)",
);
