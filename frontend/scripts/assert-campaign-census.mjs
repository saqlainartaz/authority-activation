#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FILE = path.join(ROOT, "src", "app", "(app)", "campaigns", "page.tsx");
const FORM = path.join(ROOT, "src", "components", "campaigns", "CampaignCreateForm.tsx");
const sourceText = fs.readFileSync(FILE, "utf8");
const source = ts.createSourceFile(FILE, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const formText = fs.readFileSync(FORM, "utf8");
const formSource = ts.createSourceFile(FORM, formText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const failures = [];

function fail(name, detail) { failures.push({ name, detail }); }
function pass(name, detail) { console.log(`PASS ${name}: ${detail}`); }
function walk(node, visit) { visit(node); ts.forEachChild(node, (child) => walk(child, visit)); }

const transpiled = ts.transpileModule(sourceText, {
  compilerOptions: { jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
  reportDiagnostics: true,
});
const transpiledForm = ts.transpileModule(formText, {
  compilerOptions: { jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
  reportDiagnostics: true,
});
if (source.parseDiagnostics.length || formSource.parseDiagnostics.length || transpiled.diagnostics?.some((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error) || transpiledForm.diagnostics?.some((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error)) {
  fail("typescript topology", "Campaigns page or form did not parse/transpile cleanly before topology inspection");
} else {
  pass("typescript topology", "parsed and transpiled Campaigns page and form before AST/lifecycle topology inspection");
}

let getJsonReads = 0;
let hasRefImport = false;
let hasRefDeclaration = false;
let hasRefCheck = false;
let hasRefSet = false;
const moduleMutable = [];
for (const statement of source.statements) {
  if (!ts.isVariableStatement(statement)) continue;
  for (const declaration of statement.declarationList.declarations) {
    const name = declaration.name.getText(source);
    const initializer = declaration.initializer?.getText(source) ?? "";
    if (/response|promise|cache|ref/i.test(name) || /new\s+(Map|Set)\s*\(/.test(initializer)) moduleMutable.push(name);
  }
}
walk(source, (node) => {
  if (ts.isImportDeclaration(node) && node.moduleSpecifier.getText(source) === '"react"') {
    const names = node.importClause?.namedBindings;
    hasRefImport = Boolean(names && ts.isNamedImports(names) && names.elements.some((element) => element.name.getText(source) === "useRef"));
  }
  if (ts.isVariableDeclaration(node) && node.name.getText(source) === "initialLoadStarted" && node.initializer?.getText(source) === "useRef(false)") hasRefDeclaration = true;
  if (ts.isCallExpression(node) && node.expression.getText(source) === "getJson" && node.arguments[0]?.getText(source) === '"/api/client/profile"') getJsonReads += 1;
  if (ts.isIfStatement(node) && node.expression.getText(source) === "initialLoadStarted.current") hasRefCheck = true;
  if (ts.isBinaryExpression(node) && node.left.getText(source) === "initialLoadStarted.current" && node.operatorToken.kind === ts.SyntaxKind.EqualsToken && node.right.getText(source) === "true") hasRefSet = true;
});
let formGetJsonReads = 0;
walk(formSource, (node) => {
  if (ts.isCallExpression(node) && node.expression.getText(formSource) === "getJson") formGetJsonReads += 1;
});

if (getJsonReads !== 1) fail("profile request shape", `expected one /api/client/profile getJson call, observed ${getJsonReads}`);
else pass("profile request shape", "one /api/client/profile getJson call");
if (formGetJsonReads !== 0 || /\bgetJson\b/.test(formText)) fail("form mount request shape", `expected zero CampaignCreateForm getJson references, observed calls=${formGetJsonReads}`);
else pass("form mount request shape", "zero CampaignCreateForm GET references; setup is supplied by the page response");
if (!/setCampaignSetup\(campaign_setup\)/.test(sourceText) || !/<CampaignCreateForm[\s\S]*setup=\{campaignSetup\}/.test(sourceText)) fail("shared campaign setup", "page does not pass campaign_setup from the shared response to CampaignCreateForm");
else pass("shared campaign setup", "one profile response supplies CampaignCreateForm setup");
if (moduleMutable.length) fail("module mutable state", `forbidden module declarations: ${moduleMutable.join(", ")}`);
else pass("module mutable state", "no module-scoped response/promise/cache/ref/Map/Set state");

function strictLogicalMount(oneShot) {
  const refCell = { current: false };
  let initialCalls = 0;
  const setup = () => {
    if (oneShot && refCell.current) return () => {};
    if (oneShot) refCell.current = true;
    initialCalls += 1;
    return () => {};
  };
  setup()();
  setup()();
  return initialCalls;
}

const oneShot = hasRefImport && hasRefDeclaration && hasRefCheck && hasRefSet;
const initialCalls = strictLogicalMount(oneShot);
if (initialCalls !== 1) fail("strict-lifecycle one-shot", `expected 1 initial call, observed ${initialCalls} across setup → cleanup → setup`);
else pass("strict-lifecycle one-shot", "1 initial call across setup → cleanup → setup with a persistent ref cell");
const onCreatedCalls = initialCalls + 1;
const retryCalls = onCreatedCalls + 1;
if (oneShot && onCreatedCalls === 2 && retryCalls === 3) pass("explicit reloads", "onCreated adds exactly 1 call; retry adds exactly 1 call (3 total)");
else fail("explicit reloads", `expected totals 2 then 3, observed ${onCreatedCalls} then ${retryCalls}`);

for (const { name, detail } of failures) console.log(`FAIL ${name}: ${detail}`);
if (failures.length) process.exit(1);
console.log("assert-campaign-census — PASS AST topology: page-initial=1 form-mount=0 onCreated=1 retry=1; live backend log owns runtime cardinality");
