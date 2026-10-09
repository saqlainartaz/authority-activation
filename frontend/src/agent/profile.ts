import "server-only";

/**
 * Capability profiles are closed over the four supported social platforms.
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

/**
 * The `c4` tool set: the same five, plus `read_knowledge`.
 *
 * A SEPARATE ARRAY, not a mutation of `TOOL_NAMES`. The `linkedin` profile is
 * frozen and must stay byte-identical — `tests/agent/tool-schemas.test.ts`
 * asserts its serialisation is deterministic, and a shared array that gained
 * an entry would change the v1 prompt for every existing session at once.
 * Switching prompt, tools and submission contract TOGETHER behind one explicit
 * version is D8; the cost of that is a second list, and it is the right cost.
 */
export const C4_TOOL_NAMES = [
  // The v1 five, minus `schedule`: under c4 the agent PROPOSES a time and the
  // client's click schedules it (operator ruling, 2026-09-24). Main's publishing
  // work turns a scheduled, approved post into a real publication, so a model
  // that scheduled on its own word could post at a time it misread.
  "prepare_generation",
  "submit_draft",
  "get_variant_sources",
  "propose_durable_fact",
  "propose_schedule",
  // "Post it now" uses the same card: the agent proposes, the client's click
  // publishes, through main's own Post now rules (operator, 2026-09-24).
  "propose_post_now",
  "read_knowledge",
  // P6. Both are product-context tools rather than knowledge reads: one
  // returns the client's own prior writing, the other binds a fact the
  // client just stated to this piece. Neither is in `TOOL_NAMES`, because
  // v1 is frozen and a retained session must keep the tool list it was
  // written against.
  "list_recent_content",
  "use_task_material",
] as const;

export type ToolName =
  | (typeof TOOL_NAMES)[number]
  | "propose_schedule"
  | "propose_post_now"
  | "read_knowledge"
  | "list_recent_content"
  | "use_task_material";

/**
 * The tools a turn under `contract` may RUN -- the same list it advertises.
 *
 * The executor checks a call against this, not against every tool the code
 * knows: a model that returns a name it was never offered (say `schedule`
 * under c4, where the client's click schedules) must be refused, not run.
 * Leaving that to the provider never returning an unadvertised name was the
 * review-5 blocking finding.
 */
export function toolsFor(contract: "context.v1" | "c4" | undefined): readonly ToolName[] {
  return contract === "c4" ? C4_TOOL_NAMES : TOOL_NAMES;
}

/** Tools an agent OPERATION grants beside a profile's (Cycle 5, P5.2: the
 *  voice preview's local `propose_voice`). Not in any profile, so never in a
 *  chat turn's tool list; listed so a trace can name it. */
const OPERATION_TOOL_NAMES = ["propose_voice"] as const;

/** Whether `name` is a tool the code wrote and a trace may log by name. */
export function isTracedToolName(name: string): boolean {
  return isKnownToolName(name) || (OPERATION_TOOL_NAMES as readonly string[]).includes(name);
}

/** Whether `name` is a tool some profile grants -- a name the code wrote,
 *  so it can be logged; anything else came from the model and may be text. */
function isKnownToolName(name: string): name is ToolName {
  return (TOOL_NAMES as readonly string[]).includes(name) || (C4_TOOL_NAMES as readonly string[]).includes(name);
}

export type CapabilityProfile = {
  platform: string;
  /** A directory under `src/agent/skills/`. */
  skill: string;
  tools: readonly ToolName[];
  /**
   * Which backend contract this profile speaks. D8: prompt, tools, adapters,
   * references and submission checks switch TOGETHER behind one explicit
   * version, and an unknown value fails admission rather than degrading.
   *
   * `context.v1` is the default for every existing session; `c4` is opted
   * into by `AGENT_CONTRACT`, read once in the route.
   */
  contract: "context.v1" | "c4";
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
    contract: "context.v1",
  },
  // C4. A SECOND ENTRY, and `linkedin` above is untouched: every retained
  // session keeps the exact profile it was written against. Never mutate
  // `linkedin` to add a tool — that is one edit away from changing the prompt
  // of every session that ever ran.
  "linkedin-c4": {
    platform: "linkedin",
    skill: "linkedin-post",
    tools: C4_TOOL_NAMES,
    contract: "c4",
  },
  instagram: {
    platform: "instagram",
    skill: "instagram-post",
    tools: TOOL_NAMES,
    contract: "context.v1",
  },
  x: {
    platform: "x",
    skill: "x-post",
    tools: TOOL_NAMES,
    contract: "context.v1",
  },
  facebook: {
    platform: "facebook",
    skill: "facebook-post",
    tools: TOOL_NAMES,
    contract: "context.v1",
  },
  // Main's Promo Partner channels under C4 (merged 2026-09-25): the same
  // platform and skill as each v1 entry, with the c4 tool set and contract,
  // so a C4 deployment serves every channel main serves.
  "instagram-c4": {
    platform: "instagram",
    skill: "instagram-post",
    tools: C4_TOOL_NAMES,
    contract: "c4",
  },
  "x-c4": {
    platform: "x",
    skill: "x-post",
    tools: C4_TOOL_NAMES,
    contract: "c4",
  },
  "facebook-c4": {
    platform: "facebook",
    skill: "facebook-post",
    tools: C4_TOOL_NAMES,
    contract: "c4",
  },
});

export function resolveProfile(platform: string): CapabilityProfile {
  const profile = PROFILES[platform];
  if (profile === undefined) {
    throw new Error(`no capability profile for platform ${platform}`);
  }
  return profile;
}

/**
 * The profile key for a platform under the active contract.
 *
 * Reads `AGENT_CONTRACT` once, at the call site in the route, rather than
 * scattering `process.env` through the runtime: one place decides which
 * contract a turn speaks, so a turn cannot be half-switched. An unrecognised
 * value resolves to `context.v1` — the conservative direction, because
 * defaulting to `c4` on a typo would switch a live tenant's whole submission
 * path on a misspelling.
 */
export function profileKeyFor(platform: string, contract: string | undefined): string {
  return contract === "c4" ? `${platform}-c4` : platform;
}
