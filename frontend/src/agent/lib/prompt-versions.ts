import "server-only";

// Plain JS module, no .d.ts — TS reads `parseFrontmatter`'s return type
// straight off its own JSDoc (`allowJs`, this project's tsconfig), so no
// local re-declaration is needed here. SAME DIRECTORY as of the final
// whole-branch review (I5): this used to reach into `scripts/lib/`, a
// dev-tooling path `next build` never verified; the parser now lives beside
// this file, under `src/agent/lib/`, and `scripts/assert-agent-prompt-
// versions.mjs` imports up into this tree instead.
import { parseFrontmatter } from "./prompt-frontmatter.mjs";

/**
 * §6.5 / A17, Task 12 (§9 step 6). `DraftSubmitIn.skill_versions` (Python,
 * `src/product/api/chat.py`) wants `[{slug, version}]` — WHICH agent
 * instructions and skill files produced a draft. Spec §3: a tool's
 * `inputSchema` is what the MODEL fills in, so anything that must be TRUE
 * rather than CLAIMED cannot live there (`tool-schemas.ts`'s `submit_draft`
 * has no such field, on purpose). These versions come from server state —
 * the SAME file content `route.ts` already read into `INSTRUCTIONS`/
 * `SKILLS` at module scope — never from the model.
 *
 * REUSES this directory's own `prompt-frontmatter.mjs`'s `parseFrontmatter`
 * rather than re-implementing the regex here. That module's own header
 * explains why: two independent copies of "what counts as this file's
 * frontmatter" (CRLF handling included) is exactly the divergence Task 12's
 * brief warned against, and `scripts/assert-agent-prompt-versions.mjs` (A17)
 * already owns the one copy that matters — it fails a build before this code
 * could ever see a file with no frontmatter or a non-semver `version`.
 */
export type SkillVersion = { slug: string; version: string };

const SEMVER = /^\d+\.\d+\.\d+$/;

/**
 * One prompt file's own `version`, keyed by `slug` (`instructions`, or a
 * skill's directory name — `DraftSubmitIn`'s docstring). `null` on missing
 * frontmatter or a non-semver version, rather than throwing: A17 already
 * fails the build on either, so this is defence in depth, not the primary
 * check, and "say nothing" (the entry absent from `skill_versions`) is the
 * honest response to a state that should be unreachable in a shipped build.
 */
export function skillVersion(slug: string, fileText: string): SkillVersion | null {
  const fields = parseFrontmatter(fileText);
  const version = fields?.version;
  if (typeof version !== "string" || !SEMVER.test(version)) return null;
  return { slug, version };
}
