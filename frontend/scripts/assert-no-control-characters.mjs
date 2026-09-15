#!/usr/bin/env node
// `D-07A-11-A`'s "cheap permanent fix", adopted by plan 07A-16 as it asked.
//
// THE FINDING THIS EXISTS FOR. On 2026-08-14 a literal U+0000 landed inside a template
// literal in `ReschedulePicker.tsx`:
//
//     const cacheKey = `${kind}<NUL>${zone}`;
//
// That is legal TypeScript, and EVERY gate this repository has agreed it was fine:
//
//     tsc --noEmit                        exit 0
//     npm run lint (per-file)             zero problem lines
//     npm run build                       compiled successfully, 38 routes, 0 warnings
//     an 87-check AST suite over that very function   all green
//     grep                                "Binary file ... matches"  <- the ONLY signal
//
// So the one tool that noticed was the one whose message reads like an obstacle. The
// entry's instruction was explicit: *"its first structural case can walk
// `frontend/src/**/*.{ts,tsx}` and assert zero control characters outside `\n`, `\r`
// and `\t`. It costs four lines and closes a class of defect that is invisible to the
// three gates the phase currently relies on."*
//
// WHY IT IS A SEPARATE SCRIPT RATHER THAN A SIXTH ASSERTION IN `assert-no-fabricated-state.mjs`.
// That script's subject is FABRICATED STATE — five assertions about what the source
// claims. This one's subject is BYTES, and it needs no TypeScript parse at all: a file
// with a stray control character may still parse perfectly, which is the entire point.
// Keeping them apart also means this one keeps working if the other's AST walk ever
// fails to load a file. Both are wired into `npm run check`, and `npm run test:e2e`
// runs that before Playwright starts.
//
// READ THROUGH NODE, NEVER THROUGH A TEXT TOOL. `D-07A-11-A` and 07A-09 § 11.4 record
// the same lesson from opposite directions — a `grep` that says "Binary file matches"
// and a `git cat-file | grep -c $'\r'` that reported CRLF for a pure-LF blob. Both were
// measurements of the pipe rather than of the file. This reads bytes and decides itself.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
// Resolved from this file's own location, so the script has no cwd assumption and can
// be spawned from a spec, from `npm --prefix`, or from a shell in any directory.
const ROOTS = [path.join(HERE, "..", "src"), path.join(HERE, "..", "e2e")];
// `.md` ADDED 2026-08-24, at §9 step 3. Until then this set was source-code
// extensions only, and markdown under `src/` was not source. It is now: the
// prompt migration made `src/agent/instructions.md` and
// `src/agent/skills/*/SKILL.md` hand-authored prose that goes verbatim into a
// system prompt. That is a WORSE place for a stray byte than the template
// literal this script was written for — a U+200B or U+00A0 pasted in from a
// browser changes what the model is told and there is no compiler between the
// file and the provider. The 2026-08-14 finding above is the argument; these
// files are simply the newest instance of it.
const EXTENSIONS = new Set([".ts", ".tsx", ".mjs", ".js", ".jsx", ".css", ".json", ".md"]);

// The three that are legitimate in source. Everything else below U+0020, plus the
// DEL/C1 range U+007F-U+009F, is a finding. U+FEFF (a byte-order mark) is called out
// separately because a leading one is legal-ish and a mid-file one never is.
const ALLOWED = new Set(["\n", "\r", "\t"]);

function walk(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (EXTENSIONS.has(path.extname(entry.name))) out.push(full);
  }
  return out;
}

function offences(text) {
  const found = [];
  let line = 1;
  let column = 1;
  for (const char of text) {
    const code = char.codePointAt(0);
    const isControl = (code < 0x20 && !ALLOWED.has(char)) || (code >= 0x7f && code <= 0x9f);
    // A BOM anywhere but byte zero is always a mistake — usually a copy-paste through
    // an editor that helpfully re-encoded one region of the file.
    const isStrayBom = code === 0xfeff && !(line === 1 && column === 1);
    if (isControl || isStrayBom) {
      found.push({
        line,
        column,
        code: `U+${code.toString(16).toUpperCase().padStart(4, "0")}`,
      });
    }
    if (char === "\n") {
      line += 1;
      column = 1;
    } else {
      column += 1;
    }
  }
  return found;
}

const files = ROOTS.flatMap(walk);
if (files.length === 0) {
  // A walk that finds nothing is a vacuous pass, which is the failure mode this
  // repository has recorded most often. Refuse rather than print green.
  console.error("assert-no-control-characters — FAIL: walked 0 files. The roots are wrong.");
  process.exit(1);
}

let failed = 0;
for (const file of files) {
  const text = fs.readFileSync(file, "utf8");
  for (const hit of offences(text)) {
    failed += 1;
    const relative = path.relative(path.join(HERE, ".."), file).split(path.sep).join("/");
    console.error(`  ${relative}:${hit.line}:${hit.column}  ${hit.code}`);
  }
}

console.log(`\nassert-no-control-characters — ${files.length} files read as bytes`);
if (failed > 0) {
  console.error(
    `FAIL  zero control characters outside \\n, \\r and \\t — found ${failed}\n` +
      `      D-07A-11-A: tsc, eslint and next build are all silent on these.`,
  );
  process.exit(1);
}
console.log("PASS  zero control characters outside \\n, \\r and \\t");
