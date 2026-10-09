import { describe, expect, it } from "vitest";

import { DEFAULT_LIMITS, shouldStop } from "@/agent/bounds";
import { C4_TOOL_NAMES, PROFILES, TOOL_NAMES, profileKeyFor, resolveProfile } from "@/agent/profile";

/**
 * The consumer switch: which profile a turn runs under, and what changes.
 *
 * The rule the whole switch exists to keep is that `linkedin` does not move.
 * A session written under `context.v1` was written against a specific prompt,
 * a specific tool set and a specific contract, and a retained session that
 * silently gained a tool would be answering with capabilities its own
 * transcript was never written for.
 */

describe("choosing a profile", () => {
  it("defaults to v1 when no contract is named", () => {
    // `AGENT_CONTRACT` unset is the deployed state everywhere today, so the
    // default is what the live route uses. An unset variable changing
    // behaviour would be a rollout nobody scheduled.
    expect(profileKeyFor("linkedin", undefined)).toBe("linkedin");
    expect(profileKeyFor("linkedin", "context.v1")).toBe("linkedin");
  });

  it("selects the c4 profile only for the c4 contract", () => {
    expect(profileKeyFor("linkedin", "c4")).toBe("linkedin-c4");
  });

  it("treats an unrecognised contract as v1 rather than as c4", () => {
    // Contracts section 6: no silent legacy fallback in either direction. A
    // typo must not upgrade a session.
    expect(profileKeyFor("linkedin", "c5")).toBe("linkedin");
    expect(profileKeyFor("linkedin", "")).toBe("linkedin");
  });
});

describe("the two profiles", () => {
  it("leaves the v1 profile exactly as it was", () => {
    const v1 = resolveProfile("linkedin");

    expect(v1.tools).toEqual(TOOL_NAMES);
    expect(v1.tools).not.toContain("read_knowledge");
    expect(v1.tools).not.toContain("list_recent_content");
    expect(v1.tools).not.toContain("use_task_material");
    expect(v1.contract).toBe("context.v1");
  });

  it("gives the c4 profile every v1 tool plus the new ones, with schedule proposed", () => {
    const c4 = PROFILES["linkedin-c4"];

    // A superset EXCEPT for one deliberate replacement: c4 PROPOSES a time
    // (`propose_schedule`) and the client's click schedules it, instead of the
    // model scheduling on its own word (operator ruling, 2026-09-24). Every
    // other v1 tool is still there; reading knowledge is added, not substituted.
    for (const name of TOOL_NAMES) {
      if (name === "schedule") continue;
      expect(c4.tools).toContain(name);
    }
    expect(c4.tools).not.toContain("schedule");
    expect(c4.tools).toContain("propose_schedule");
    expect(c4.tools).toEqual(C4_TOOL_NAMES);
    expect(c4.contract).toBe("c4");
  });

  it("uses the same skill for both, so voice does not fork", () => {
    expect(PROFILES["linkedin-c4"].skill).toBe(resolveProfile("linkedin").skill);
  });

  it("is frozen, so a caller cannot grant itself a tool", () => {
    expect(() => {
      (PROFILES as unknown as Record<string, unknown>)["linkedin"] = {};
    }).toThrow();
  });
});

describe("the read ceiling", () => {
  it("stops the turn once the reads are used up, with its own reason", () => {
    const verdict = shouldStop({
      toolCalls: 1,
      submitDraftCalls: 0,
      startedAt: 0,
      now: 1,
      readCalls: DEFAULT_LIMITS.maxReadCalls,
    });

    expect(verdict.stop).toBe(true);
    expect(verdict.reason).toBe("read_ceiling");
  });

  it("does not claim the turn failed to land a draft", () => {
    // C4-27: a turn out of reads "may still submit". Reporting it under
    // `tool_ceiling`, whose sentence says no draft was landed, would end a
    // turn that was about to land one — and tell the client it had failed.
    const readCeiling = shouldStop({
      toolCalls: 1,
      submitDraftCalls: 0,
      startedAt: 0,
      now: 1,
      readCalls: DEFAULT_LIMITS.maxReadCalls,
    });
    const toolCeiling = shouldStop({
      toolCalls: DEFAULT_LIMITS.maxToolCalls,
      submitDraftCalls: 0,
      startedAt: 0,
      now: 1,
    });

    expect(readCeiling.explanation).not.toBe(toolCeiling.explanation);
    expect(readCeiling.explanation).toMatch(/rests on what I already have/);
  });

  it("leaves a turn that never read completely unaffected", () => {
    // Every v1 caller passes no `readCalls` at all. An undefined counter is
    // zero, so a turn that never reads is never stopped for reading.
    const verdict = shouldStop({
      toolCalls: 1,
      submitDraftCalls: 0,
      startedAt: 0,
      now: 1,
    });

    expect(verdict.stop).toBe(false);
  });

  it("matches the server's own per-turn read cap", () => {
    // Kept equal on purpose. Looser here and the server is the only thing
    // stopping the loop; tighter and the runtime silently cuts reads the
    // operator allowed.
    expect(DEFAULT_LIMITS.maxReadCalls).toBe(6);
  });
});
