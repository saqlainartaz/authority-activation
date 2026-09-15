#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const rel = (file) => path.relative(ROOT, file).split(path.sep).join("/");
const roots = ["src", "e2e"].map((directory) => path.join(ROOT, directory));
function filesIn(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? filesIn(file) : /\.tsx?$/.test(entry.name) ? [file] : [];
  });
}
const files = roots.flatMap(filesIn).sort();
if (files.length === 0) throw new Error("walked zero production files");
const parsed = new Map(files.map((file) => [rel(file), ts.createSourceFile(file, fs.readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true)]));
const results = [];
function walk(node, visit) { visit(node); ts.forEachChild(node, (child) => walk(child, visit)); }
function at(source, node) { return `${rel(source.fileName)}:${source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1}`; }
function assert(name, ok, detail = []) { results.push({ name, ok, detail }); }
function source(file) { return parsed.get(file); }
function text(file) { return source(file)?.getFullText() ?? ""; }
function imports(file) {
  const found = [];
  const current = source(file);
  if (!current) return found;
  walk(current, (node) => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) found.push(node);
  });
  return found;
}
function isClient(file) {
  const first = source(file)?.statements[0];
  return Boolean(first && ts.isExpressionStatement(first) && ts.isStringLiteral(first.expression) && first.expression.text === "use client");
}
function namedCalls(file, name) {
  const found = [];
  const current = source(file);
  if (current) walk(current, (node) => { if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === name) found.push(node); });
  return found;
}
function topExports(file) {
  const exports = [];
  for (const statement of source(file)?.statements ?? []) {
    const exported = statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword);
    if (!exported) continue;
    if (ts.isVariableStatement(statement)) for (const declaration of statement.declarationList.declarations) if (ts.isIdentifier(declaration.name)) exports.push(declaration.name.text);
    if ((ts.isFunctionDeclaration(statement) || ts.isTypeAliasDeclaration(statement) || ts.isInterfaceDeclaration(statement)) && statement.name) exports.push(statement.name.text);
  }
  return exports.sort();
}
function moduleCollections(file) {
  const found = [];
  const current = source(file);
  for (const statement of current?.statements ?? []) if (ts.isVariableStatement(statement)) for (const declaration of statement.declarationList.declarations) {
    if (ts.isIdentifier(declaration.name) && /cache|response|replay|provision/i.test(declaration.name.text) && declaration.initializer && ts.isNewExpression(declaration.initializer) && ts.isIdentifier(declaration.initializer.expression) && ["Map", "Set"].includes(declaration.initializer.expression.text)) found.push(at(current, declaration));
  }
  return found;
}

