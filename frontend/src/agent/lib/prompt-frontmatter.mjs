/* ---------------------------------------------------------------------------
 * The one frontmatter parser for the two agent prompt files
 * (`src/agent/instructions.md`, `src/agent/skills/<name>/SKILL.md`), shared by
 * `scripts/assert-agent-prompt-versions.mjs` (A17: presence and
 * well-formedness at build time) and the TS agent runtime, one directory
 * over (§9 step 6, Task 12: reading the same `version` field to report
 * `skill_versions` on submit). Extracted so the two never carry their own,
 * potentially-divergent copy of the same regex — exactly the failure mode
 * Task 12's brief warned about.
 *
 * LIVES HERE, UNDER `src/agent/lib/`, NOT UNDER `scripts/lib/` (final
 * whole-branch review, I5, 2026-08-26). It used to be the other way around —
 * `prompt-versions.ts`, a PRODUCTION module reachable from the agent route,
 * imported `../../../scripts/lib/prompt-frontmatter.mjs`, a dev-tooling path
 * that `next build` has no obligation to bundle correctly and that neither
 * `npm run check` nor CI ever exercises through `next build` (it isn't run).
 * Sharing the parser was right; a production module depending on the
 * scripts tree was the wrong direction. This file is the one copy, and it
 * lives on the production side: `scripts/assert-agent-prompt-versions.mjs`
 * now imports UP into `src/`, which is an ordinary and verifiable direction
 * for a build-time script to depend on production source, not the reverse.
 *

 * CRLF-TOLERANT (carried over from `assert-agent-prompt-versions.mjs`'s own
 * fix round 1, 2026-08-24): this repo's `core.autocrlf` is `true`, so a
 * fresh clone or a plain `git checkout --` hands this parser CRLF content,
 * and an LF-only regex would misreport "no frontmatter block" on a file
 * nobody touched — the worst property a build-time (or now request-time)
 * check can have. `\r?\n` at both delimiters and at each internal line
 * split, with a defensive trailing-`\r` trim on every parsed value.
 * ------------------------------------------------------------------------- */

/**
 * @param {string} text
 * @returns {Record<string, string> | null}
 */
export function parseFrontmatter(text) {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  if (match === null) return null;
  const fields = {};
  for (const line of match[1].split(/\r?\n/)) {
    const pair = line.match(/^([A-Za-z_][A-Za-z0-9_]*):\s*(.+)$/);
    if (pair !== null) fields[pair[1]] = pair[2].trim().replace(/\r$/, "");
  }
  return fields;
}
