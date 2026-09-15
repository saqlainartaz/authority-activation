import fs from "node:fs";
import path from "node:path";

// CORRECTED DIRECTION (final whole-branch review, I5, 2026-08-26): this used
// to be `./lib/prompt-frontmatter.mjs`, a copy this build-time script owned.
// The one copy now lives at `src/agent/lib/prompt-frontmatter.mjs`, on the
// production side, because `src/agent/lib/prompt-versions.ts` (a production
// module the agent route reaches) was the one importing DOWN into this
// `scripts/` tree — a dev-tooling dependency `next build` never verified,
// since neither `npm run check` nor CI runs `next build`. A build-time
// script importing UP into `src/` is the safe, ordinary direction; production
// code importing INTO `scripts/` was not.
import { parseFrontmatter } from "../src/agent/lib/prompt-frontmatter.mjs";

/* ---------------------------------------------------------------------------
 * A17, AMENDED (plan amendment 9). The spec specified a build-failing gate: the
 * check fails if a file's content hash changes without its frontmatter version
 * changing. That was dropped by operator decision on 2026-08-24, because the
 * chain it protects — `skill_versions` on submit, into `prompt_asset_versions` —
 * ends at a column §6.5 already says needs renaming and that NOTHING READS. It
 * bought friction on the most-iterated files in the cycle against provenance
 * with no consumer.
 *
 * What replaces it is stronger against the case anyone actually worried about:
 * the CHECKSUM IS RECORDED AUTOMATICALLY when a variant is written, so a stored
 * hash matching no committed version is visible evidence after the fact. The
 * gate only ever inconvenienced honest edits.
 *
 * So this asserts PRESENCE and WELL-FORMEDNESS, not that a human remembered.
 *
 * FIX ROUND 1 (2026-08-24). `frontmatter` originally matched `\n` only. This
 * repo's `core.autocrlf` is `true`, so a fresh clone or a plain
 * `git checkout -- src/agent/instructions.md` hands this guard CRLF content —
 * and an LF-only regex then reports "no frontmatter block" on a file nobody
 * touched. A build-failing guard that fails on a clean checkout is the worst
 * property a tripwire can have. Fixed by accepting `\r?\n` at both frontmatter
 * delimiters and at each internal line split, and by trimming any surviving
 * `\r` off a parsed value defensively — not by normalising the files or by
 * adding `.gitattributes`, because the guard must be correct regardless of how
 * any given checkout lands, and the next clone is not this session's to
 * control.
 * ------------------------------------------------------------------------- */

const root = process.cwd();
const failures = [];

/* ---------------------------------------------------------------------------
 * Fix wave, 2026-08-26 (Minor). This used to hardcode `linkedin-post` as the
 * only skill, while `route.ts` derives its own `SKILLS` map from `PROFILES`
 * (`Array.from(new Set(Object.values(PROFILES).map((profile) =>
 * profile.skill)))`) and says so in its own comment: "this stays correct
 * without an edit here if A4's registry ever grows a second entry." This
 * file did not have that property — a second skill added to `PROFILES`
 * without a matching edit here would reach `skill_versions` (Task 12) with
 * no semver guard checking it.
 *
 * NOT FIXED BY IMPORTING `PROFILES` DIRECTLY: `src/agent/profile.ts`
 * imports `server-only` (every file under `src/agent/` does, by this
 * repo's own §7.3 convention, enforced by `assert-agent-server-only.mjs`),
 * which throws when resolved outside the `react-server` condition —
 * `vitest.config.ts` only gets past it by setting
 * `ssr.resolve.conditions: ["react-server"]`, a bundler-level knob this
 * plain `node scripts/*.mjs` invocation has no equivalent for. Verified
 * directly: a bare `node -e "import('./src/agent/profile.ts')"` throws
 * `"This module cannot be imported from a Client Component module"` —
 * `server-only`'s own default export, not a resolution failure.
 *
 * Derived from the SAME structural fact `PROFILES` is constrained to
 * instead: every skill `profile.skill` can ever name is a directory under
 * `src/agent/skills/` holding a `SKILL.md` (`route.ts`'s own
 * `path.join(process.cwd(), "src/agent/skills", skill, "SKILL.md")`). Listing
 * that directory means a skill folder added here is covered by this guard
 * whether or not `PROFILES` has been wired up to it yet — a superset of
 * "every skill `PROFILES` can reach", never a subset, so this cannot
 * under-cover the way the hardcoded list could.
 * ------------------------------------------------------------------------- */
