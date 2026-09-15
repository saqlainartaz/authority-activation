import fs from "node:fs";
import path from "node:path";

/* ---------------------------------------------------------------------------
 * §5.3. The event union has NO field for a draft body at any depth — `wire.py`'s
 * technique applied in the other direction: not "we don't send it" but "there is
 * nowhere to put it". If the body streamed into the card, then at the instant
 * the last token lands the card holds a post that has passed zero checks, whose
 * receipt cannot exist yet. And it creates standing pressure to make validation
 * advisory, which is how the guarantee dies without anyone deciding to kill it.
 *
 * `message.delta.text` is the agent's own words — conversation, not post body —
 * and is the one text field this file deliberately permits, and ONLY on that
 * one member.
 *
 * FIX ROUND (B2, 2026-08-24). The previous version scanned the WHOLE FILE for
 * `BODY_SHAPED` field names and could never include `text` in that list,
 * because `message.delta` legitimately carries it. That made `text` on ANY
 * OTHER member invisible: the reviewer proved it by adding
 * `| { type: "draft.preview"; text: string }` to `AgentEvent` and watching
 * this guard, `npm run check`, and all 63 tests stay green. Nothing tied the
 * union's discriminants to `EVENT_NAMES` either, so the `EVENT_NAMES` pinning
 * test in `tests/agent/events.test.ts` could not see the new member.
 *
 * The fix has two parts. `src/agent/events.ts` (as it stood at the time of
 * this fix — the same type machinery now lives in `src/lib/agent-events.ts`,
 * moved there at §9 step 5 so the browser could import it; see the re-export
 * check below) declares each member's `type` against `EventName` via an
 * `Event<T, Extra>` helper, so a member with a `type` outside `EVENT_NAMES`
 * is a compile error — which forces the new name into the list, and the
 * existing pinning test then catches it.
 * This file's scan is now PER UNION MEMBER: `text` is permitted only on the
 * member whose discriminant is `message.delta`, and every `BODY_SHAPED` name
 * remains forbidden everywhere, on every member.
 * ------------------------------------------------------------------------- */

const root = process.cwd();
const failures = [];
// The union moved to a client-importable module (§9 step 5) — see that
// file's own doc comment. This guard follows it there.
const relative = "src/lib/agent-events.ts";
const absolute = path.join(root, relative);

const BODY_SHAPED = ["body", "draft", "content", "post", "copy", "markdown", "html"];
const MESSAGE_DELTA = "message.delta";

/** Field declarations only, same rationale as before: `type: "draft.ready"` is
 *  a discriminant value, not a field, so callers must strip the discriminant
 *  out of `text` before calling this — which every call site below does. */
function declaredFields(text) {
  return [...text.matchAll(/([A-Za-z_][A-Za-z0-9_]*)\s*\??:/g)].map((m) => m[1]);
}

/** Strip block and line comments so a comment's prose can never be mistaken
 *  for union-member syntax during the depth-aware split below. */
function stripComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

/** Split `text` on `separator` at bracket depth 0 — `{`, `<`, `(` open;
 *  `}`, `>`, `)` close, all sharing one counter since this file never needs
 *  to tell them apart, only to know when it is back at top level. */
