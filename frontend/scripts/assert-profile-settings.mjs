import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import ts from "typescript";

const root = path.resolve(import.meta.dirname, "..");
const nativeRequire = createRequire(path.join(root, "package.json"));
const mode = process.argv[2];
const modes = new Set(["--contracts", "--mutations", "--profile", "--settings", "--inert", "--all"]);

if (!modes.has(mode) || process.argv.length !== 3) {
  throw new Error("usage: node scripts/assert-profile-settings.mjs <--contracts|--mutations|--profile|--settings|--inert|--all>");
}

const file = (relative) => path.join(root, relative);
const read = (relative) => fs.readFileSync(file(relative), "utf8");
const hash = (relative) => crypto.createHash("sha256").update(read(relative)).digest("hex");
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};
const exactKeys = (value, keys, label) => {
  assert(value && typeof value === "object" && !Array.isArray(value), `${label} is not an object`);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  assert(actual.join("|") === expected.join("|"), `${label} keys were ${actual.join(",")}, expected ${expected.join(",")}`);
};

const resolveSource = (request, parent) => {
  const candidate = request.startsWith("@/")
    ? path.join(root, "src", request.slice(2))
    : path.resolve(path.dirname(parent), request);
  for (const suffix of ["", ".ts", ".tsx", ".js", ".jsx", "/index.ts", "/index.tsx"]) {
    const candidateFile = `${candidate}${suffix}`;
    if (fs.existsSync(candidateFile) && fs.statSync(candidateFile).isFile()) return candidateFile;
  }
  throw new Error(`could not resolve authored module ${request} from ${parent}`);
};

/** Loads route exports from their authored TypeScript with only boundary seams stubbed. */
const loadRoute = (relative, fakes) => {
  const cache = new Map();
  const load = (absolute) => {
    if (cache.has(absolute)) return cache.get(absolute).exports;
    const compiled = { exports: {} };
    cache.set(absolute, compiled);
    const output = ts.transpileModule(fs.readFileSync(absolute, "utf8"), {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.CommonJS,
        jsx: ts.JsxEmit.ReactJSX,
        esModuleInterop: true,
      },
      fileName: absolute,
    }).outputText;
    const authoredRequire = (request) => {
      if (fakes[request]) return fakes[request];
      if (request.startsWith("@/") || request.startsWith(".")) return load(resolveSource(request, absolute));
      return nativeRequire(request);
    };
    new Function("exports", "require", "module", "__filename", "__dirname", output)(
      compiled.exports,
      authoredRequire,
      compiled,
      absolute,
      path.dirname(absolute),
    );
    return compiled.exports;
  };
  return load(file(relative));
};

const makeContractRuntime = ({ token = "token", timezoneError = null } = {}) => {
  const calls = { session: 0, campaigns: 0, clients: 0, documents: 0, console: 0, onboarding: 0, resolve: 0, patch: 0 };
  const client = { id: "tenant id/with slash", name: "Abdul", status: "active", timezone: "Europe/Warsaw", created_at: "2026-01-01T00:00:00Z", hidden: "never publish" };
  const fakes = {
    "server-only": {},
    "@/lib/client-session": {
      clientToken: async () => { calls.session += 1; return token; },
      resolveClientId: async () => { calls.resolve += 1; return client.id; },
    },
    "@/lib/engine": {
      listClients: async () => { calls.clients += 1; return [client]; },
      listDocuments: async () => { calls.documents += 1; return [
        { created_at: "2026-03-01T00:00:00Z", private: true },
        { created_at: "2026-05-01T00:00:00Z", private: true },
        { created_at: "2026-02-01T00:00:00Z", private: true },
      ]; },
      updateClientTimezone: async (id, timezone) => {
        calls.patch += 1;
        calls.patchArgs = { id, timezone };
        if (timezoneError) throw timezoneError;
        return { ...client, timezone, secret: "no" };
      },
      EngineHttpError: class EngineHttpError extends Error {},
      forwardEngineError: (error) => Response.json({ error: error.message, detail: error.detail }, { status: error.status ?? 502 }),
    },
    "@/lib/product": {
      expiredLinkResponse: () => Response.json({ error: "expired" }, { status: 401 }),
      listClientCampaigns: async () => { calls.campaigns += 1; return {
        client_id: client.id,
        campaigns: [{ campaign_id: "campaign-1", objective: "A long objective", starts_on: "2026-01-01", ends_on: "2026-01-31", is_active: true, created_at: "2026-01-01T00:00:00Z", internal: "no" }],
      }; },
      getOnboarding: async () => { calls.onboarding += 1; return { user: { display_name: "Abdul", email: "abdul@example.com", profession: "Founder", internal: "no" }, answers: { insight: ["  Share the lesson  ", ""], quote: ["Use this line", "Share the lesson"], objection: ["  "], proof_point: ["A real result"] } }; },
      clientConsole: async () => { calls.console += 1; return { atom_counts: { claims: 2, examples: 5 }, voice_profile: { latest_version: 4, approved_version: null }, private: "no" }; },
      readJsonObject: async (request) => {
        const value = await request.json().catch(() => null);
        return value && typeof value === "object" && !Array.isArray(value) ? value : {};
      },
      forwardProductError: (error) => Response.json({ error: error instanceof Error ? error.message : "product error" }, { status: error.status ?? 502 }),
    },
  };
  return { calls, fakes };
};

