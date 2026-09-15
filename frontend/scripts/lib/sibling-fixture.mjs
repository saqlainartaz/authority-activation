import fs from "node:fs";

/* ---------------------------------------------------------------------------
 * The cross-repo half of `assert-draft-schema.mjs` and
 * `assert-context-schema.mjs` — the only assertion in either guard that
 * compares the vendored copy in THIS repo against the fixture the backend
 * repo actually generates it from.
 *
 * FIX ROUND (B6, 2026-08-24). This half was conditional: if the sibling path
 * did not exist, the check silently did nothing and the guard still printed
 * success. Proved both ways by the reviewer — with the sibling present, a
 * divergent vendored copy went red; with the sibling path pointed elsewhere,
 * the guard printed success anyway. `Final Front End/` has no CI, no hooks,
 * nothing that runs `npm run check` automatically, so the real drift path is:
 * Python adds a field -> a dev regenerates the backend fixture and commits it
 * -> this repo's vendored copy and its TypeScript mirror stay old -> a
 * standalone clone of this repo (the sibling absent by construction) reports
 * all-green and the agent is blind to the new field. That is the exact
 * question these two guards exist to answer, and the conditional check
 * answered it wrong by default.
 *
 * This supersedes that ruling, deliberately: the load-bearing half (vendored
 * schema <-> TypeScript mirror, entirely within this repo) still always
 * runs unconditionally, unaffected by anything here. This is ONLY the
 * cross-repo half, and it now does two things a silent skip did neither of:
 *
 * 1. NEVER CLAIMS WHAT WASN'T CHECKED. The caller's success line must state
 *    whether the sibling was actually compared — see `compared` below.
 * 2. FAILS LOUDLY, NAMING ITS OWN OPT-OUT, when the sibling is missing.
 *    Absence is now a decision a caller makes on purpose
 *    (`ALLOW_MISSING_ENGINE_FIXTURES=1`), not a default that happens to them.
 * ------------------------------------------------------------------------- */

export const ALLOW_MISSING_ENGINE_FIXTURES_VAR = "ALLOW_MISSING_ENGINE_FIXTURES";

/**
 * @param {object} args
 * @param {string} args.siblingPath - absolute path to the backend's vendored fixture.
 * @param {unknown} args.schema - the parsed, already-loaded vendored schema in THIS repo.
 * @param {string} args.schemaLabel - short label for messages, e.g. "draft" or "context".
 * @returns {{ compared: boolean, failures: string[] }}
 */
export function checkSiblingFixture({ siblingPath, schema, schemaLabel }) {
  const failures = [];

  if (fs.existsSync(siblingPath)) {
    let sibling;
    try {
      sibling = JSON.parse(fs.readFileSync(siblingPath, "utf8"));
    } catch (error) {
      failures.push(`${siblingPath} exists but is not valid JSON: ${error.message}`);
      return { compared: false, failures };
    }
    if (JSON.stringify(sibling) !== JSON.stringify(schema)) {
      failures.push(`the vendored ${schemaLabel} schema is STALE — re-copy ${siblingPath}`);
    }
    return { compared: true, failures };
  }

  if (process.env[ALLOW_MISSING_ENGINE_FIXTURES_VAR] === "1") {
    return { compared: false, failures };
  }

  failures.push(
    `the backend sibling fixture is missing (${siblingPath}) — the ${schemaLabel} schema was NOT ` +
      `compared against it, and this guard cannot otherwise prove the vendored copy is fresh. ` +
      `Set ${ALLOW_MISSING_ENGINE_FIXTURES_VAR}=1 to proceed without that comparison (e.g. in a ` +
      `standalone clone that does not have the backend checked out as a sibling directory).`,
  );
  return { compared: false, failures };
}
