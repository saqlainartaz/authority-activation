import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import ts from "typescript";

/* ---------------------------------------------------------------------------
 * Final whole-branch review, C1 step 4. `engineJson`/`engineFetch`
 * (`@/lib/engine`) attach exactly ONE header — `X-API-Key`, the SERVICE
 * credential. Every route a tool under `src/agent/` calls is guarded by the
 * CLIENT credential instead (`X-API-Key` AND `X-Onboarding-Token`,
 * `src/product/api/chat.py`'s `require_onboarding_identity` dependency) —
 * `prepare_generation` and `submit_draft` reached for `engineJson` anyway, and
 * every real turn died at the first tool call, which the two tools' own
 * comments then rationalised as intentional (the comment was the symptom;
 * this file is the fix for the CLASS of defect, not just the one instance).
 *
 * The guard: nothing under `src/agent/` may import ANYTHING from
 * `@/lib/engine` except `EngineHttpError` and `safeEngineSentence` — two
 * exports that carry no credential and make no network call (a thrown-error
 * class and a pure string projection), kept importable so
 * `lib/executor.ts::safeFailureReason` can treat an `EngineHttpError` the
 * same safe way it treats a `ProductHttpError`, for symmetry, even though
 * nothing under `src/agent/` can actually throw one once this fix lands.
 * Every OTHER export — `engineJson`, `engineFetch` (not even exported, but a
 * default/namespace/bare import would still reach it), `engineConfigured`,
 * every typed convenience wrapper (`listClients`, `getContext`, ...) — makes
 * a request carrying only the service credential, and belongs nowhere under
 * `src/agent/`.
 *
 * RULING R29 (final whole-branch review, re-review). The first version of
 * this guard flagged only a specifier whose TEXT was the exact literal
 * `"@/lib/engine"` — a string-match, not a resolution. Two shapes slipped
 * through untouched:
 *
 *   1. a RELATIVE import to the identical file: `from "../../lib/engine"`.
 *   2. a DYNAMIC `import()` or `require()` call, including a
 *      template-literal argument: `await import("@/lib/engine")`,
 *      `require(\`@/lib/engine\`)`.
 *
 * `scripts/assert-agent-boundary.mjs`'s own "FIX ROUND (E2)" comment records
 * it once had exactly this shape of gap — an exact-literal match that missed
 * a subpath import and a template-literal dynamic import — and was hardened
 * after review found it. That hardening is carried across here rather than
 * re-derived: EVERY specifier reaching `@/lib/engine` is now RESOLVED to an
 * absolute file path (via `tsconfig.json`'s own `paths` mapping for an alias,
 * or the importing file's own directory for a relative specifier) and
 * compared against `src/lib/engine.ts`'s resolved path, so the convention
 * that `@/lib/engine` happens to spell the alias today is not load-bearing —
 * and both static AND dynamic/call-expression forms are walked, matching
 * `assert-agent-boundary.mjs`'s own reasoning for why the two need different
 * quote-kind coverage (a static specifier can only be a single- or
 * double-quoted string literal; a call-expression argument can be either of
 * those or a template literal).
 * ------------------------------------------------------------------------- */

const root = process.cwd();
const failures = [];
const AGENT_DIR = path.join(root, "src/agent");
const TARGET_FILE = path.resolve(root, "src/lib/engine.ts");
const ALLOWED = new Set(["EngineHttpError", "safeEngineSentence"]);

/** `@/*` -> `./src/*`, read from `tsconfig.json` itself rather than
 *  hardcoded — if the alias ever moves, this guard moves with it instead of
 *  silently checking a convention that no longer holds. Falls back to the
 *  one alias this repo has always used only if `tsconfig.json` is somehow
 *  unreadable, so the guard degrades rather than crashing CI on an unrelated
 *  tsconfig problem. */
function loadPathAliases() {
  try {
    const tsconfigText = fs.readFileSync(path.join(root, "tsconfig.json"), "utf8");
    const tsconfig = ts.parseConfigFileTextToJson("tsconfig.json", tsconfigText).config ?? {};
    const paths = tsconfig.compilerOptions?.paths ?? {};
    const baseUrl = tsconfig.compilerOptions?.baseUrl ?? ".";
    const aliases = [];
    for (const [pattern, targets] of Object.entries(paths)) {
      // Only the `"prefix/*": ["target/*"]` shape is handled — the one form
      // this repo's own tsconfig uses (`"@/*": ["./src/*"]`). A pattern
      // without a trailing `*` would need different substitution logic this
      // guard does not need today.
      if (!pattern.endsWith("/*") || !Array.isArray(targets) || targets.length === 0) continue;
      const target = targets[0];
      if (typeof target !== "string" || !target.endsWith("/*")) continue;
      aliases.push({
        prefix: pattern.slice(0, -1), // "@/"
        targetDir: path.resolve(root, baseUrl, target.slice(0, -1)), // absolute ".../src/"
      });
    }
    return aliases;
  } catch {
    return [{ prefix: "@/", targetDir: path.resolve(root, "src/") }];
  }
}

