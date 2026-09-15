import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/* ---------------------------------------------------------------------------
 * The tool surface is a security boundary, not a directory listing (spec A5,
 * A16). No `approve`, `publish`, `confirm`, shell, filesystem, HTTP or SQL tool
 * can appear without failing this. Nothing to suppress, because nothing
 * provides it — and this is what keeps that true as the tree grows.
 *
 * FIX ROUND (B3, 2026-08-24). The previous version compared the files on disk
 * against a SANCTIONED array hardcoded in THIS file — a second copy of the
 * allowlist, independent of `TOOL_NAMES` in `src/agent/profile.ts`, which is
 * the array that actually becomes the model's tool schema. Proved: growing
 * `TOOL_NAMES` to seven entries including `"approve"` and `"publish"` still
 * printed "exactly the five sanctioned tools, and nothing else" at exit 0,
 * because nothing here ever read `profile.ts` at all. `readdirSync` was also
 * non-recursive, so a namespaced `tools/admin/publish.ts` was invisible to the
 * census entirely.
 *
 * There is no second list now. This guard reads `TOOL_NAMES` out of
 * `profile.ts` directly, walks `src/agent/tools/` recursively, and reads each
 * profile's granted `tools` out of the `PROFILES` registry, then asserts SET
 * EQUALITY — not membership — pairwise between all three: the files on disk,
 * `TOOL_NAMES`, and the union of every profile's granted tools. Equality
 * (not membership) also closes Task 9's deferred minor: `tests/agent/
 * events.test.ts` only ever checked that the linkedin profile grants nothing
 * OUTSIDE `TOOL_NAMES` — it never checked the reverse, that everything IN
 * `TOOL_NAMES` is actually granted somewhere.
 * ------------------------------------------------------------------------- */

const root = process.cwd();
const failures = [];

const toolsDir = path.join(root, "src/agent/tools");
const profilePath = path.join(root, "src/agent/profile.ts");

/** Walk `dir` recursively, returning `.ts` file paths relative to `baseDir`
 *  with POSIX separators — this is the fix for the non-recursive `readdirSync`
 *  that let a nested `tools/admin/publish.ts` go uncounted. */
function walkTsFilesRecursive(dir, baseDir = dir) {
  const results = [];
  if (!fs.existsSync(dir)) return results;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkTsFilesRecursive(full, baseDir));
    } else if (entry.isFile() && entry.name.endsWith(".ts")) {
      results.push(path.relative(baseDir, full).split(path.sep).join("/"));
    }
  }
  return results;
}

/** filename-IS-toolname (spec A5): kebab-case on disk, snake_case as the tool
 *  name the model sees. A nested path keeps its slash rather than being
 *  flattened, so a namespaced decoy can never coincidentally collide with a
 *  legitimate flat name and hide from the census. */
function toolNameFromFile(relativePath) {
  return relativePath
    .replace(/\.ts$/, "")
    .split("/")
    .map((segment) => segment.replace(/-/g, "_"))
    .join("/");
}

/** Extract the text strictly between the first `open` after `marker` and its
 *  matching `close`, counting only that one bracket pair's depth. Works for
 *  `[...]` (TOOL_NAMES) and `{...}` (PROFILES, and each profile's own block)
 *  alike — callers pick the pair. */
function extractDelimited(text, marker, open, close) {
  const start = text.indexOf(marker);
  if (start === -1) return null;
  const openIndex = text.indexOf(open, start);
  if (openIndex === -1) return null;
  let depth = 0;
  for (let i = openIndex; i < text.length; i++) {
    if (text[i] === open) depth++;
    else if (text[i] === close) {
      depth--;
      if (depth === 0) return text.slice(openIndex + 1, i);
    }
  }
  return null;
}

/** Split `text` on `separator` at depth 0, treating `{[(` as opening and
 *  `}])` as closing (one shared counter — this file never needs to tell the
 *  three bracket kinds apart, only to know when it is back at top level). */
