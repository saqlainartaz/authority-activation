import "server-only";

/**
 * A4 — the capability-profile registry. ONE ENTRY THIS CYCLE.
 *
 * The route resolves a platform; the platform resolves one bundle of
 * instructions, one skill and one tool allowlist. Additional platforms, and the
 * parked general agent (`docs/PARKED_IDEAS.md` §1), become further entries here
 * rather than rewrites elsewhere. That is the seam this cycle builds; the agent
 * that uses it is not this cycle.
 *
 * A6: resolution is DETERMINISTIC, by provenance not by policy. The platform is
 * already known upstream from the route, so asking the model to re-derive it
 * would convert a certainty into a probability for nothing.
 *
 * PROFILE IS CODE; SKILL IS CONTENT. `skill` below is a directory name under
 * `skills/`, holding `SKILL.md` and its `references/`. Keeping the registry and
 * the prose apart is why adding a platform is an edit here and a folder there,
 * rather than a refactor.
 */

/** A5: five platform-neutral tools. The names carry no platform, because tool
 *  name = filename = what the model sees, and near-duplicate per-platform tools
 *  are a silent selection failure. */
export const TOOL_NAMES = [
  "prepare_generation",
  "submit_draft",
  "get_variant_sources",
  "propose_durable_fact",
  "schedule",
] as const;

export type ToolName = (typeof TOOL_NAMES)[number];

export type CapabilityProfile = {
  platform: string;
  /** A directory under `src/agent/skills/`. */
  skill: string;
  tools: readonly ToolName[];
};

// E3, 2026-08-24: frozen. `Record<string, CapabilityProfile>`'s index
// signature makes `PROFILES.threads = { ... }` TYPE-LEGAL — nothing in the
// type says the key set is closed — and it would silently add a second
// platform the registry never decided to support, removing the "exactly one
// entry" property `tests/agent/events.test.ts` asserts. `Object.freeze`
// makes that assignment throw instead of succeeding silently.
export const PROFILES: Record<string, CapabilityProfile> = Object.freeze({
  linkedin: {
    platform: "linkedin",
    skill: "linkedin-post",
    tools: TOOL_NAMES,
  },
});

export function resolveProfile(platform: string): CapabilityProfile {
  const profile = PROFILES[platform];
  if (profile === undefined) {
    throw new Error(`no capability profile for platform ${platform}`);
  }
  return profile;
}