const PATH_ALIASES = loadPathAliases();

function walk(directory) {
  const found = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) found.push(...walk(full));
    else if (/\.tsx?$/.test(entry.name)) found.push(full);
  }
  return found;
}

/** Candidate on-disk paths for an extensionless resolved base path — TS's
 *  own resolution order (exact match, then `.ts`/`.tsx`, then a directory's
 *  `index`), narrowed to what this repo actually has (no `.js`/`.jsx`: this
 *  is a TypeScript-only agent tree). */
function candidatePaths(basePath) {
  return [
    basePath,
    `${basePath}.ts`,
    `${basePath}.tsx`,
    path.join(basePath, "index.ts"),
    path.join(basePath, "index.tsx"),
  ];
}

/** Resolve a module specifier, as written in `importerFile`, to an absolute
 *  file path — or `null` for a bare package specifier (`"react"`,
 *  `"@anthropic-ai/sdk"`), which this guard has no target file to compare
 *  against and is not what it is checking. This is the fix R29 asks for:
 *  RESOLUTION rather than a string compare against `"@/lib/engine"`. */
function resolveSpecifier(specifier, importerFile) {
  let basePath = null;
  if (specifier.startsWith(".")) {
    basePath = path.resolve(path.dirname(importerFile), specifier);
  } else {
    for (const alias of PATH_ALIASES) {
      if (specifier.startsWith(alias.prefix)) {
        basePath = path.resolve(alias.targetDir, specifier.slice(alias.prefix.length));
        break;
      }
    }
  }
  if (basePath === null) return null; // bare package specifier — not our concern.

  for (const candidate of candidatePaths(basePath)) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return path.resolve(candidate);
  }
  // Best-effort guess even if nothing exists on disk yet — a mutation
  // control's throwaway file may not physically exist at the resolved path,
  // and a resolved-but-absent target still deserves an honest comparison
  // rather than silently passing.
  return path.resolve(`${basePath}.ts`);
}

/** `true` if `specifier`, written inside `importerFile`, resolves to the
 *  exact `TARGET_FILE`. Case-insensitively, because this repo runs on
 *  Windows (NTFS) where two differently-cased paths are the same file. */
function resolvesToTarget(specifier, importerFile) {
  const resolved = resolveSpecifier(specifier, importerFile);
  return resolved !== null && resolved.toLowerCase() === TARGET_FILE.toLowerCase();
}

/** Every specifier `file` imports (statically OR dynamically) that resolves
 *  to `TARGET_FILE`, each reported as either a specific named binding or
 *  `"*"` — `"*"` covers a default/namespace/bare STATIC import (no named
 *  bindings to check against the allowlist) and, unconditionally, EVERY
 *  dynamic `import()`/`require()` call: unlike a static `import { a, b }`,
 *  a real destructure off a dynamic call's resolved promise/value is not
 *  something this guard attempts to trace, so any dynamic reach into this
 *  module is treated as unsafe outright regardless of what it goes on to
 *  read from it. */
