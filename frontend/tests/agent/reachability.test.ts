import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Every exported value in C4's TypeScript surface has a production caller.
 *
 * **This test exists because six defects hid behind green suites.** The worst
 * of them: `buildTurnMessagesV2` and the `<guideline>`, `<sources>` and
 * `<selected-draft>` block builders were written, unit-tested and referenced
 * by nothing in production for two tasks. `message_handle`'s TypeScript twin
 * never existed. `bounds.ts` grew two ceilings that `turn.ts` never set. Each
 * was covered by tests that passed throughout, because a test IS a caller —
 * just not one that ships.
 *
 * So the question this asks is not "is it correct" but "can anything reach
 * it", and it asks mechanically, over a named file list, so nobody has to
 * remember to wonder.
 *
 * **Values only, deliberately.** An exported type that nothing imports is
 * dead weight; an exported FUNCTION that nothing calls is a feature the
 * product does not have. The two are worth different amounts of alarm and
 * only the second one shipped as a defect.
 *
 * **Tests are not callers.** The search scope excludes `tests/` entirely,
 * which is the whole point: `buildTurnMessagesV2` had six test references and
 * zero production ones.
 */

const ROOT = process.cwd();

/**
 * The C4 TypeScript surface, from the plan's P1-P7 file lists plus the two
 * modules C4 amended (`transcript.ts`, `bounds.ts`).
 *
 * A LIST, not a glob over `src/`. The question is whether C4's own work is
 * reachable; sweeping the whole repository would bury that answer under
 * pre-existing helpers this cycle never touched and is not authorized to
 * delete.
 */
const C4_MODULES = [
  "src/agent/profile.ts",
  "src/agent/render.ts",
  "src/agent/bounds.ts",
  "src/agent/transcript.ts",
  "src/agent/lib/tool-schemas.ts",
  "src/agent/lib/executor.ts",
  "src/agent/lib/context-assembly.ts",
  "src/agent/tools/read-knowledge.ts",
  "src/agent/tools/list-recent-content.ts",
  "src/agent/tools/use-task-material.ts",
  "src/agent/tools/submit-draft.ts",
  "src/agent/contracts/read.ts",
  "src/agent/contracts/context.ts",
  "src/agent/contracts/draft.ts",
  "src/agent/contracts/product-context.ts",
  // The client-facing capability section. Listed so a route that stops
  // sending it fails here rather than shipping a generator nobody calls.
  "src/agent/capabilities.ts",
  // The conversation cap. Listed so a route that stops bounding the
  // transcript fails here rather than shipping a cap nothing applies.
  "src/agent/lib/transcript-bound.ts",
  // The schedule proposal: listed so an executor that stops calling it fails here.
  "src/agent/tools/propose-schedule.ts",
];

/**
 * Symbols a framework calls, which no source file references by name.
 *
 * Each entry names WHO calls it. An entry with no caller outside the
 * framework is the only kind that belongs here, and writing the caller down
 * is what stops this list becoming a place to put inconvenient findings.
 */
const FRAMEWORK_ENTRY_POINTS: Record<string, string> = {
  // Next.js route handlers, invoked by the router rather than by name.
  POST: "next.js router",
  GET: "next.js router",
};

/**
 * Exported so a TEST can assert against it, and referenced inside its own
 * module by production code.
 *
 * This is a real category and a narrow one: an error type nothing catches in
 * production but a test asserts is thrown, and a sub-schema composed into an
 * exported parent. Both are reachable — the code runs — and neither is the
 * defect this file exists for, which is a symbol NOTHING can reach.
 *
 * Each entry names the test that needs it. An entry whose test is gone is an
 * entry that should be gone, and writing the test down is what makes that
 * checkable instead of forgotten. Anything composed only inside its own file
 * with no test asserting it was un-exported rather than listed here.
 */
const EXPORTED_FOR_ASSERTION: Record<string, string> = {
  modelReadRequestSchema: "tests/agent/read-contract.test.ts",
  wirePayloadSchema: "tests/agent/read-contract.test.ts",
  coverageSchema: "tests/agent/read-contract.test.ts",
  readFailureSchema: "tests/agent/read-contract.test.ts",
  ReadKnowledgeArgumentError: "tests/agent/read-knowledge.test.ts",
  TaskMaterialArgumentError: "tests/agent/use-task-material.test.ts",
  // Surfaced the moment this scan stopped counting prose as a caller: every
  // reference to `TOOL_NAMES` outside `profile.ts` is a comment. Its real
  // production use is INSIDE its own file — `PROFILES.linkedin.tools` and the
  // spread that builds `C4_TOOL_NAMES` — which the scan deliberately does not
  // count, and `tool-schemas.test.ts` is what needs it exported.
  TOOL_NAMES: "tests/agent/tool-schemas.test.ts",
  // The cap and its block size are used inside `transcript-bound.ts`; the
  // test pins the operator-chosen value and the block arithmetic.
  MAX_TRANSCRIPT_CHARS: "tests/agent/transcript-bound.test.ts",
  TRIM_BLOCK: "tests/agent/transcript-bound.test.ts",
};

