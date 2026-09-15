#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const ROOT = path.resolve(import.meta.dirname, "..");
const files = {
  layout: "src/app/(app)/layout.tsx",
  shell: "src/components/app/AppShell.tsx",
  provider: "src/components/app/ContentItemsProvider.tsx",
  sidebar: "src/components/app/Sidebar.tsx",
  library: "src/app/(app)/library/page.tsx",
  postCard: "src/components/app/PostCard.tsx",
};
const source = Object.fromEntries(
  Object.entries(files).map(([name, file]) => {
    const absolute = path.join(ROOT, file);
    if (!fs.existsSync(absolute)) throw new Error(`missing required file: ${file}`);
    return [name, ts.createSourceFile(absolute, fs.readFileSync(absolute, "utf8"), ts.ScriptTarget.Latest, true)];
  }),
);
const text = Object.fromEntries(Object.entries(source).map(([name, file]) => [name, file.getFullText()]));
const results = [];
const assert = (name, ok, detail) => results.push({ name, ok, detail });
const walk = (node, visit) => { visit(node); ts.forEachChild(node, (child) => walk(child, visit)); };
const isUseClient = (file) => {
  const first = file.statements[0];
  return Boolean(first && ts.isExpressionStatement(first) && ts.isStringLiteral(first.expression) && first.expression.text === "use client");
};
const importPath = (node) => ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier) ? node.moduleSpecifier.text : null;
const typeOnly = (node) => {
  const clause = node.importClause;
  if (!clause) return false;
  if (clause.isTypeOnly) return true;
  const named = clause.namedBindings;
  return Boolean(named && ts.isNamedImports(named) && named.elements.length && named.elements.every((entry) => entry.isTypeOnly));
};
const valueImports = (file) => {
  const out = [];
  walk(file, (node) => {
    const specifier = importPath(node);
    if (specifier && !typeOnly(node)) out.push(specifier);
  });
  return out;
};
const callsNamed = (file, name) => {
  const out = [];
  walk(file, (node) => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === name) out.push(node);
  });
  return out;
};

assert("server layout has no use client directive", !isUseClient(source.layout), files.layout);
for (const name of ["shell", "provider", "sidebar", "library", "postCard"]) {
  assert(`${files[name]} is a client component`, isUseClient(source[name]), files[name]);
  const forbidden = valueImports(source[name]).filter((specifier) => /(^|\/)(reads|client-session|product)$/.test(specifier));
  assert(`${files[name]} has no server-only value import`, forbidden.length === 0, forbidden.join(", ") || "none");
  const directContentItemsRead = /["']\/api\/client\/content-items["']/.test(text[name]);
  assert(`${files[name]} has no client BFF content-items fetch`, !directContentItemsRead, "no direct endpoint literal");
}

assert("layout calls clientToken exactly once", callsNamed(source.layout, "clientToken").length === 1, String(callsNamed(source.layout, "clientToken").length));
assert("layout calls readContentItems exactly once", callsNamed(source.layout, "readContentItems").length === 1, String(callsNamed(source.layout, "readContentItems").length));
assert("provider uses a serializable tagged result union", /type ContentItemsResult\s*=/.test(text.provider) && ["ready", "unreachable", "refused", "expired"].every((kind) => text.provider.includes(`kind: "${kind}"`)), "ready/unreachable/refused/expired");
assert("provider carries no token prop or value", !/\btoken\b/.test(text.provider), "no token identifier");
assert("provider resolves its promise with React use", callsNamed(source.provider, "use").length === 1 && text.provider.includes("createContext<Promise<ContentItemsResult>"), "context promise + use()");
assert("sidebar consumes the shared provider result", callsNamed(source.sidebar, "useContentItems").length === 1, "one consumer hook");
assert("library consumes the shared provider result", callsNamed(source.library, "useContentItems").length === 1, "one consumer hook");
assert("library has a local Suspense loading fallback", text.library.includes("<Suspense fallback={<LibraryLoading />}") && text.library.includes("<SkeletonPostCard"), "Suspense + SkeletonPostCard");
assert("library renders all tagged result branches", ["unreachable", "refused", "expired", "ready"].every((kind) => text.library.includes(`result.kind === \"${kind}\"`)) || text.library.includes("result.library.items"), "unreachable/refused/expired/ready");
assert("library retry refreshes the server request without fetch", text.library.includes("router.refresh()") && !/fetch\s*\(/.test(text.library), "router.refresh only");
assert("library has no seeded posts read", !/\bposts\b/.test(text.library) && !/useStore\b/.test(text.library), "no seeded posts or store");
assert("library keeps the shipped empty heading and exact body", text.library.includes('"Nothing here yet."') && text.library.includes("Write your first post and it'll live here — every version of it."), "exact empty copy");
assert("library draft action uses the shared component", text.library.includes("<DraftActions"), "one DraftActions mount");
assert("library status pills use the shipped box geometry", text.postCard.includes("rounded-[8px] bg-surface-3 px-[10px] py-[5px]"), "px-[10px] py-[5px]");
assert("sidebar has a local Suspense loading fallback", text.sidebar.includes("<Suspense fallback={<ThreadLoading />}") && text.sidebar.includes("<LoadingRegion>") && text.sidebar.includes("<Skeleton"), "Suspense + LoadingRegion + Skeleton");
assert("sidebar renders all tagged result branches inside ThreadRows", ["unreachable", "refused", "expired", "ready"].every((kind) => text.sidebar.includes(`result.kind === "${kind}"`)) || text.sidebar.includes("result.library.items"), "unreachable/refused/expired/ready");
assert("unreachable retry refreshes the server request without fetch", text.sidebar.includes("router.refresh()") && !/fetch\s*\(/.test(text.sidebar), "router.refresh only");
assert("sidebar has no mock sessions read", !/\.sessions\b/.test(text.sidebar), "no .sessions property access");
assert("thread titles are rendered as text nodes", !text.sidebar.includes("dangerouslySetInnerHTML"), "no HTML injection");

function jsxAttributeText(element, name) {
  const attribute = element.attributes.properties.find((property) => ts.isJsxAttribute(property) && property.name.text === name);
  if (!attribute || !attribute.initializer) return "";
  if (ts.isStringLiteral(attribute.initializer)) return attribute.initializer.text;
  if (ts.isJsxExpression(attribute.initializer) && attribute.initializer.expression && ts.isStringLiteral(attribute.initializer.expression)) return attribute.initializer.expression.text;
  return "";
}
let primaryNavClass = "";
let threadRegionClass = "";
walk(source.sidebar, (node) => {
  if (!ts.isJsxElement(node)) return;
  const tag = node.openingElement.tagName.getText(source.sidebar);
  if (tag === "nav" && jsxAttributeText(node.openingElement, "aria-label") === "Primary") primaryNavClass = jsxAttributeText(node.openingElement, "className");
  if (jsxAttributeText(node.openingElement, "data-testid") === "sidebar-thread-region") threadRegionClass = jsxAttributeText(node.openingElement, "className");
});
assert("primary navigation is semantic and does not own overflow", Boolean(primaryNavClass) && !primaryNavClass.includes("overflow"), primaryNavClass || "missing nav[aria-label=Primary]");
assert("thread region is semantic and owns overflow-y", threadRegionClass.includes("overflow-y-auto") && text.sidebar.includes('aria-label="Recent threads"'), threadRegionClass || "missing thread region");

for (const result of results) console.log(`${result.ok ? "PASS" : "FAIL"} ${result.name} — ${result.detail}`);
if (results.some((result) => !result.ok)) process.exit(1);
