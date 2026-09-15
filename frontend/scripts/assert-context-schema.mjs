import fs from "node:fs";
import path from "node:path";

import { FORBIDDEN_LOCATOR_FIELDS } from "./lib/forbidden-locator-fields.mjs";
import { checkSiblingFixture } from "./lib/sibling-fixture.mjs";

/* ---------------------------------------------------------------------------
 * AMENDMENT 5 — the inbound half, which the spec left unguarded.
 *
 * `context.v1` is Python's, and the TypeScript mirror is hand-written. A
 * hand-written context type drifting quietly in the frontend is the precise
 * shape the handover's §2 guardrail forbids: "It must not create a second
 * context system inside the frontend or a TypeScript wrapper." A missing field
 * makes the agent blind to it; an invented field makes the frontend the author
 * of context rather than its reader.
 * ------------------------------------------------------------------------- */

const root = process.cwd();
const failures = [];
let siblingCompared = false;

const vendoredPath = path.join(root, "src/agent/contracts/context-schema.json");
const mirrorPath = path.join(root, "src/agent/contracts/context.ts");
const siblingPath = path.join(root, "..", "..", "backend", "tests", "fixtures", "context_schema.json");

/** Does `text` declare a field named `name`, optional marker (`?`) or not?
 *  FIX (item 4, 2026-08-24): the previous check was `text.includes(
 *  \`${name}:\`)`, which does not match `source_locator?: string` — the `?`
 *  sits between the name and the colon. That is exactly the form the
 *  reviewer's own B1 mutation used (`source_locator?: string;` on
 *  `MaterialV1`), and it was only ever caught by the invented-field
 *  direction, never by this blacklist. `\b` keeps `document_id` from
 *  matching inside a longer identifier like `document_id_list`. */
function hasLocatorField(text, name) {
  return new RegExp(`\\b${name}\\s*\\??\\s*:`).test(text);
}

/** The invented-field direction (B1): every name the mirror declares must
 *  exist somewhere in the vendored schema's field set. Extracted to a pure
 *  function so the mutation control below drives THIS function — the exact
 *  one the real run calls — rather than re-deriving `Array.prototype.some`
 *  over a synthetic array, which is what the previous, decorative control
 *  did (proved: deleting the real loop left the guard printing success at
 *  exit 0, because the control tested nothing about this file's own code). */
function inventedFieldFailures(declaredNames, schemaFieldSet) {
  const problems = [];
  for (const name of declaredNames) {
    if (!schemaFieldSet.has(name)) {
      problems.push(`context.ts declares ${name} and context.v1 does not — the mirror is inventing a field`);
    }
  }
  return problems;
}

if (!fs.existsSync(vendoredPath)) failures.push("src/agent/contracts/context-schema.json is missing");
if (!fs.existsSync(mirrorPath)) failures.push("src/agent/contracts/context.ts is missing");