const assertContracts = async () => {
  for (const relative of ["src/app/api/client/profile/route.ts", "src/app/api/client/timezone/route.ts"]) {
    assert(fs.existsSync(file(relative)), `${relative} is missing`);
  }
  const absent = makeContractRuntime({ token: null });
  const absentProfile = loadRoute("src/app/api/client/profile/route.ts", absent.fakes);
  const absentTimezone = loadRoute("src/app/api/client/timezone/route.ts", absent.fakes);
  assert((await absentProfile.GET()).status === 401, "missing profile session did not return 401");
  assert((await absentTimezone.PATCH(new Request("http://local", { method: "PATCH", body: JSON.stringify({ timezone: "America/New_York" }) }))).status === 401, "missing timezone session did not return 401");
  assert(Object.values(absent.calls).every((count) => typeof count !== "number" || count <= 2), "missing session performed upstream work");

  const runtime = makeContractRuntime();
  const profile = loadRoute("src/app/api/client/profile/route.ts", runtime.fakes);
  const timezone = loadRoute("src/app/api/client/timezone/route.ts", runtime.fakes);
  const profileBody = await (await profile.GET()).json();
  exactKeys(profileBody, ["identity", "voice_profile", "document_count", "atom_count", "grounding_gap", "last_ingested_at", "campaigns", "topic_suggestions"], "profile");
  exactKeys(profileBody.identity, ["display_name", "email", "profession", "client_name", "timezone"], "identity");
  exactKeys(profileBody.voice_profile, ["latest_version", "approved_version"], "voice profile");
  assert(profileBody.document_count === 3 && profileBody.last_ingested_at === "2026-05-01T00:00:00Z", "profile did not use document count/max created_at");
  assert(profileBody.atom_count === 0, "profile did not use the reviewed grounding atom total");
  exactKeys(profileBody.grounding_gap, ["atom_count", "grounded_type_count", "missing_type_count", "total_type_count", "completeness_percent"], "grounding gap");
  assert(profileBody.voice_profile.latest_version === 4 && profileBody.voice_profile.approved_version === null, "voice versions were not independently allowlisted");
  exactKeys(profileBody.campaigns[0], ["campaign_id", "objective", "starts_on", "ends_on", "is_active", "created_at"], "campaign");
  assert(JSON.stringify(profileBody.topic_suggestions) === JSON.stringify([
    { text: "Share the lesson", trust: "untrusted" },
    { text: "Use this line", trust: "untrusted" },
    { text: "A real result", trust: "untrusted" },
  ]), "profile did not project real, stable, deduplicated topic suggestions");

  const accepted = await timezone.PATCH(new Request("http://local", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ timezone: "America/New_York" }) }));
  assert(accepted.status === 200, "valid timezone did not succeed");
  exactKeys(await accepted.json(), ["timezone"], "timezone success");
  assert(runtime.calls.patch === 1 && runtime.calls.patchArgs.id === "tenant id/with slash" && runtime.calls.patchArgs.timezone === "America/New_York", "timezone patch did not use the derived tenant/value");

  for (const body of [{ client_id: "attacker", timezone: "America/New_York" }, { timezone: "America/New_York", extra: true }, [], { timezone: "" }, {}]) {
    const invalid = makeContractRuntime();
    const route = loadRoute("src/app/api/client/timezone/route.ts", invalid.fakes);
    const response = await route.PATCH(new Request("http://local", { method: "PATCH", body: JSON.stringify(body) }));
    assert(response.status === 422, `invalid timezone body ${JSON.stringify(body)} was not refused`);
    assert(invalid.calls.resolve === 0 && invalid.calls.patch === 0, `invalid timezone body ${JSON.stringify(body)} reached an upstream mutation`);
  }

  const source = read("src/app/api/client/profile/route.ts");
  const timezoneSource = read("src/app/api/client/timezone/route.ts");
  assert(!/\.\.\.(?:client|console_|envelope|onboarding)/.test(source), "profile source spreads raw upstream data");
  assert(!/request\.(?:json|url|headers).*client_id|client_id.*request\./s.test(timezoneSource), "timezone source derives tenant from request data");
  for (const relative of walk("src")) {
    const sourceText = read(relative);
    if (/^[\s\S]*["']use client["']/.test(sourceText)) {
      // Type-only imports are erased by TypeScript and cannot make a server
      // helper browser-reachable. Check only emitted runtime import lines.
      const runtimeImports = sourceText.replace(/import\s+type[\s\S]*?from\s+["'][^"']+["'];?/g, "");
      assert(!/(?:from\s+["']@\/lib\/(?:engine|product|client-session)|require\(["']@\/lib\/(?:engine|product|client-session))/.test(runtimeImports), `${relative} reaches a server helper`);
      assert(!/process\.env\.(?:ENGINE_URL|ENGINE_SERVICE_KEY)/.test(sourceText), `${relative} reads a server environment key`);
    }
  }
  console.log("contracts: session gates, exact BFF allowlists, derived timezone PATCH, rejection and server-only graph passed");
};

const assertQueuedBodyContract = async () => {
  const productSource = read("src/lib/product.ts");
  const queueRouteSource = read("src/app/api/client/awaiting-review/route.ts");
  const profileSource = read("src/app/api/client/profile/route.ts");
  const steerSource = fs.readFileSync(path.resolve(root, "..", "src", "product", "generation", "steer.py"), "utf8");
  assert(productSource.includes("export async function awaitingReviewWithBodies"), "product does not expose the Home exact-body helper");
  assert(productSource.includes("version.content_version_id === queued.content_version_id"), "product does not match the queued version id exactly");
  assert(!productSource.includes("history.versions[0]"), "product substitutes a newest version body");
  assert(queueRouteSource.includes("awaitingReviewWithBodies(token)"), "awaiting route does not use exact queued bodies");
  assert(!queueRouteSource.includes("awaitingReview(token)"), "awaiting route still exposes body-less queue rows");
  for (const field of ["insight", "quote", "objection", "proof_point"]) {
    assert(steerSource.includes(`\"${field}\"`), `backend topic taxonomy omits ${field}`);
    assert(profileSource.includes(`\"${field}\"`), `profile topic taxonomy omits ${field}`);
  }
  assert(profileSource.includes("const TOPIC_SOURCE_TYPES = [\"insight\", \"quote\", \"objection\", \"proof_point\"] as const;"), "profile topic sources are not the authoritative four-field allowlist");
};

const mutateAndRestore = async (relative, from, to, assertion, label) => {
  const before = read(relative);
  const beforeHash = hash(relative);
  assert(before.includes(from), `${label}: mutation target was not found`);
  try {
    fs.writeFileSync(file(relative), before.replace(from, to));
    let red = false;
    try { await assertion(); } catch { red = true; }
    assert(red, `${label}: persisted assertion did not turn red`);
  } finally {
    fs.writeFileSync(file(relative), before);
  }
  assert(read(relative) === before && hash(relative) === beforeHash, `${label}: bytes/hash did not restore`);
};

const assertMutations = async () => {
  await mutateAndRestore(
    "src/lib/product.ts",
    "version.content_version_id === queued.content_version_id",
    "history.versions[0].content_version_id === queued.content_version_id",
    assertQueuedBodyContract,
    "exact-version selection",
  );
  await mutateAndRestore(
    "src/app/api/client/profile/route.ts",
    "const TOPIC_SOURCE_TYPES = [\"insight\", \"quote\", \"objection\", \"proof_point\"] as const;",
    "const TOPIC_SOURCE_TYPES = [\"insight\", \"quote\", \"objection\", \"proof_point\", \"campaign.objective\"] as const;",
    assertQueuedBodyContract,
    "seeded topic fallback",
  );
  console.log("mutations: exact-version and seeded-topic mutations turned guards red and restored byte-for-byte");
};

const walk = (relative) => {
  const entries = fs.readdirSync(file(relative), { withFileTypes: true });
  return entries.flatMap((entry) => {
    const nested = path.posix.join(relative.replaceAll("\\", "/"), entry.name);
    return entry.isDirectory() ? walk(nested) : entry.isFile() && /\.(?:ts|tsx)$/.test(entry.name) ? [nested] : [];
  });
};

// Two "Save to profile" marker sites were named here — `Steps.tsx` (the old
// guided UI) and `ChatPath.tsx` (its replacement) — on the assumption that
// whichever surface won, an inert "Save to profile" site would exist on it.
// Step 6 (A14) deleted `Steps.tsx`, which is what turned the first entry into
// an `ENOENT` and forced this file open. Checked the second before repointing
// rather than assuming it survives: `ChatPath.tsx` contains no `InertMarker`
// at all today (`grep -c InertMarker src/components/compose/ChatPath.tsx` is
// `0`), and `compose.chat.saveToProfile` in `content.ts` has no reader
// anywhere in `src/` — the whole "Save to profile" concept this pair
// guarded is unwired on the surviving surface too, not merely relocated.
// Both entries are removed rather than one repointed to a label that isn't
// there. Whether ChatPath *should* offer an inert "Save to profile" site is
// a product question this cleanup doesn't answer — flagged, not decided,
// in the same commit's report.
const requiredMarkerSites = [
  ["src/app/(app)/profile/page.tsx", "Photo"],
  ["src/app/(app)/profile/page.tsx", "One-liner"],
  ["src/app/(app)/settings/page.tsx", "LinkedIn"],
  ["src/app/(app)/settings/page.tsx", "Weekly"],
  ["src/app/(app)/settings/page.tsx", "Billing"],
];

const assertProfile = () => {
  const source = read("src/app/(app)/profile/page.tsx");
  assert(source.includes("/api/client/profile"), "Profile does not request its BFF");
  assert(!/useStore|PROFILE_SLOTS|BASE_ATOMS|profileSeed|profileHistory/.test(source), "Profile retains seeded or invented profile state");
  assert(/ErrorSurface/.test(source) && /Skeleton/.test(source), "Profile does not render shipped error/loading states");
  assert(/latest_version/.test(source) && /approved_version/.test(source), "Profile does not render independent voice versions");
  assert(!/approved_version\s*\?\?\s*.*latest_version/.test(source), "Profile backfills approved version from latest");
  assert((source.match(/<InertMarker/g) ?? []).length === 8, "Profile must own exactly eight inert markers");
  console.log("profile: live BFF/state/null/list/inert source contract passed");
};

const assertSettings = () => {
  const source = read("src/app/(app)/settings/page.tsx");
  assert(source.includes("/api/client/profile") && source.includes("/api/client/timezone"), "Settings does not use profile/timezone BFFs");
  assert(source.includes("CONSTRAINTS_HREF"), "Settings does not consume CONSTRAINTS_HREF");
  assert(!/person\.timezone|bannedWords|Banned word|demo/i.test(source), "Settings retains seeded timezone or banned-word demo state");
  assert(/Always/.test(source), "Settings does not render approval as Always");
  console.log("settings: truthful BFF/constraints/approval source contract passed");
};

const assertInert = () => {
  const marker = read("src/components/ui/InertMarker.tsx");
  assert(marker.length > 0, "InertMarker definition is empty");
  for (const [relative, label] of requiredMarkerSites) {
    const source = read(relative);
    assert(source.includes("InertMarker") && source.includes(label), `${relative} does not account for ${label}`);
  }
  const all = walk("src").map((relative) => [relative, read(relative)]);
  const noops = all.filter(([relative, source]) => /(?:onClick|onChange)=\{(?:\(\)\s*=>\s*\{?\s*\}?|undefined)\}/.test(source));
  assert(noops.length === 0, `inert census found no-op handlers: ${noops.map(([relative]) => relative).join(", ")}`);
  console.log(`inert: marker definition and ${requiredMarkerSites.length} named promote/settings sites accounted for; candidates empty`);
};

const run = async () => {
  if (mode === "--contracts" || mode === "--all") { await assertContracts(); await assertQueuedBodyContract(); }
  if (mode === "--mutations") await assertMutations();
  if (mode === "--profile" || mode === "--all") assertProfile();
  if (mode === "--settings" || mode === "--all") assertSettings();
  if (mode === "--inert" || mode === "--all") assertInert();
};

await run();
