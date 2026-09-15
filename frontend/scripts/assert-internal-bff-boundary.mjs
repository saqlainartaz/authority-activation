#!/usr/bin/env node
// Security boundary for Plan 25's passcode-gated internal BFF and Plan 13's panels.
// It intentionally uses TypeScript ASTs instead of comments/greps for export and gate order.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ROUTES = {
  "src/app/api/internal/clients/[clientId]/users/route.ts": ["GET", "POST"],
  "src/app/api/internal/clients/[clientId]/onboarding-tokens/route.ts": ["GET"],
  "src/app/api/internal/clients/[clientId]/onboarding-tokens/[tokenId]/revoke/route.ts": ["POST"],
  "src/app/api/internal/clients/[clientId]/documents/[documentId]/route.ts": ["GET", "POST", "DELETE"],
  "src/app/api/internal/clients/[clientId]/search/route.ts": ["POST"],
};
const PANEL_PATHS = {
  people: ["src/app/internal/panels.tsx", "src/app/internal/people-panel.tsx"],
  tokens: ["src/app/internal/panels.tsx", "src/app/internal/tokens-panel.tsx"],
  "documents-search": [
    "src/app/internal/panels.tsx",
    "src/app/internal/documents-panel.tsx",
    "src/app/internal/search-panel.tsx",
  ],
};
const ALL_PANELS = [...new Set(Object.values(PANEL_PATHS).flat())];
const args = process.argv.slice(2);

if (args.includes("--help")) {
  console.log("Usage: node scripts/assert-internal-bff-boundary.mjs --bff | --panels [--scope people|tokens|documents-search]");
  process.exit(0);
}
const panelMode = args.includes("--panels");
const bffMode = args.includes("--bff");
const scopeAt = args.indexOf("--scope");
const scope = scopeAt >= 0 ? args[scopeAt + 1] : null;
if ((bffMode === panelMode) || (scopeAt >= 0 && (!panelMode || !PANEL_PATHS[scope])) || args.some((arg, index) => !["--bff", "--panels", "--scope", scope].includes(arg) && !(scopeAt >= 0 && index === scopeAt + 1))) {
  console.error("Use exactly --bff or --panels [--scope people|tokens|documents-search].");
  process.exit(2);
}

const results = [];
const assert = (name, ok, detail) => results.push({ name, ok, detail });
const absolute = (relative) => path.join(ROOT, relative);
const parse = (relative) => {
  const file = absolute(relative);
  if (!fs.existsSync(file)) return null;
  return ts.createSourceFile(file, fs.readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
};
const walk = (node, visit) => { visit(node); ts.forEachChild(node, (child) => walk(child, visit)); };
const line = (source, node) => `${source.fileName.slice(ROOT.length + 1).split(path.sep).join("/")}:${source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1}`;
const exportedFunctions = (source) => source.statements.filter((statement) =>
  ts.isFunctionDeclaration(statement) && statement.name && statement.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword),
);