// 1. Exactly three browser-display preferences may be persisted. The inline script
// is parsed as JavaScript, so a comment or an unparsed template cannot satisfy it.
{
  const failures = [];
  const storage = [];
  for (const [file, current] of parsed) walk(current, (node) => {
    if (ts.isIdentifier(node) && (node.text === "localStorage" || node.text === "sessionStorage")) storage.push({ file, node });
  });
  const direct = storage.filter(({ file, node }) => file === "src/lib/preferences.tsx" && node.text === "localStorage");
  const foreign = storage.filter(({ file, node }) => file !== "src/lib/preferences.tsx" || node.text !== "localStorage");
  if (direct.length !== 2) failures.push(`preferences provider has ${direct.length} localStorage identifiers, expected 2`);
  failures.push(...foreign.map(({ file, node }) => `${file}:${source(file).getLineAndCharacterOfPosition(node.getStart()).line + 1} foreign ${node.text}`));
  const contract = source("src/lib/preferences-contract.ts");
  const preference = contract?.statements.find((statement) => ts.isInterfaceDeclaration(statement) && statement.name.text === "Preferences");
  const fields = preference ? preference.members.filter(ts.isPropertySignature).map((member) => member.name.getText(contract)) : [];
  const expected = ["theme", "sidebarCollapsed", "libraryViewMode"];
  if (JSON.stringify(fields) !== JSON.stringify(expected)) failures.push(`preference schema is ${JSON.stringify(fields)}, expected ${JSON.stringify(expected)}`);
  const layout = source("src/app/layout.tsx");
  let script = null;
  for (const statement of layout?.statements ?? []) if (ts.isVariableStatement(statement)) for (const declaration of statement.declarationList.declarations) {
    if (ts.isIdentifier(declaration.name) && declaration.name.text === "themeScript" && declaration.initializer && ts.isTemplateExpression(declaration.initializer) && declaration.initializer.templateSpans.length === 1) {
      const [span] = declaration.initializer.templateSpans;
      script = ts.createSourceFile("theme-script.js", `${declaration.initializer.head.text}${JSON.stringify("aa-preferences-v1")}${span.literal.text}`, ts.ScriptTarget.Latest, true);
    }
  }
  let scriptReads = 0;
  const scriptFields = [];
  if (script) walk(script, (node) => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && ts.isIdentifier(node.expression.expression) && node.expression.expression.text === "localStorage" && node.expression.name.text === "getItem" && ts.isStringLiteral(node.arguments[0]) && node.arguments[0].text === "aa-preferences-v1") scriptReads += 1;
    if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "s") scriptFields.push(node.name.text);
  });
  if (!script || scriptReads !== 1 || JSON.stringify(scriptFields) !== JSON.stringify(["theme"])) failures.push("pre-paint theme script is not one structural aa-preferences-v1 theme read");
  const guardText = text("scripts/assert-no-fabricated-state.mjs");
  if (guardText.includes("store" + ".tsx") || guardText.includes("legacy" + "Allowance")) failures.push("final guard retains a store-path legacy allowance");
  assert("1. storage schema is exactly theme/sidebarCollapsed/libraryViewMode; inline theme read is structural; session storage is absent", failures.length === 0, failures);
}

// 2. UTC parsing has exactly one declaration and every imported consumer points at it.
{
  const declarations = [];
  for (const [file, current] of parsed) walk(current, (node) => { if (ts.isFunctionDeclaration(node) && node.name?.text === "parseISO") declarations.push(`${file}:${current.getLineAndCharacterOfPosition(node.getStart(current)).line + 1}`); });
  const consumers = [];
  for (const [file, current] of parsed) for (const entry of imports(file)) {
    if (!ts.isImportDeclaration(entry) || !ts.isStringLiteral(entry.moduleSpecifier)) continue;
    const names = entry.importClause?.namedBindings;
    if (entry.moduleSpecifier.text === "@/lib/dates" && names && ts.isNamedImports(names) && names.elements.some((element) => element.name.text === "parseISO")) consumers.push(file);
    if (entry.moduleSpecifier.text.includes("store") && entry.getText(current).includes("parseISO")) consumers.push(`${file} imports parseISO from a legacy path`);
  }
  const failures = declarations.length === 1 && declarations[0].startsWith("src/lib/dates.ts:") && consumers.length > 0 && consumers.every((entry) => !entry.includes("legacy path")) ? [] : [`declarations=${JSON.stringify(declarations)}`, `resolved consumers=${JSON.stringify(consumers)}`];
  assert("2. whole-tree parseISO declaration is singleton src/lib/dates.ts and consumers import its export", failures.length === 0, failures);
}

// 3. Product fixtures are gone and content is a copy-only export surface.
{
  const failures = [];
  for (const file of ["src/lib/" + "store.tsx", "src/lib/use-loading.ts"]) if (source(file)) failures.push(`${file} still exists`);
  const expected = ["brand", "login", "trainYourAi", "compose", "nav", "library", "calendar"].sort();
  const exports = topExports("src/lib/content.ts");
  if (JSON.stringify(exports) !== JSON.stringify(expected)) failures.push(`content exports=${JSON.stringify(exports)}`);
  const forbidden = ["DEMO_TODAY", "person", "knownFacts", "confirmation", "onboarding", "onboardingResolves", "ontology", "evidenceLibrary", "calendarSeed", "DraftSeg", "Objective", "inferObjective", "objectiveById", "slotAtom", "profilePage"];
  for (const name of forbidden) if (exports.includes(name)) failures.push(`content retains seed export ${name}`);
  const content = source("src/lib/content.ts");
  let productRecordArray = false;
  let functionExport = false;
  walk(content, (node) => { if (ts.isArrayLiteralExpression(node) && node.elements.some(ts.isObjectLiteralExpression)) productRecordArray = true; if (ts.isFunctionDeclaration(node) && node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)) functionExport = true; });
  if (productRecordArray || functionExport) failures.push("content contains a product-record array or exported data-manufacturing function");
  for (const [file, current] of parsed) for (const entry of imports(file)) if (ts.isImportDeclaration(entry) && ts.isStringLiteral(entry.moduleSpecifier) && entry.moduleSpecifier.text === "@/lib/content" && entry.importClause?.namedBindings && ts.isNamedImports(entry.importClause.namedBindings)) {
    for (const named of entry.importClause.namedBindings.elements) if (!expected.includes(named.propertyName?.text ?? named.name.text)) failures.push(`${file} imports deleted content member ${named.getText(current)}`);
  }
  assert("3. store/loading are absent and content.ts is the exact copy-only allowlist", failures.length === 0, failures);
}