function engineImportNames(file, text) {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const names = [];

  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    if (!ts.isStringLiteral(statement.moduleSpecifier)) continue;
    if (!resolvesToTarget(statement.moduleSpecifier.text, file)) continue;

    const clause = statement.importClause;
    if (!clause) {
      names.push("*"); // `import "<specifier>";` — bare side-effect import.
      continue;
    }
    if (clause.name) names.push("*"); // `import Engine from "<specifier>";`
    if (clause.namedBindings) {
      if (ts.isNamespaceImport(clause.namedBindings)) {
        names.push("*"); // `import * as engine from "<specifier>";`
      } else if (ts.isNamedImports(clause.namedBindings)) {
        for (const element of clause.namedBindings.elements) {
          names.push((element.propertyName ?? element.name).text);
        }
      }
    }
  }

  // Dynamic `import(...)` and `require(...)`, walked via the AST rather than
  // matched against import-declaration statements only — a call expression
  // is not an `ImportDeclaration` and the loop above never sees it.
  const visit = (node) => {
    if (ts.isCallExpression(node)) {
      const isDynamicImport = node.expression.kind === ts.SyntaxKind.ImportKeyword;
      const isRequire = ts.isIdentifier(node.expression) && node.expression.text === "require";
      if (isDynamicImport || isRequire) {
        const argument = node.arguments[0];
        const literalText =
          argument && ts.isStringLiteral(argument)
            ? argument.text
            : argument && ts.isNoSubstitutionTemplateLiteral(argument)
              ? argument.text
              : null;
        if (literalText !== null && resolvesToTarget(literalText, file)) {
          names.push("*");
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);

  return names;
}

if (!fs.existsSync(AGENT_DIR)) {
  failures.push("src/agent is missing");
} else {
  const files = walk(AGENT_DIR);
  if (files.length < 10) failures.push(`the walk found almost nothing: ${files.length} files`);
  for (const file of files) {
    const relative = path.relative(root, file).replaceAll("\\", "/");
    const text = fs.readFileSync(file, "utf8");
    for (const name of engineImportNames(file, text)) {
      if (!ALLOWED.has(name)) {
        const described = name === "*" ? "@/lib/engine (default, namespace, bare, or dynamic)" : `${name} from @/lib/engine`;
        failures.push(
          `${relative} reaches ${described} — only ${[...ALLOWED].join(", ")} are ever safe under src/agent/, ` +
            "because every other export attaches the SERVICE credential (X-API-Key alone) to a route every tool " +
            "here needs the CLIENT credential (X-API-Key AND X-Onboarding-Token) for",
        );
      }
    }
  }
}

/* Mutation controls, against REAL throwaway files — the parser must see
 * actual source, not a hand-fed string, to prove the walk-and-parse path
 * itself is exercised, not just the name-matching logic in isolation. */
{
  const probeDir = fs.mkdtempSync(path.join(os.tmpdir(), "assert-agent-service-credential-"));
  try {
    const write = (name, content) => {
      const full = path.join(probeDir, name);
      fs.writeFileSync(full, content);
      return full;
    };

    const badNamed = write("bad-named.ts", 'import { engineJson } from "@/lib/engine";\n');
    if (engineImportNames(badNamed, fs.readFileSync(badNamed, "utf8")).length === 0) {
      failures.push("mutation control does not trip: a named import of engineJson was not detected");
    }

    const badDefault = write("bad-default.ts", 'import Engine from "@/lib/engine";\n');
    if (!engineImportNames(badDefault, fs.readFileSync(badDefault, "utf8")).includes("*")) {
      failures.push("mutation control does not trip: a default import was not detected");
    }

    const badNamespace = write("bad-namespace.ts", 'import * as engine from "@/lib/engine";\n');
    if (!engineImportNames(badNamespace, fs.readFileSync(badNamespace, "utf8")).includes("*")) {
      failures.push("mutation control does not trip: a namespace import was not detected");
    }

    const badBare = write("bad-bare.ts", 'import "@/lib/engine";\n');
    if (!engineImportNames(badBare, fs.readFileSync(badBare, "utf8")).includes("*")) {
      failures.push("mutation control does not trip: a bare side-effect import was not detected");
    }

    // R29 mutation controls 1-2 and 5 need a specifier that GENUINELY
    // resolves to the real `src/lib/engine.ts` from a probe file sitting
    // under an unrelated OS temp directory — a hand-typed guess like
    // `"../../lib/engine"` would resolve relative to the PROBE directory,
    // not the repo, and would prove nothing. Computed here, once, the same
    // way `resolveSpecifier` itself would walk it: `path.relative` from the
    // probe importer's own directory back to `TARGET_FILE`, extension
    // stripped (real import specifiers never carry `.ts`).
    const relativeDir = path.join(probeDir, "agent-like", "tools");
    fs.mkdirSync(relativeDir, { recursive: true });
    const relativeSpecifierToTarget = path
      .relative(relativeDir, TARGET_FILE)
      .replace(/\.ts$/, "")
      .split(path.sep)
      .join("/");

    // R29 mutation control 1: that GENUINE relative specifier must trip.
    // Named (`{ engineJson }`), not default/namespace/bare, so the correct
    // detection here is the literal name "engineJson" — not "*", which is
    // reserved for the shapes with no named binding to check.
    const badRelative = write(
      path.join("agent-like", "tools", "bad-relative.ts"),
      `import { engineJson } from "${relativeSpecifierToTarget}";\n`,
    );
    if (!engineImportNames(badRelative, fs.readFileSync(badRelative, "utf8")).includes("engineJson")) {
      failures.push("mutation control does not trip: a relative import resolving to the same file was not detected");
    }

    // R29 mutation control 2: a relative specifier that does NOT resolve to
    // the target (a sibling filename, one directory further out) must NOT
    // trip — proves resolution is doing real path arithmetic against the
    // filesystem, not a loose substring match against "lib/engine".
    const badRelativeWrong = write(
      path.join("agent-like", "tools", "unrelated-relative.ts"),
      `import { somethingElse } from "${relativeSpecifierToTarget}-adjacent-but-different";\n`,
    );
    if (engineImportNames(badRelativeWrong, fs.readFileSync(badRelativeWrong, "utf8")).length !== 0) {
      failures.push("mutation control is over-broad: a relative import to a DIFFERENT file was flagged");
    }

    // R29 mutation control 3: dynamic `import()`, alias specifier.
    const badDynamicImport = write("bad-dynamic-import.ts", 'async function f() { await import("@/lib/engine"); }\n');
    if (!engineImportNames(badDynamicImport, fs.readFileSync(badDynamicImport, "utf8")).includes("*")) {
      failures.push("mutation control does not trip: a dynamic import() of the alias specifier was not detected");
    }

    // R29 mutation control 4: `require()`, template-literal argument — the
    // exact second shape assert-agent-boundary.mjs's own E2 fix round named.
    const badRequireTemplate = write("bad-require-template.ts", "const engine = require(`@/lib/engine`);\n");
    if (!engineImportNames(badRequireTemplate, fs.readFileSync(badRequireTemplate, "utf8")).includes("*")) {
      failures.push("mutation control does not trip: a require() with a template-literal argument was not detected");
    }

    // R29 mutation control 5: dynamic `import()` of a RELATIVE specifier —
    // both hardenings composed on the same call.
    const badDynamicRelative = write(
      path.join("agent-like", "tools", "bad-dynamic-relative.ts"),
      `async function f() { await import("${relativeSpecifierToTarget}"); }\n`,
    );
    if (!engineImportNames(badDynamicRelative, fs.readFileSync(badDynamicRelative, "utf8")).includes("*")) {
      failures.push("mutation control does not trip: a dynamic import() of a relative specifier was not detected");
    }

    // Non-vacuity: an ordinary function call named neither `require` nor a
    // dynamic `import` must never be flagged, even if its first argument is
    // the literal target path — proves the AST walk keys on the CALLEE, not
    // on "any call whose argument looks like a path".
    const notACredentialCall = write("not-a-credential-call.ts", 'logPath("@/lib/engine");\n');
    if (engineImportNames(notACredentialCall, fs.readFileSync(notACredentialCall, "utf8")).length !== 0) {
      failures.push("mutation control is over-broad: an unrelated function call was flagged as a dynamic import");
    }

    // Non-vacuity, direction 1: the two allowed exports must NOT be flagged
    // by the caller loop above (checked here at the name-extraction level,
    // since that loop only runs over real repo files).
    const goodAllowed = write(
      "good-allowed.ts",
      'import { EngineHttpError, safeEngineSentence } from "@/lib/engine";\n',
    );
    const goodNames = engineImportNames(goodAllowed, fs.readFileSync(goodAllowed, "utf8"));
    if (goodNames.some((name) => !ALLOWED.has(name))) {
      failures.push("mutation control is over-broad: EngineHttpError/safeEngineSentence were flagged");
    }

    // Non-vacuity, direction 2: an unrelated module must never be flagged.
    const unrelated = write("unrelated.ts", 'import { clientJson } from "@/lib/product";\n');
    if (engineImportNames(unrelated, fs.readFileSync(unrelated, "utf8")).length !== 0) {
      failures.push("mutation control is over-broad: an unrelated @/lib/product import was flagged");
    }
  } finally {
    fs.rmSync(probeDir, { recursive: true, force: true });
  }
}

if (failures.length > 0) {
  console.error("assert-agent-service-credential failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(
  "assert-agent-service-credential — nothing under src/agent/ reaches for the service-only @/lib/engine credential, by alias, by relative path, or dynamically",
);