function checkBff() {
  const parsed = new Map(Object.keys(ROUTES).map((route) => [route, parse(route)]));
  const present = [...parsed.values()].filter(Boolean).length;
  assert("exact five-route BFF manifest is present", present === 5, `observed ${present}/5 routes`);
  let exportsSeen = 0;
  for (const [route, expected] of Object.entries(ROUTES)) {
    const source = parsed.get(route);
    if (!source) continue;
    const functions = exportedFunctions(source);
    const names = functions.map((fn) => fn.name.text).sort();
    exportsSeen += names.length;
    assert(`${route} exports ${expected.join(", ")}`, names.join(",") === [...expected].sort().join(","), names.join(",") || "none");
    for (const fn of functions) {
      const first = fn.body?.statements[0];
      const gate = first && ts.isIfStatement(first) && first.expression.getText(source).includes("checkInternalPasscode(request)");
      assert(`${route}:${fn.name.text} checks passcode before params, body, or helpers`, Boolean(gate), first ? line(source, first) : "empty handler");
    }
    const text = source.getFullText();
    assert(`${route} has no raw spread allowlist bypass`, !/\.\.\./.test(text), "spread expression found");
    assert(`${route} has no raw upstream error forwarding`, !/error\.message|\.text\(\)/.test(text), "raw error/message access found");
  }
  assert("exactly eight BFF method exports are non-vacuously checked", exportsSeen === 8, String(exportsSeen));

  const users = parsed.get("src/app/api/internal/clients/[clientId]/users/route.ts")?.getFullText() ?? "";
  const tokens = parsed.get("src/app/api/internal/clients/[clientId]/onboarding-tokens/route.ts")?.getFullText() ?? "";
  const revoke = parsed.get("src/app/api/internal/clients/[clientId]/onboarding-tokens/[tokenId]/revoke/route.ts")?.getFullText() ?? "";
  const document = parsed.get("src/app/api/internal/clients/[clientId]/documents/[documentId]/route.ts")?.getFullText() ?? "";
  const search = parsed.get("src/app/api/internal/clients/[clientId]/search/route.ts")?.getFullText() ?? "";
  assert("users uses the exact email/display_name/profession request manifest", ["email: raw.email", "display_name: raw.display_name", "profession: raw.profession"].every((field) => users.includes(field)), "user request manifest");
  assert("users project exactly six operator response fields", ["id:", "email:", "display_name:", "profession:", "status:", "created_at:"].every((field) => users.includes(field)) && !users.includes("client_id: user"), "user response manifest");
  assert("tokens and revoke project exactly five non-secret fields", [tokens, revoke].every((text) => ["id:", "user_id:", "issued_at:", "revoked_at:", "last_used_at:"].every((field) => text.includes(field)) && !/token_hash|token\s*:\s*token\./.test(text)), "token response manifest");
  assert("document detail projects the pipeline lineage allowlist and reprocess reads no body", ["id:", "source_type:", "source_authority:", "status:", "pipeline_version:", "created_at:", "atom_count:", "pipeline_stages:", "stage:", "actor:", "completed_at:"].every((field) => document.includes(field)) && !document.includes("request.json"), "document manifest");
  assert("search accepts only query/type/limit and projects hit/source allowlists", ["query: raw.query", "type: raw.type", "limit: raw.limit", "document_id:", "source_type:", "source_authority:"].every((field) => search.includes(field)), "search manifest");

  for (const helper of ["src/lib/product.ts", "src/lib/engine.ts"]) {
    const source = parse(helper);
    const opensServerOnly = source && source.statements[0] && ts.isImportDeclaration(source.statements[0]) && source.statements[0].moduleSpecifier.getText(source) === '"server-only"';
    assert(`${helper} opens with server-only`, Boolean(opensServerOnly), helper);
  }
  const sourceFiles = [];
  const collect = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) collect(full);
      else if (/\.tsx?$/.test(entry.name)) sourceFiles.push(full);
    }
  };
  collect(path.join(ROOT, "src"));
  const credentialReaders = sourceFiles.filter((file) => /process\.env\.(ENGINE_URL|ENGINE_SERVICE_KEY)/.test(fs.readFileSync(file, "utf8"))).map((file) => path.relative(ROOT, file).split(path.sep).join("/"));
  assert("only server-only product/engine helpers read engine credentials", credentialReaders.every((file) => ["src/lib/product.ts", "src/lib/engine.ts"].includes(file)), credentialReaders.join(",") || "none");
  const engine = parse("src/lib/engine.ts")?.getFullText() ?? "";
  assert("one engine credential core is retained", (engine.match(/async function engineFetch/g) ?? []).length === 1, "engineFetch count");
  assert("engine error mapper never forwards raw upstream text", !/error\.message|\$\{path\}.*\$\{text\}/.test(engine), "engine error mapper");

  const rawTokenCallers = sourceFiles.filter((file) => {
    const source = ts.createSourceFile(file, fs.readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
    let called = false;
    walk(source, (node) => {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "issueOnboardingTokenAsService") called = true;
    });
    return called;
  }).map((file) => path.relative(ROOT, file).split(path.sep).join("/"));
  assert("the raw onboarding-token helper has exactly the login-link caller", rawTokenCallers.length === 1 && rawTokenCallers[0] === "src/app/api/internal/client-login-link/route.ts", rawTokenCallers.join(",") || "none");
}

function checkPanels() {
  const required = scope ? PANEL_PATHS[scope] : ALL_PANELS;
  assert(`${scope ?? "unscoped"} panel manifest is complete`, required.every((file) => fs.existsSync(absolute(file))), required.filter((file) => !fs.existsSync(absolute(file))).join(",") || "all present");
  let internalCalls = 0;
  for (const file of required) {
    const source = parse(file);
    if (!source) continue;
    const text = source.getFullText();
    const apiCalls = [...text.matchAll(/["'`]([^"'`]*\/api\/[^"'`]*)["'`]/g)].map((match) => match[1]);
    internalCalls += apiCalls.filter((literal) => literal.startsWith("/api/internal/")).length;
    assert(`${file} uses no direct fetch, backend path, credential, or environment`, !/\bfetch\s*\(|\/v1\/|ENGINE_|X-API-Key|process\.env/.test(text), "browser boundary");
    assert(`${file} calls only same-origin internal API literals`, apiCalls.every((literal) => literal.startsWith("/api/internal/")), apiCalls.join(",") || "none");
    assert(`${file} has no server helper value import`, !/from\s+["']@\/lib\/(product|engine)["']/.test(text), "server helper import");
  }
  assert(`${scope ?? "unscoped"} panel manifest contains internal BFF call literals`, internalCalls > 0, String(internalCalls));
  if (required.includes("src/app/internal/panels.tsx")) {
    const panels = parse("src/app/internal/panels.tsx")?.getFullText() ?? "";
    assert(
      "confirmed atoms hide Confirm while retaining the non-deprecated action group",
      /atom\.status\s*!==\s*["']deprecated["'][\s\S]*atom\.status\s*!==\s*["']confirmed["'][\s\S]*>Confirm<\/Button>/.test(panels),
      "atom decision controls",
    );
  }
}

if (bffMode) checkBff();
if (panelMode) checkPanels();
let failed = 0;
console.log(`assert-internal-bff-boundary — ${bffMode ? "BFF" : `panels${scope ? ` (${scope})` : ""}`}`);
for (const result of results) {
  console.log(`${result.ok ? "PASS" : "FAIL"}  ${result.name} — ${result.detail}`);
  if (!result.ok) failed += 1;
}
if (failed) process.exit(1);