const SKILLS_ROOT = path.join(root, "src/agent/skills");
const skillNames = fs
  .readdirSync(SKILLS_ROOT, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

const PROMPT_FILES = [
  "src/agent/instructions.md",
  ...skillNames.map((name) => `src/agent/skills/${name}/SKILL.md`),
];

// Task 12: this used to be defined here, locally. It is now the shared
// `lib/prompt-frontmatter.mjs` parser, reused (not re-implemented) by the TS
// agent runtime so `skill_versions` reads the SAME regex this guard checks —
// see that module's own header for why a second copy is exactly the
// divergence risk Task 12's brief named. Aliased under this file's own name
// so every call site below is unchanged.
const frontmatter = parseFrontmatter;

for (const relative of PROMPT_FILES) {
  const absolute = path.join(root, relative);
  if (!fs.existsSync(absolute)) {
    failures.push(`${relative} is missing`);
    continue;
  }
  const fields = frontmatter(fs.readFileSync(absolute, "utf8"));
  if (fields === null) {
    failures.push(`${relative} has no frontmatter block`);
    continue;
  }
  if (!/^\d+\.\d+\.\d+$/.test(fields.version ?? "")) {
    failures.push(`${relative} has no semver \`version\` in its frontmatter`);
  }
  if (!("checksum" in fields)) {
    failures.push(`${relative} has no \`checksum\` field — the runtime records it on submit`);
  }
}

/* Mutation control. */
if (frontmatter("# no frontmatter here\n") !== null) {
  failures.push("mutation control does not trip: a file without frontmatter parsed");
}
if ((frontmatter("---\nversion: 1.2.3\nchecksum: abc\n---\n") ?? {}).version !== "1.2.3") {
  failures.push("mutation control is broken: valid frontmatter did not parse");
}
// Fix round 1: the guard must parse CRLF frontmatter too — a fresh checkout on
// this machine produces exactly this content, not a hypothetical edge case.
// The parsed value must also carry no trailing `\r`, or the semver test below
// would silently fail against it.
{
  const parsed = frontmatter("---\r\nversion: 1.2.3\r\nchecksum: abc\r\n---\r\n");
  if (parsed === null) {
    failures.push("mutation control is broken: CRLF frontmatter did not parse at all");
  } else if (parsed.version !== "1.2.3") {
    failures.push(
      `mutation control is broken: CRLF frontmatter's version parsed as ${JSON.stringify(parsed.version)}, not "1.2.3"`,
    );
  }
}

/* ---------------------------------------------------------------------------
 * Task 12 (§9 step 6). A17's premise — "the runtime already reports
 * skill_versions on submit" — was false until this fix: `submit-draft.ts`
 * sent no such field, and Python's `DraftSubmitIn.skill_versions` (added the
 * same step) had no sender. Pinned here, in the file that already asserts
 * the versions these values come from, rather than a new guard for one line.
 *
 * Also pins the OTHER half of §3: `skill_versions` must NEVER reach the
 * MODEL-facing `inputSchema` (`tool-schemas.ts`'s `submit_draft`) — these
 * values must be TRUE, not claimed, and an `inputSchema` is exactly what the
 * model fills in. Scoped to `submit_draft`'s own braced block, not the
 * whole file, so an unrelated `skill_versions` elsewhere could not silently
 * satisfy this the way a whole-file scan would.
 * ------------------------------------------------------------------------- */
const submitDraftSource = fs.readFileSync(path.join(root, "src/agent/tools/submit-draft.ts"), "utf8");
const SENDS_SKILL_VERSIONS = /skill_versions:\s*context\.skillVersions/;
if (!SENDS_SKILL_VERSIONS.test(submitDraftSource)) {
  failures.push("submit-draft.ts no longer sends skill_versions from context.skillVersions (server state)");
}

const toolSchemasSource = fs.readFileSync(path.join(root, "src/agent/lib/tool-schemas.ts"), "utf8");
const submitDraftSchemaStart = toolSchemasSource.indexOf("submit_draft: z.object({");
const submitDraftSchemaBlock =
  submitDraftSchemaStart === -1
    ? ""
    : toolSchemasSource.slice(submitDraftSchemaStart, toolSchemasSource.indexOf("}),", submitDraftSchemaStart));
if (submitDraftSchemaStart === -1) {
  failures.push("tool-schemas.ts no longer declares submit_draft's inputSchema — cannot check it stayed model-safe");
} else if (/skill_versions/.test(submitDraftSchemaBlock)) {
  failures.push(
    "submit_draft's MODEL-facing inputSchema declares skill_versions — §3 forbids it, this must be TRUE not claimed",
  );
}

/* Mutation controls for both checks above, against synthetic strings — the
 * same idiom `assert-chat-contract.mjs`'s Task 9/11 forbids use, since a
 * "must be present" and a "must be absent" check both need their pattern
 * proven capable of matching a real occurrence, not merely proven to have
 * run. */
if (!SENDS_SKILL_VERSIONS.test("skill_versions: context.skillVersions,")) {
  failures.push("mutation control does not trip: the submit-draft.ts pattern misses a present skill_versions send");
}
if (!/skill_versions/.test("submit_draft: z.object({ skill_versions: z.array(z.any()) }),")) {
  failures.push("mutation control does not trip: the tool-schemas.ts pattern misses a present skill_versions field");
}

if (failures.length > 0) {
  console.error("assert-agent-prompt-versions failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("assert-agent-prompt-versions — every prompt file carries a version and a checksum slot");
