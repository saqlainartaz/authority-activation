import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const root = path.resolve(import.meta.dirname, "..");
const mode = process.argv[2];
if (!new Set(["--gap", "--gap-mutations", "--home", "--home-mutations"]).has(mode) || process.argv.length !== 3) {
  throw new Error("usage: node scripts/assert-home-integration.mjs <--gap|--gap-mutations|--home|--home-mutations>");
}

const file = (relative) => path.join(root, relative);
const read = (relative) => fs.readFileSync(file(relative), "utf8");
const hash = (relative) => crypto.createHash("sha256").update(read(relative)).digest("hex");
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

const loadGap = () => {
  const gapFile = file("src/lib/grounding-gap.ts");
  const labelsFile = file("src/lib/atom-labels.ts");
  const labelsOutput = ts.transpileModule(fs.readFileSync(labelsFile, "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const labelsModule = { exports: {} };
  new Function("exports", "module", labelsOutput)(labelsModule.exports, labelsModule);
  const gapOutput = ts.transpileModule(fs.readFileSync(gapFile, "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const gapModule = { exports: {} };
  new Function("exports", "require", "module", gapOutput)(
    gapModule.exports,
    (request) => request === "@/lib/atom-labels" ? labelsModule.exports : (() => { throw new Error(`unexpected import ${request}`); })(),
    gapModule,
  );
  return gapModule.exports;
};

const assertGap = () => {
  const { computeGroundingGap } = loadGap();
  const empty = computeGroundingGap({});
  assert(JSON.stringify(empty) === JSON.stringify({ atom_count: 0, grounded_type_count: 0, missing_type_count: 9, total_type_count: 9, completeness_percent: 0 }), "zero fixture failed");
  const partial = computeGroundingGap({ tldr: 2, insight: 1, proof_point: 4, quote: 1, ignored: 99, pain_point: -2, objection: Number.NaN });
  assert(JSON.stringify(partial) === JSON.stringify({ atom_count: 8, grounded_type_count: 4, missing_type_count: 5, total_type_count: 9, completeness_percent: 44 }), "partial fixture failed");
  const all = computeGroundingGap({ tldr: 1, insight: 1, proof_point: 1, pain_point: 1, objection: 1, quote: 1, terminology: 1, voice_constraint: 1, claims_blacklist: 1, future: Infinity });
  assert(JSON.stringify(all) === JSON.stringify({ atom_count: 9, grounded_type_count: 9, missing_type_count: 0, total_type_count: 9, completeness_percent: 100 }), "complete fixture failed");
  const consumers = ["src/app/api/client/profile/route.ts", "src/app/(app)/train/page.tsx", "src/app/internal/panels.tsx"];
  for (const consumer of consumers) {
    const source = read(consumer);
    assert(source.includes('from "@/lib/grounding-gap"'), `${consumer} does not import the shared gap module`);
    assert(!/Object\.values\([^)]*atom_counts[^)]*\)\.reduce/.test(source), `${consumer} retains a local atom total formula`);
    assert(!/const\s+\w*(?:coverage|gap)\w*\s*=\s*\d+\s*\/\s*9/i.test(source), `${consumer} retains a local nine-type formula`);
  }
  console.log("gap: four raw-count fixtures and three-consumer shared import manifest passed");
};

const mutateAndRestore = (relative, from, to, label, assertion = assertGap) => {
  const before = read(relative);
  const beforeHash = hash(relative);
  assert(before.includes(from), `${label}: mutation target missing`);
  try {
    fs.writeFileSync(file(relative), before.replace(from, to));
    let red = false;
    try { assertion(); } catch { red = true; }
    assert(red, `${label}: mutation did not turn the guard red`);
  } finally {
    fs.writeFileSync(file(relative), before);
  }
  assert(read(relative) === before && hash(relative) === beforeHash, `${label}: byte/hash restore failed`);
};

if (mode === "--gap") assertGap();
if (mode === "--gap-mutations") {
  mutateAndRestore("src/app/(app)/train/page.tsx", 'from "@/lib/grounding-gap"', 'from "@/lib/grounding-gap-local"', "Train import");
  mutateAndRestore("src/app/internal/panels.tsx", 'from "@/lib/grounding-gap"', 'from "@/lib/grounding-gap-local"', "admin import");
  mutateAndRestore("src/app/(app)/train/page.tsx", "const groundingGap =", "const localCoverage = 1 / 9;\n  const groundingGap =", "Train local denominator");
  mutateAndRestore("src/app/internal/panels.tsx", "const groundingGap =", "const localCoverage = 1 / 9;\n  const groundingGap =", "admin local formula");
  console.log("gap mutations: local-consumer mutations turned red and restored byte-for-byte");
}

const assertHome = () => {
  const home = read("src/app/(app)/home/page.tsx");
  const status = read("src/components/app/ProfileStatus.tsx");
  const header = read("src/components/app/PageHeader.tsx");
  for (const endpoint of ["/api/client/awaiting-review", "/api/client/calendar", "/api/client/profile"]) {
    assert(home.includes(endpoint), `Home does not read ${endpoint}`);
  }
  assert(!/useStore|home\.empty\.suggestions|PROFILE_SLOTS|BASE_ATOMS/.test(home), "Home retains fabricated store or suggestion state");
  assert(home.includes("<DraftActions contentItemId") && home.includes("body={item.body}"), "Home does not pass the exact queued body into DraftActions");
  assert(home.includes("refreshAwaiting();") && home.includes("refreshCalendar();"), "Approve does not independently refresh queue and calendar once");
  assert(home.includes("topic_suggestions") && home.includes("Train Your AI"), "Home does not handle 0..3 real topics with the honest next action");
  assert(home.includes('from "@/lib/use-start-post"') && home.includes("onStart({ topic: topic.text })"), "Home does not route new posts and topic suggestions through the durable Start-a-post boundary");
  const rawComposeEntrypoints = [];
  for (const relative of ["src/app/(app)/home/page.tsx", "src/app/(app)/library/page.tsx", "src/components/app/Sidebar.tsx"]) {
    const source = read(relative);
    if (/href=["']\/compose["']|router\.push\(["']\/compose["']\)/.test(source)) rawComposeEntrypoints.push(relative);
  }
  assert(rawComposeEntrypoints.length === 0, `raw Compose entrypoints bypass provisioning: ${rawComposeEntrypoints.join(", ")}`);
  assert(!/items\.filter\(/.test(home), "Home filters held rows instead of surfacing the backend contract result");
  assert(!home.includes("Seeded topic"), "Home uses a seed topic fallback");
  assert(home.includes('Waiting on you</Eyebrow>{state.kind === "loading"'), "Home no longer keeps queue loading distinct from empty");
  assert(status.includes("export type ProfileStatusState") && status.includes("snapshot?: ProfileStatusState"), "ProfileStatus has no optional discriminated snapshot");
  assert(status.includes('getJson<ProfileSnapshot>("/api/client/profile")'), "ProfileStatus does not own its fallback profile read");
  assert(header.includes("profileStatus?: ProfileStatusState") && header.includes("<ProfileStatus snapshot={profileStatus}"), "PageHeader does not pass the optional Home snapshot through");
  console.log("home: independent live-region, DraftActions, cold-topic, profile snapshot, and ring-source contract passed");
};

if (mode === "--home") assertHome();
if (mode === "--home-mutations") {
  mutateAndRestore("src/app/(app)/home/page.tsx", "state.data.items.map((item) =>", "state.data.items.filter((item) => item.state !== \"held\").map((item) =>", "held-row client filter", assertHome);
  mutateAndRestore("src/app/(app)/home/page.tsx", "state.data.topic_suggestions", "[{ text: \"Seeded topic\", trust: \"untrusted\" }]", "seed topic fallback", assertHome);
  mutateAndRestore("src/app/(app)/home/page.tsx", 'Waiting on you</Eyebrow>{state.kind === "loading"', "Waiting on you</Eyebrow>{false", "loading treated as zero", assertHome);
  mutateAndRestore("src/app/(app)/home/page.tsx", "<DraftActions", "<DraftActionsRemoved", "queued body DraftActions path", assertHome);
  console.log("home mutations: held filter, seed fallback, loading collapse, and DraftActions omission turned red and restored byte-for-byte");
}