function sourceFiles(): string[] {
  const found: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name === ".next") continue;
        walk(full);
        continue;
      }
      if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
        found.push(full);
      }
    }
  };
  walk(path.join(ROOT, "src"));
  return found;
}

/** Exported VALUES: functions, consts and classes. Not types. */
function exportedValues(source: string): string[] {
  const names = new Set<string>();
  const patterns = [
    /export\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/g,
    /export\s+(?:const|let)\s+([A-Za-z_$][\w$]*)/g,
    /export\s+class\s+([A-Za-z_$][\w$]*)/g,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) names.add(match[1]);
  }
  return [...names];
}

/**
 * A file's CODE, with its prose and its import declarations removed.
 *
 * **Because neither one is a caller, and both were counting as one.** The
 * engine review said this scan was prose-blind — a symbol named in a comment
 * kept it green — and proving the control found the second half: deleting the
 * only call to `renderBackgroundMaterial` left the scan green, because the
 * now-unused `import` line still matched and so did the comment three lines
 * above it. A test that passes when the thing it checks for has happened is
 * the decoration this file was written to replace.
 *
 * Plain `import ... from` declarations go; `export ... from` re-exports STAY,
 * because a re-export genuinely is a path by which something reaches a symbol,
 * and reporting one as an orphan is the false positive that gets a scan
 * deleted rather than fixed.
 */
function callableText(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/.*/g, "$1 ")
    .replace(/^\s*import\s[\s\S]*?from\s*["'][^"']*["'];?/gm, " ")
    .replace(/^\s*import\s*["'][^"']*["'];?/gm, " ");
}

describe("every exported value in C4's TypeScript surface is reachable", () => {
  const production = sourceFiles().map((file) => ({
    file,
    text: callableText(fs.readFileSync(file, "utf8")),
  }));

  const orphans: string[] = [];
  for (const relative of C4_MODULES) {
    const absolute = path.join(ROOT, relative);
    const source = fs.readFileSync(absolute, "utf8");
    for (const name of exportedValues(source)) {
      if (name in FRAMEWORK_ENTRY_POINTS) continue;
      if (name in EXPORTED_FOR_ASSERTION) continue;
      // A word-boundary match in any OTHER production file. Deliberately
      // textual rather than a real import graph: a reference through a
      // re-export, a namespace import or a dynamic import still counts as
      // reachable, and an AST walk that missed one of those would report a
      // false orphan — which is the failure that gets a test like this
      // deleted.
      const referenced = production.some(
        (candidate) =>
          candidate.file !== absolute &&
          new RegExp(`\\b${name}\\b`).test(candidate.text),
      );
      if (!referenced) orphans.push(`${relative} :: ${name}`);
    }
  }

  it("names every exported value that only tests can reach", () => {
    expect(orphans).toEqual([]);
  });

  it("can actually fail", () => {
    // THE CONTROL. Without it this test is green when the scan is broken —
    // an empty module list, a regex that matches nothing, a `production`
    // array that accidentally includes the defining file would all produce
    // an empty `orphans` and look like success.
    //
    // A symbol that exists in a C4 module and is referenced nowhere else is
    // constructed here in memory, and the same predicate must report it.
    const inventedSource = "export function __orphanedForTheControl() {}\n";
    const found = exportedValues(inventedSource);

    expect(found).toEqual(["__orphanedForTheControl"]);
    expect(
      production.some((candidate) =>
        new RegExp(`\\b__orphanedForTheControl\\b`).test(candidate.text),
      ),
    ).toBe(false);
  });

  it("keeps the assertion allowlist honest", () => {
    // Every allowlisted symbol must still be referenced by the test that
    // justifies it. Otherwise the list becomes a place to put findings.
    for (const [name, testFile] of Object.entries(EXPORTED_FOR_ASSERTION)) {
      const text = fs.readFileSync(path.join(ROOT, testFile), "utf8");
      expect(text, `${name} is allowlisted for ${testFile}, which no longer uses it`).toMatch(
        new RegExp(`\\b${name}\\b`),
      );
    }
  });

  it("scans a non-empty surface", () => {
    // The other way this goes falsely green: `sourceFiles()` returning
    // nothing, or `C4_MODULES` pointing at paths that do not exist.
    expect(production.length).toBeGreaterThan(20);
    for (const relative of C4_MODULES) {
      expect(fs.existsSync(path.join(ROOT, relative))).toBe(true);
    }
  });
});