function splitTopLevel(text, separator) {
  const parts = [];
  let depth = 0;
  let current = "";
  for (const char of text) {
    if (char === "{" || char === "<" || char === "(") depth++;
    else if (char === "}" || char === ">" || char === ")") depth--;
    if (char === separator && depth === 0) {
      parts.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  parts.push(current);
  return parts;
}

/** Extract the text of a `export type NAME = <union>;` declaration, from just
 *  after `marker` up to (not including) the terminating top-level `;`. Depth
 *  counted the same way as `splitTopLevel` so a `;` inside a member's braces
 *  (there are none today, but nothing should rely on that) cannot end it early. */
function extractDeclarationBody(fileText, marker) {
  const start = fileText.indexOf(marker);
  if (start === -1) return null;
  let depth = 0;
  for (let i = start + marker.length; i < fileText.length; i++) {
    const char = fileText[i];
    if (char === "{" || char === "<" || char === "(") depth++;
    else if (char === "}" || char === ">" || char === ")") depth--;
    else if (char === ";" && depth === 0) return fileText.slice(start + marker.length, i);
  }
  return null;
}

/** Parse one union member — either the `Event<"NAME", { ...fields }>` helper
 *  form or a raw discriminated-literal `{ type: "NAME"; ...fields }` form, so
 *  the scan still catches a member added by hand rather than through the
 *  helper. Returns `{ discriminant, fieldsText }`, or `null` if the member
 *  matches neither shape (which is itself worth flagging — an AgentEvent
 *  member this scan cannot even parse is not one it can vouch for). */
function parseMember(member) {
  const trimmed = member.trim();

  const helperMatch = trimmed.match(/^Event<\s*"([^"]+)"\s*(?:,\s*\{([\s\S]*)\})?\s*>$/);
  if (helperMatch) {
    return { discriminant: helperMatch[1], fieldsText: helperMatch[2] ?? "" };
  }

  const literalMatch = trimmed.match(/^\{\s*type:\s*"([^"]+)"\s*;?([\s\S]*)\}$/);
  if (literalMatch) {
    return { discriminant: literalMatch[1], fieldsText: literalMatch[2] };
  }

  return null;
}

/** The two "must carry" invariants, extracted to a pure function so the
 *  mutation control below can drive THIS function directly rather than
 *  re-deriving `String.prototype.includes` over a string literal — which is
 *  what the previous, decorative controls did, and which no change to this
 *  file's own logic could ever trip (proved: deleting both `if` checks that
 *  used to sit inline here left the guard printing success at exit 0,
 *  because the "controls" were four self-contained constant expressions with
 *  nothing wiring them to the guard's actual behaviour). The real run below
 *  calls this exact function; so does its control. */
function mustCarryFailures(text) {
  const problems = [];
  if (!text.includes("variant_id")) {
    problems.push(`${relative} must carry variant_id on draft.ready`);
  }
  if (!text.includes('"message.delta"')) {
    problems.push(`${relative} must keep message.delta — narration is the only lever against a silent gap`);
  }
  return problems;
}

if (!fs.existsSync(absolute)) {
  failures.push(`${relative} is missing`);
} else {
  const text = fs.readFileSync(absolute, "utf8");

  const unionBody = extractDeclarationBody(text, "export type AgentEvent =");
  if (unionBody === null) {
    failures.push(`${relative}: could not extract the AgentEvent union declaration`);
  } else {
    const members = splitTopLevel(stripComments(unionBody), "|")
      .map((part) => part.trim())
      .filter((part) => part.length > 0);

    if (members.length === 0) {
      failures.push(`${relative}: the AgentEvent union scan found no members — the extraction is broken`);
    }

    for (const raw of members) {
      const parsed = parseMember(raw);
      if (parsed === null) {
        failures.push(`${relative}: a union member could not be parsed: ${raw.slice(0, 80)}`);
        continue;
      }
      const { discriminant, fieldsText } = parsed;
      for (const name of declaredFields(fieldsText)) {
        if (BODY_SHAPED.includes(name)) {
          failures.push(`${relative} declares a body-shaped field on ${discriminant}: ${name}`);
        }
        if (name === "text" && discriminant !== MESSAGE_DELTA) {
          failures.push(
            `${relative} declares text on ${discriminant} — only ${MESSAGE_DELTA} may carry text`,
          );
        }
      }
    }
  }

  failures.push(...mustCarryFailures(text));
}

// The union moved to a client-importable module (§9 step 5). This guard follows
// it, and additionally pins the re-export, because a `src/agent/events.ts` that
// stopped re-exporting would break every server-side importer while this file
// still passed against the new location.
const reexportRelative = "src/agent/events.ts";
const reexportAbsolute = path.join(root, reexportRelative);
if (!fs.existsSync(reexportAbsolute)) {
  failures.push(`${reexportRelative} is missing`);
} else {
  const reexportText = fs.readFileSync(reexportAbsolute, "utf8");
  if (!reexportText.includes('export * from "@/lib/agent-events"')) {
    failures.push(`${reexportRelative} does not re-export the union from @/lib/agent-events`);
  }
}

/* Mutation control: the per-member field scan, exercised directly rather than
 * through the real file, so it is provable independent of what events.ts
 * happens to contain today. */
if (declaredFields("body: string;").length === 0) {
  failures.push("mutation control does not trip: a body field was not detected");
}
{
  // The discriminant must never reach the field scan as a field named
  // "type" — `parseMember` strips it out before `declaredFields` ever runs,
  // by construction. Proved directly rather than assumed: parse a real
  // member shape and confirm "type" is absent from its extracted fields.
  const parsed = parseMember('Event<"draft.ready", { variant_id: string }>');
  const fields = parsed ? declaredFields(parsed.fieldsText) : ["PARSE_FAILED"];
  if (fields.includes("type")) {
    failures.push("mutation control is over-broad: the discriminant leaked into the field scan as 'type'");
  }
  if (!fields.includes("variant_id")) {
    failures.push("mutation control does not trip: parseMember failed to extract a real field");
  }
}

/* Mutation control for parseMember + splitTopLevel together: an inline body
 * field added onto an existing union member (not declared alone on its own
 * line) must still be caught. This is the case a line-anchored regex would
 * have let through silently. */
{
  const probeMembers = splitTopLevel(
    stripComments('| Event<"draft.ready", { variant_id: string; body: string }>'),
    "|",
  )
    .map((part) => part.trim())
    .filter(Boolean);
  const parsed = probeMembers.map(parseMember).find((member) => member !== null);
  const fields = parsed ? declaredFields(parsed.fieldsText) : [];
  if (!fields.includes("body")) {
    failures.push("mutation control does not trip: an inline body field on a union member was not detected");
  }
}

/* Mutation control for the reviewer's EXACT mutation: an inline
 * `draft.preview` member carrying `text` must be caught, because `text` is
 * legitimate ONLY on `message.delta`. This is the specific gap fix round B2
 * closes — the old whole-file scan could never flag `text` at all. */
{
  const probeUnion = [
    '| Event<"message.delta", { text: string }>',
    '| { type: "draft.preview"; text: string }',
  ].join("\n");
  const probeMembers = splitTopLevel(stripComments(probeUnion), "|")
    .map((part) => part.trim())
    .filter(Boolean);

  let caught = false;
  for (const raw of probeMembers) {
    const parsed = parseMember(raw);
    if (parsed === null) continue;
    if (declaredFields(parsed.fieldsText).includes("text") && parsed.discriminant !== MESSAGE_DELTA) {
      caught = true;
    }
  }
  if (!caught) {
    failures.push(
      "mutation control does not trip: an inline draft.preview event carrying text was not detected",
    );
  }
}

/* Mutation controls for the two "must carry" invariants, driving
 * `mustCarryFailures` ITSELF — the exact function the real run above calls —
 * rather than re-deriving `String.prototype.includes` over a literal. A
 * constant expression like `"no such field here".includes("variant_id")` can
 * never be tripped by any change to this file's own logic; calling the real
 * function is what makes "delete the assertions and watch this control go
 * red" a meaningful drill. */
{
  const missingVariantId = mustCarryFailures('type: "message.delta"');
  if (!missingVariantId.some((problem) => problem.includes("variant_id"))) {
    failures.push("mutation control does not trip: mustCarryFailures missed an absent variant_id");
  }

  const missingMessageDelta = mustCarryFailures("variant_id: string");
  if (!missingMessageDelta.some((problem) => problem.includes("message.delta"))) {
    failures.push("mutation control does not trip: mustCarryFailures missed an absent message.delta");
  }

  const both = mustCarryFailures('variant_id: string; type: "message.delta"');
  if (both.length !== 0) {
    failures.push("mutation control is over-broad: mustCarryFailures flagged text carrying both invariants");
  }
}

if (failures.length > 0) {
  console.error("assert-agent-events failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("assert-agent-events — no draft body can reach the browser over the stream, and text is message.delta's alone");