// 4. Browser components can name product wire types, never server values; response state is not cached at module scope.
{
  const failures = [];
  for (const [file, current] of parsed) {
    if (isClient(file)) for (const entry of imports(file)) if (ts.isImportDeclaration(entry) && ts.isStringLiteral(entry.moduleSpecifier) && entry.moduleSpecifier.text === "@/lib/product" && !entry.importClause?.isTypeOnly) failures.push(`${at(current, entry)} client product import is not type-only`);
    failures.push(...moduleCollections(file).map((site) => `${site} module-level mutable response container`));
  }
  assert("4. client product imports are type-only and no module-level response cache/map/set exists", failures.length === 0, failures);
}

// 5. Campaigns receives one exact profile/campaign/setup envelope and shares it with all three consumers.
{
  const file = "src/app/(app)/campaigns/page.tsx", profileRoute = "src/app/api/client/profile/route.ts", form = "src/components/campaigns/CampaignCreateForm.tsx";
  const failures = [];
  const route = source(profileRoute);
  const reads = namedCalls(file, "getJson");
  if (reads.length !== 1 || !ts.isStringLiteral(reads[0]?.arguments[0]) || reads[0].arguments[0].text !== "/api/client/profile") failures.push("Campaigns must make one getJson('/api/client/profile') read");
  if (text(file).includes("/api/client/campaigns")) failures.push("Campaigns retains a direct campaigns GET path");
  const reactImport = imports(file).find((entry) => ts.isImportDeclaration(entry) && ts.isStringLiteral(entry.moduleSpecifier) && entry.moduleSpecifier.text === "react");
  const reactNames = reactImport?.importClause?.namedBindings && ts.isNamedImports(reactImport.importClause.namedBindings) ? reactImport.importClause.namedBindings.elements.map((element) => element.name.text) : [];
  if (!["useCallback", "useEffect", "useRef", "useState"].every((name) => reactNames.includes(name))) failures.push("Campaigns React import must include useRef with its lifecycle hooks");
  const refDeclaration = text(file).match(/const\s+initialLoadStarted\s*=\s*useRef\(false\)/);
  const effect = text(file).match(/useEffect\(\(\)\s*=>\s*\{([\s\S]*?)\},\s*\[load\]\)/)?.[1] ?? "";
  if (!refDeclaration || !/if\s*\(initialLoadStarted\.current\)\s*return/.test(effect) || !/initialLoadStarted\.current\s*=\s*true/.test(effect) || effect.indexOf("initialLoadStarted.current = true") > effect.indexOf("load")) failures.push("Campaigns lacks the logical-mount one-shot before load");
  if (!/useState<ProfileStatusState>\(\{\s*kind:\s*["']loading["']\s*\}\)/.test(text(file)) || !/<PageHeader[\s\S]*profileStatus=\{profileStatus\}/.test(text(file))) failures.push("Campaigns must pass a loading profile snapshot from its first render");
  if (!/const\s+response\s*=\s*await\s+getJson<ProfileCampaignsResponse>\("\/api\/client\/profile"\)/.test(text(file)) || !/setEnvelope\(\{\s*campaigns,\s*active_count,\s*active_cap,\s*generated_at\s*\}\)/.test(text(file)) || !/setProfileStatus\(\{\s*kind:\s*["']ready["'],\s*profile:\s*response\s*\}\)/.test(text(file))) failures.push("Campaigns does not project its envelope and ready profile from one response binding");
  if (!/setCampaignSetup\(campaign_setup\)/.test(text(file)) || !/<CampaignCreateForm[\s\S]*setup=\{campaignSetup\}/.test(text(file))) failures.push("Campaigns does not pass campaign_setup from the shared profile response to CampaignCreateForm");
  if (namedCalls(form, "getJson").length !== 0 || /\bgetJson\b/.test(text(form))) failures.push("CampaignCreateForm retains a mount GET instead of consuming shared setup");
  if (!/catch\s*\(caught\)[\s\S]*setError\(caught\)[\s\S]*setProfileStatus\(\{\s*kind:\s*["']error["'],\s*error:\s*caught\s*\}\)/.test(text(file)) || !/const\s+reload\s*=\s*useCallback\(\(\)\s*=>\s*\{[\s\S]*setError\(null\)[\s\S]*setProfileStatus\(\{\s*kind:\s*["']loading["']\s*\}\)[\s\S]*void\s+load\(\)/.test(text(file))) failures.push("Campaign reload/error state does not drive the profile snapshot");
  if (namedCalls(profileRoute, "listClientCampaigns").length !== 1) failures.push("profile route must issue exactly one authenticated campaign read");
  let responseObject = null;
  walk(route, (node) => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.expression.getText(route) === "Response" && node.expression.name.text === "json" && ts.isObjectLiteralExpression(node.arguments[0])) responseObject = node.arguments[0];
  });
  const keysOf = (object) => object?.properties.filter(ts.isPropertyAssignment).map((property) => property.name.getText(route).replace(/["']/g, "")).sort() ?? [];
  const property = (object, name) => object?.properties.find((entry) => ts.isPropertyAssignment(entry) && entry.name.getText(route).replace(/["']/g, "") === name)?.initializer ?? null;
  const mappedObject = (initializer) => {
    if (!initializer || !ts.isCallExpression(initializer) || !ts.isPropertyAccessExpression(initializer.expression) || initializer.expression.name.text !== "map" || !ts.isArrowFunction(initializer.arguments[0])) return null;
    const body = initializer.arguments[0].body;
    return ts.isObjectLiteralExpression(body) ? body : ts.isParenthesizedExpression(body) && ts.isObjectLiteralExpression(body.expression) ? body.expression : null;
  };
  const campaignObject = mappedObject(property(responseObject, "campaigns"));
  const setupObject = property(responseObject, "campaign_setup");
  const setupPlayObject = setupObject && ts.isObjectLiteralExpression(setupObject) ? mappedObject(property(setupObject, "plays")) : null;
  const expectedTop = ["identity", "voice_profile", "document_count", "atom_count", "grounding_gap", "last_ingested_at", "topic_suggestions", "campaigns", "active_count", "active_cap", "generated_at", "campaign_setup"].sort();
  const expectedCampaign = ["campaign_id", "period_id", "play_id", "objective", "starts_on", "ends_on", "is_active", "created_at"].sort();
  const expectedSetup = ["plays", "selected_play_id"].sort();
  const expectedSetupPlay = ["play_id", "eligible"].sort();
  if (JSON.stringify(keysOf(responseObject)) !== JSON.stringify(expectedTop)) failures.push(`profile runtime keys=${JSON.stringify(keysOf(responseObject))}`);
  if (JSON.stringify(keysOf(campaignObject)) !== JSON.stringify(expectedCampaign)) failures.push(`profile campaign keys=${JSON.stringify(keysOf(campaignObject))}`);
  if (!setupObject || !ts.isObjectLiteralExpression(setupObject) || JSON.stringify(keysOf(setupObject)) !== JSON.stringify(expectedSetup)) failures.push(`profile campaign_setup keys=${JSON.stringify(setupObject && ts.isObjectLiteralExpression(setupObject) ? keysOf(setupObject) : [])}`);
  if (JSON.stringify(keysOf(setupPlayObject)) !== JSON.stringify(expectedSetupPlay)) failures.push(`profile campaign_setup play keys=${JSON.stringify(keysOf(setupPlayObject))}`);
  if (keysOf(responseObject).includes("client_id") || text(profileRoute).match(/Response\.json\([\s\S]*\.{3}/)) failures.push("profile response leaks client_id or uses an upstream spread");
  for (const needle of ["active_count: envelope.active_count", "active_cap: envelope.active_cap", "generated_at: envelope.generated_at"]) if (!text(profileRoute).includes(needle)) failures.push(`profile route omits ${needle}`);
  for (const needle of ["active_count", "active_cap"]) if (!text(file).includes(needle)) failures.push(`Campaigns does not render response field ${needle}`);
  if (!text("src/components/campaigns/CampaignList.tsx").includes("campaign.is_active")) failures.push("CampaignList does not render response activity");
  assert("5. Campaigns shares one exact profile/campaign/setup response across page, header, and form", failures.length === 0, failures);
}

// 6. The app shell keeps request-scoped server promises at its provider boundary.
{
  const appLayout = "src/app/(app)/layout.tsx";
  const failures = [];
  if (isClient(appLayout)) failures.push("(app) layout became a client component");
  if (namedCalls(appLayout, "clientToken").length !== 1 || namedCalls(appLayout, "readContentItems").length !== 1) failures.push("(app) layout must call clientToken and readContentItems exactly once");
  if (!text(appLayout).includes("<ContentItemsProvider contentItems={contentItems}>") || !text(appLayout).includes("<ShellIdentityProvider shellIdentity={shellIdentity}>")) failures.push("provider promise boundary changed");
  const appShell = source("src/components/app/AppShell.tsx");
  for (const entry of imports("src/components/app/AppShell.tsx")) if (ts.isImportDeclaration(entry) && ts.isStringLiteral(entry.moduleSpecifier) && ["@/lib/product", "@/lib/client-session", "@/lib/client-token"].includes(entry.moduleSpecifier.text) && !entry.importClause?.isTypeOnly) failures.push(`${at(appShell, entry)} AppShell value-imports server module`);
  assert("6. server layout preserves one request-scoped content promise and AppShell has no server value import", failures.length === 0, failures);
}

// 7. Compose renders the authoritative hook and retains only an opaque URL session id.
{
  const compose = "src/app/(app)/compose/page.tsx", bff = "src/app/api/client/chat/sessions/route.ts", poll = "src/app/api/client/chat/sessions/[sessionId]/route.ts";
  const failures = [];
  for (const needle of ["useChatSession", "next.set(\"session\", restoredId)", "session?.session.id", "ChatPath"]) if (!text(compose).includes(needle)) failures.push(`Compose chat session link missing ${needle}`);
  for (const forbidden of ["ModeChoice", "PlatformStep", "ObjectiveStep", "GroundingStep", "useGenerationJob"]) if (text(compose).includes(forbidden)) failures.push(`Compose exposes retired primary-journey state ${forbidden}`);
  for (const needle of ["const CREATE_KEYS", "Object.keys(raw).some", "message", "idempotency_key", "createChatSession(token, body)", "activeChatSession(token)"]) if (!text(bff).includes(needle)) failures.push(`chat BFF is missing ${needle}`);
  for (const needle of ["await params", "clientToken()", "readChatSession(token, sessionId)"]) if (!text(poll).includes(needle)) failures.push(`chat poll BFF is missing ${needle}`);
  for (const file of [compose, bff, poll]) failures.push(...moduleCollections(file).map((site) => `${site} uses process-memory enforcement`));
  assert("7. Compose → authoritative hook → same-origin BFF → URL-held server session", failures.length === 0, failures);
}

console.log(`assert-no-fabricated-state — scope: ${files.length} files under src/ and e2e/`);
for (const result of results) {
  console.log(`${result.ok ? "PASS" : "FAIL"} ${result.name}`);
  for (const detail of result.detail) console.log(`  ${detail}`);
}
const failed = results.filter((result) => !result.ok);
if (failed.length) process.exit(1);
console.log(`all ${results.length} structural assertions hold`);
