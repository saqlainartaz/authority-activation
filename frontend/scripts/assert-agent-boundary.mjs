import fs from "node:fs";
import path from "node:path";

/* ---------------------------------------------------------------------------
 * A2, widened. The spec named one module — `ai` — but `ai` is not installed and
 * `@anthropic-ai/sdk` is, and A1 compared the AI SDK to Eve rather than to the
 * SDK already in this repo. So the boundary forbids EVERY provider SDK outside
 * `lib/loop.ts`, which is strictly stronger and correct whichever one step 4
 * picks. If a vendor breaks or stalls, one file is rewritten and the tools,
 * instructions, skill and Python contract survive untouched.
 * ------------------------------------------------------------------------- */

const root = process.cwd();
const failures = [];

const PROVIDER_MODULES = [
  "ai",
  "@anthropic-ai/sdk",
  "@ai-sdk/anthropic",
  "openai",
  "@google/generative-ai",
  "@mistralai/mistralai",
  "cohere-ai",
  "ollama",
];

const ALLOWED = "src/agent/lib/loop.ts";

// TEMPORARY_EXCEPTIONS held `src/app/api/brief/linkedin/route.ts` — the last
// pre-agent LLM call left in this frontend — until A14 deleted that route at
// step 6 of this plan. Discharged, not emptied: the const and every use of it
// are gone with it, so there is no empty list left standing as an invitation
// to refill.

/* ---------------------------------------------------------------------------
 * FIX ROUND (E2, 2026-08-24). The previous version matched only an EXACT
 * quoted specifier — `from "@anthropic-ai/sdk"` — so it missed two real
 * import shapes: a SUBPATH import (`from "@anthropic-ai/sdk/resources/
 * messages"`, `from "ai/rsc"`), and a TEMPLATE-LITERAL dynamic import
 * (`` import(`@anthropic-ai/sdk`) ``). Both are real JS/TS syntax a vendor SDK
 * can be reached through, and neither tripped this guard.
 *
 * Static `import ... from` specifiers can only be string literals (single or
 * double quoted) — a template literal there is a syntax error, so that regex
 * only needs to cover two quote kinds. Dynamic `import(...)` and `require(...)`
 * are ordinary function calls and accept any expression, including a
 * template literal, so that regex covers all three quote kinds.
 * ------------------------------------------------------------------------- */
/* ---------------------------------------------------------------------------
 * FIX (item 5, 2026-08-24, deliberate scope addition — flagged as such, not
 * part of the original B-section findings). A BARE side-effect import,
 * `import "@anthropic-ai/sdk";`, has no `from` and no call parens, so none of
 * the three forms above matched it. It still EXECUTES the module, and the
 * syntax is idiomatic in this exact tree — every agent file under
 * `src/agent/` opens with `import "server-only";`. Matched separately from
 * `staticImport` because a bare import has no `from` keyword to anchor on:
 * the quote follows `import` directly, with nothing but whitespace between.
 * ------------------------------------------------------------------------- */
function extractSpecifiers(text) {
  const specifiers = [];
  const staticImport = /\bfrom\s+(["'])((?:\\.|(?!\1).)*)\1/g;
  const bareImport = /\bimport\s+(["'])((?:\\.|(?!\1).)*)\1\s*;/g;
  const dynamic = /\b(?:import|require)\s*\(\s*([`"'])((?:\\.|(?!\1).)*)\1\s*\)/g;
  for (const match of text.matchAll(staticImport)) specifiers.push(match[2]);
  for (const match of text.matchAll(bareImport)) specifiers.push(match[2]);
  for (const match of text.matchAll(dynamic)) specifiers.push(match[2]);
  return specifiers;
}

/** A specifier counts as importing `name` if it IS `name`, or is a subpath of
 *  it (`name` followed by `/`) — `@anthropic-ai/sdk/resources/messages` is
 *  still the Anthropic SDK, just one file deeper into its package. */
function importsProvider(text) {
  const specifiers = extractSpecifiers(text);
  return PROVIDER_MODULES.filter((name) =>
    specifiers.some((specifier) => specifier === name || specifier.startsWith(`${name}/`)),
  );
}

function walk(directory) {
  const found = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) found.push(...walk(full));
    else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) found.push(full);
  }
  return found;
}

for (const file of walk(path.join(root, "src"))) {
  const relative = path.relative(root, file).replaceAll("\\", "/");
  if (relative === ALLOWED) continue;
  const offenders = importsProvider(fs.readFileSync(file, "utf8"));
  for (const name of offenders) {
    failures.push(`${relative} imports ${name} outside ${ALLOWED}`);
  }
}

/* Mutation control. */
if (importsProvider('import Anthropic from "@anthropic-ai/sdk";').length === 0) {
  failures.push("mutation control does not trip: a real SDK import was not detected");
}
if (importsProvider('import { z } from "zod";').length !== 0) {
  failures.push("mutation control is over-broad: a non-provider import was flagged");
}

/* Mutation controls for the three forms E2 fixes, each proved missed by the
 * reviewer against the previous exact-match-only version. */
if (importsProvider('import { messages } from "@anthropic-ai/sdk/resources/messages";').length === 0) {
  failures.push("mutation control does not trip: a subpath import (double-quoted) was not detected");
}
if (importsProvider("import { streamUI } from 'ai/rsc';").length === 0) {
  failures.push("mutation control does not trip: a subpath import (single-quoted) was not detected");
}
if (importsProvider("const sdk = await import(`@anthropic-ai/sdk`);").length === 0) {
  failures.push("mutation control does not trip: a template-literal dynamic import was not detected");
}
if (importsProvider("const sdk = require(`@anthropic-ai/sdk`);").length === 0) {
  failures.push("mutation control does not trip: a template-literal require() was not detected");
}
// Non-vacuity in the other direction: a subpath of an UNRELATED package must
// not be flagged just because it shares a slash-separated prefix elsewhere.
if (importsProvider('import { thing } from "zod/lib/thing";').length !== 0) {
  failures.push("mutation control is over-broad: an unrelated package's subpath was flagged");
}

/* Mutation control for the bare side-effect import (item 5). A module
 * executes on `import "name";` even with nothing bound to a name, and this
 * syntax is idiomatic in this exact tree (`import "server-only";`). */
if (importsProvider('import "@anthropic-ai/sdk";').length === 0) {
  failures.push("mutation control does not trip: a bare side-effect import was not detected");
}
if (importsProvider("import 'ai';").length === 0) {
  failures.push("mutation control does not trip: a single-quoted bare side-effect import was not detected");
}
// Non-vacuity: a NAMED import must not be double-matched by the bare-import
// pattern too (it has an identifier between `import` and `from`, not a quote
// directly after `import`), which would be harmless here but would signal
// the regex is looser than it claims to be.
if (extractSpecifiers('import Anthropic from "@anthropic-ai/sdk";').length !== 1) {
  failures.push("mutation control is over-broad: a named import matched more than one specifier pattern");
}

if (failures.length > 0) {
  console.error("assert-agent-boundary failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("assert-agent-boundary — no provider SDK reachable outside lib/loop.ts");
