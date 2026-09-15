import fs from "node:fs";
import path from "node:path";

/* ---------------------------------------------------------------------------
 * §7.3. `server-only` is already a dependency, so this costs nothing new: every
 * `.ts` file under `src/agent/` imports it, and Next's bundler then FAILS THE
 * BUILD if any client component imports them transitively. §15 item 3 becomes
 * the compiler refusing, rather than a grep over a built bundle hoping to spot a
 * key.
 *
 * NO CARVE-OUTS. Tests live at `tests/agent/`, outside this tree, specifically
 * so this assertion needs no exception — carve-outs are how guards decay.
 * ------------------------------------------------------------------------- */

const root = process.cwd();
const failures = [];

// `.tsx` too, matching `assert-agent-boundary.mjs`'s walk (E1, 2026-08-24): a
// `.tsx` under `src/agent/` is the one file kind that is client-importable by
// construction, and a `.ts`-only walk let it escape this guard entirely. None
// exists today, but the walk must not depend on that staying true. Extracted
// so the mutation control below can drive it without touching disk.
function isTrackedFile(name) {
  return name.endsWith(".ts") || name.endsWith(".tsx");
}

function walk(directory) {
  const found = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) found.push(...walk(full));
    else if (isTrackedFile(entry.name)) found.push(full);
  }
  return found;
}

function importsServerOnly(text) {
  return text.includes('import "server-only"') || text.includes("import 'server-only'");
}

const directory = path.join(root, "src/agent");
if (!fs.existsSync(directory)) {
  failures.push("src/agent is missing");
} else {
  const files = walk(directory);
  // Non-vacuity: an empty walk passes trivially and would keep passing forever
  // if the tree moved.
  if (files.length < 10) failures.push(`the walk found almost nothing: ${files.length} files`);
  for (const file of files) {
    if (!importsServerOnly(fs.readFileSync(file, "utf8"))) {
      failures.push(`${path.relative(root, file).replaceAll("\\", "/")} does not import server-only`);
    }
  }
}

/* Mutation control. */
if (importsServerOnly('export const x = 1;')) {
  failures.push("mutation control does not trip: a file without the import passed");
}
// E1: a `.tsx` file must be tracked by the walk, not just `.ts`. Before this
// fix a `.tsx` under `src/agent/` — client-importable by construction — could
// omit `import "server-only"` and this guard would never even look at it.
if (!isTrackedFile("Widget.tsx")) {
  failures.push("mutation control does not trip: a .tsx file is not tracked by the walk");
}

if (failures.length > 0) {
  console.error("assert-agent-server-only failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("assert-agent-server-only — every agent module is unimportable from the client");
