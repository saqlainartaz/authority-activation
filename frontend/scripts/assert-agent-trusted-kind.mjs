import fs from "node:fs";
import path from "node:path";

/* ---------------------------------------------------------------------------
 * §7.2's seventh property, frontend half — and the ONLY place it can live.
 *
 * A8 makes `kind=agent` the only thing replayed in the model's assistant role,
 * and A9 keeps the model away from writing it. Both rest on the browser being
 * unable to write that kind either. Python cannot assert this: every call into
 * it arrives with the same `ENGINE_SERVICE_KEY`, so it genuinely cannot tell the
 * agent runtime from a forwarded browser request. What Python did instead was
 * stronger — it REMOVED the field, so no request body on the chat surface
 * carries a `kind` at all (Plan A, Task 3).
 *
 * What is left is which routes the browser can REACH, and that is honestly
 * frontend-only. This is the guard for it.
 * ------------------------------------------------------------------------- */

const root = process.cwd();
const failures = [];

const RUNTIME_ONLY_PATHS = ["/agent-turn", "/drafts", "/messages"];

function walk(directory) {
  const found = [];
  if (!fs.existsSync(directory)) return found;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) found.push(...walk(full));
    else if (entry.name === "route.ts") found.push(full);
  }
  return found;
}

const routes = walk(path.join(root, "src/app/api/client"));
// Non-vacuity: this tree has dozens of routes today, and an empty walk would
// pass every assertion below while proving nothing.
if (routes.length < 20) failures.push(`the route walk found almost nothing: ${routes.length}`);

/* ---------------------------------------------------------------------------
 * FIX ROUND (E4, 2026-08-24). The previous needle, `/["']agent["']\s*[,)}\]]/`
 * combined with a same-file `/kind/` check, missed indirection: `const KIND =
 * "agent";` followed by `kind: KIND` never puts the literal `"agent"`
 * immediately next to a closing punctuation character the regex expected,
 * and `kind: "agent" as const` fails it too — `as` follows the closing quote,
 * not `[,)}\]]`.
 *
 * General data-flow tracing (does `KIND` reach a `kind` field three
 * variables later?) is not something a regex can do, and trying would make
 * this guard itself a thing that needs proving correct. The ruling instead
 * widens the net rather than sharpening the aim: flag ANY `route.ts` under
 * `src/app/api/client/` that contains the bare quoted literal `agent`
 * ANYWHERE, dropping both the trailing-punctuation requirement and the
 * same-file `kind` co-occurrence requirement. A false positive here is cheap
 * and loud — a route gets an extra look and is cleared; a miss is silent,
 * and silent is what this guard exists to prevent.
 * ------------------------------------------------------------------------- */
function hasAgentLiteral(text) {
  return /["']agent["']/.test(text);
}

for (const file of routes) {
  const relative = path.relative(root, file).replaceAll("\\", "/");
  const text = fs.readFileSync(file, "utf8");
  if (hasAgentLiteral(text)) {
    failures.push(`${relative} contains the literal "agent" — verify it cannot write kind=agent`);
  }
  for (const runtimeOnly of RUNTIME_ONLY_PATHS) {
    if (text.includes(runtimeOnly)) {
      failures.push(`${relative} reaches the runtime-only endpoint ${runtimeOnly}`);
    }
  }
}

/* Mutation control, one per form E4 fixes. */
if (!hasAgentLiteral('const body = { kind: "agent" };')) {
  failures.push("mutation control does not trip: a direct kind=\"agent\" write was not detected");
}
if (!hasAgentLiteral('const KIND = "agent";\nconst body = { kind: KIND };')) {
  failures.push("mutation control does not trip: an indirected kind=KIND write was not detected");
}
if (!hasAgentLiteral('const body = { kind: "agent" as const };')) {
  failures.push('mutation control does not trip: a `kind: "agent" as const` write was not detected');
}

if (failures.length > 0) {
  console.error("assert-agent-trusted-kind failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("assert-agent-trusted-kind — no browser-reachable route can write the agent's kind");