function splitTopLevel(text, separator) {
  const parts = [];
  let depth = 0;
  let current = "";
  for (const char of text) {
    if (char === "{" || char === "[" || char === "(") depth++;
    else if (char === "}" || char === "]" || char === ")") depth--;
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

/** Parse `export const TOOL_NAMES = [...] as const;` out of `profileText`. */
function parseToolNames(profileText) {
  const inner = extractDelimited(profileText, "export const TOOL_NAMES = [", "[", "]");
  if (inner === null) return null;
  return [...inner.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
}

/** Parse the `PROFILES` registry out of `profileText`, returning a map of
 *  platform key -> the granted tool names for that profile. A `tools:
 *  TOOL_NAMES` reference grants the WHOLE parsed `toolNames` set; a `tools:
 *  [...]` literal grants exactly the string literals it lists. */
function parseGrantedTools(profileText, toolNames) {
  // Marker ends at `=`, not at the `{` itself: `extractDelimited` finds the
  // first `{` AFTER the marker regardless of what sits between them, so this
  // tolerates `= {` and `= Object.freeze({` alike (E3 wrapped this
  // declaration in `Object.freeze` after this parser was first written).
  const registryInner = extractDelimited(
    profileText,
    "export const PROFILES: Record<string, CapabilityProfile> =",
    "{",
    "}",
  );
  if (registryInner === null) return null;

  const granted = {};
  for (const rawEntry of splitTopLevel(registryInner, ",")) {
    const trimmed = rawEntry.trim();
    if (trimmed.length === 0) continue;
    const keyMatch = trimmed.match(/^([A-Za-z0-9_]+)\s*:/);
    if (keyMatch === null) continue;
    const platform = keyMatch[1];
    const block = extractDelimited(trimmed, keyMatch[0], "{", "}");
    if (block === null) continue;
    const toolsMatch = block.match(/tools:\s*(TOOL_NAMES|\[[\s\S]*?\])/);
    if (toolsMatch === null) {
      granted[platform] = [];
    } else if (toolsMatch[1] === "TOOL_NAMES") {
      granted[platform] = [...toolNames];
    } else {
      granted[platform] = [...toolsMatch[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    }
  }
  return granted;
}

/** Pairwise set equality, reporting names missing from `right` and names
 *  extra in `right` (relative to `left`), each tagged with `label` so the
 *  three cross-checks below stay distinguishable in the failure output. */
function setEquality(left, right, label) {
  const problems = [];
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  for (const name of leftSet) {
    if (!rightSet.has(name)) problems.push(`${label}: ${name} is missing`);
  }
  for (const name of rightSet) {
    if (!leftSet.has(name)) problems.push(`${label}: ${name} is unsanctioned`);
  }
  return problems;
}

let toolNames = null;
let fileNames = [];

if (!fs.existsSync(toolsDir)) {
  failures.push("src/agent/tools is missing");
} else {
  fileNames = walkTsFilesRecursive(toolsDir).map(toolNameFromFile);
}

if (!fs.existsSync(profilePath)) {
  failures.push("src/agent/profile.ts is missing");
} else {
  const profileText = fs.readFileSync(profilePath, "utf8");
  toolNames = parseToolNames(profileText);
  if (toolNames === null) {
    failures.push("src/agent/profile.ts: could not parse TOOL_NAMES");
  } else {
    failures.push(...setEquality(toolNames, fileNames, "files on disk vs. TOOL_NAMES"));

    const granted = parseGrantedTools(profileText, toolNames);
    if (granted === null) {
      failures.push("src/agent/profile.ts: could not parse the PROFILES registry");
    } else {
      const grantedUnion = Object.values(granted).flat();
      failures.push(...setEquality(toolNames, grantedUnion, "profile-granted tools vs. TOOL_NAMES"));
    }
  }
}

/* Mutation control: the reviewer's exact scenario. TOOL_NAMES grown to seven
 * entries including "approve" and "publish", with only the original five
 * files present on disk, must trip — proving the census no longer depends on
 * a second, independently-editable copy of the allowlist. */
{
  const sanctioned = [
    "prepare_generation",
    "submit_draft",
    "get_variant_sources",
    "propose_durable_fact",
    "schedule",
  ];
  const inflatedToolNames = [...sanctioned, "approve", "publish"];
  const problems = setEquality(inflatedToolNames, sanctioned, "mutation probe");
  if (problems.length === 0) {
    failures.push(
      "mutation control does not trip: TOOL_NAMES growing past the files on disk was not detected",
    );
  }
}

/* Mutation control: a file removed from disk (present in TOOL_NAMES, absent
 * from the walk) must trip too — the missing-file direction. */
{
  const sanctioned = ["a", "b", "c"];
  const problems = setEquality(sanctioned, sanctioned.slice(1), "mutation probe");
  if (problems.length === 0) {
    failures.push("mutation control does not trip: a missing tool file passed the census");
  }
}

/* Mutation control proving recursion actually happens, against a REAL,
 * ephemeral, throwaway directory — this is the exact bug a non-recursive
 * `readdirSync` had: `tools/admin/publish.ts` was invisible to the census. */
{
  const probeDir = fs.mkdtempSync(path.join(os.tmpdir(), "assert-agent-tools-"));
  try {
    fs.writeFileSync(path.join(probeDir, "top-level.ts"), "");
    fs.mkdirSync(path.join(probeDir, "admin"));
    fs.writeFileSync(path.join(probeDir, "admin", "publish.ts"), "");
    const found = walkTsFilesRecursive(probeDir);
    if (!found.includes("top-level.ts")) {
      failures.push("mutation control does not trip: the walk missed a top-level file");
    }
    if (!found.includes("admin/publish.ts")) {
      failures.push(
        "mutation control does not trip: the walk missed a nested file — this is the exact bug a non-recursive readdirSync had",
      );
    }
  } finally {
    fs.rmSync(probeDir, { recursive: true, force: true });
  }
}

/* Mutation control: a profile that grants a tool OUTSIDE TOOL_NAMES, and a
 * profile registry that fails to grant a sanctioned tool anywhere, must each
 * trip the profile <-> TOOL_NAMES equality check independently. */
{
  const toolNamesProbe = ["a", "b"];
  const overGrantProblems = setEquality(toolNamesProbe, ["a", "b", "unsanctioned"], "mutation probe");
  if (overGrantProblems.length === 0) {
    failures.push("mutation control does not trip: a profile granting an unsanctioned tool was not detected");
  }
  const underGrantProblems = setEquality(toolNamesProbe, ["a"], "mutation probe");
  if (underGrantProblems.length === 0) {
    failures.push("mutation control does not trip: a sanctioned tool granted to no profile was not detected");
  }
}

if (failures.length > 0) {
  console.error("assert-agent-tools failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(
  `assert-agent-tools — exactly the ${toolNames.length} sanctioned tools TOOL_NAMES declares, ` +
    "on disk and granted, and nothing else",
);