if (failures.length === 0) {
  const schema = JSON.parse(fs.readFileSync(vendoredPath, "utf8"));
  const mirror = fs.readFileSync(mirrorPath, "utf8");

  const declared = [...mirror.matchAll(/^\s{2}([A-Za-z_][A-Za-z0-9_]*)\??:/gm)].map((m) => m[1]);
  const declaredSet = new Set(declared);

  const schemaFieldSet = new Set(Object.keys(schema.properties));
  for (const definition of Object.values(schema.$defs ?? {})) {
    for (const name of Object.keys(definition.properties ?? {})) {
      schemaFieldSet.add(name);
    }
  }

  for (const name of Object.keys(schema.properties)) {
    if (!declaredSet.has(name)) {
      failures.push(`context.v1 declares ${name} and the TypeScript mirror does not`);
    }
  }
  for (const [defName, definition] of Object.entries(schema.$defs ?? {})) {
    for (const name of Object.keys(definition.properties ?? {})) {
      if (!declaredSet.has(name)) {
        failures.push(`${defName}.${name} is in context.v1 and not in the mirror`);
      }
    }
  }

  // THE OTHER DIRECTION — B1/finding review, 2026-08-24. The loops above only
  // ever proved schema -> mirror (every field context.v1 declares also
  // appears in context.ts). Nothing stopped the mirror from INVENTING a field
  // context.v1 never declared: an optional field evades `tsc` entirely,
  // because no fixture is ever required to supply it. Proved by the
  // reviewer's mutation — adding `source_locator?: string; document_id?:
  // string;` to `MaterialV1` left `npm run check` at exit 0. `context.v1` is
  // the ALLOWLIST projection built specifically to publish no locator and no
  // `document_id` (spec §4.2/§4.4), so this is the worst possible place for
  // an unchecked direction.
  failures.push(...inventedFieldFailures(declared, schemaFieldSet));

  // The locator blacklist, applied to context.ts as well as draft.ts.
  // `assert-draft-schema.mjs`'s locator blacklist only ever scanned
  // `draft.ts` — this is context.v1's OWN copy of the same scan, sharing the
  // same eleven-name constant so the two cannot diverge.
  for (const name of FORBIDDEN_LOCATOR_FIELDS) {
    if (hasLocatorField(mirror, name)) failures.push(`context.ts declares a locator field: ${name}`);
  }

  // Non-vacuity: an empty parse would pass every loop above.
  if (declared.length < 15) {
    failures.push(`the mirror scan found almost nothing: ${declared.length} fields`);
  }
  // The mirror is a TYPE DECLARATION and nothing more. A function here is the
  // frontend starting to compute context, which is the line itself.
  if (/^\s*export function /m.test(mirror)) {
    failures.push("context.ts declares a function — the mirror must only declare types");
  }

  const siblingResult = checkSiblingFixture({ siblingPath, schema, schemaLabel: "context" });
  siblingCompared = siblingResult.compared;
  failures.push(...siblingResult.failures);
}

/* Mutation control. */
const probe = [...("  atom_id: string;".matchAll(/^\s{2}([A-Za-z_][A-Za-z0-9_]*)\??:/gm))];
if (probe.length === 0) failures.push("mutation control does not trip: the field scan matches nothing");

/* Mutation control for the invented-field direction (B1), driving
 * `inventedFieldFailures` ITSELF rather than re-deriving the membership test
 * over a synthetic array: a name present in the declared set but absent from
 * the schema set must be caught (the exact reviewer mutation — an optional
 * field added to the mirror the vendored schema never declared), and a name
 * present in both must not be. */
{
  const schemaProbe = new Set(["real_field"]);

  const invented = inventedFieldFailures(["real_field", "invented_field"], schemaProbe);
  if (!invented.some((problem) => problem.includes("invented_field"))) {
    failures.push("mutation control does not trip: inventedFieldFailures missed an invented field");
  }

  const clean = inventedFieldFailures(["real_field"], schemaProbe);
  if (clean.length !== 0) {
    failures.push("mutation control is over-broad: inventedFieldFailures flagged a field that IS in the schema");
  }
}

/* Mutation control for the locator blacklist applied to context.ts: a
 * synthetic line carrying a forbidden field name must trip `hasLocatorField`,
 * in BOTH the required and the optional-marker form. The optional form is
 * the one that actually slipped through — the reviewer's own B1 mutation
 * used `source_locator?: string;`. */
{
  const requiredForm = "  source_locator: string;";
  if (!FORBIDDEN_LOCATOR_FIELDS.some((name) => hasLocatorField(requiredForm, name))) {
    failures.push("mutation control does not trip: the context.ts locator blacklist missed the required form");
  }

  const optionalForm = "  source_locator?: string;";
  if (!FORBIDDEN_LOCATOR_FIELDS.some((name) => hasLocatorField(optionalForm, name))) {
    failures.push("mutation control does not trip: the context.ts locator blacklist missed the optional (?) form");
  }
}

/* Mutation control for the cross-repo half (B6): a missing sibling with the
 * opt-out unset must fail and NAME the opt-out; a missing sibling WITH the
 * opt-out set must pass without claiming a comparison happened. Driven
 * against a path that cannot exist, independent of this machine's real
 * directory layout. */
{
  const neverExists = path.join(root, "__assert-context-schema-mutation-control__", "absent.json");
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
  console.error("assert-context-schema failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(
  siblingCompared
    ? "assert-context-schema — the TypeScript mirror reads context.v1 and does not invent it, vendored copy checked against the backend sibling"
    : "assert-context-schema — the TypeScript mirror reads context.v1 and does not invent it (backend sibling NOT compared — ALLOW_MISSING_ENGINE_FIXTURES was set)",
);
