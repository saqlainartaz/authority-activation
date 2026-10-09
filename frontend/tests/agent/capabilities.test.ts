import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { instructionsFor } from "@/agent/capabilities";
import type { CapabilityProfile } from "@/agent/profile";
import { C4_TOOL_NAMES, PROFILES, TOOL_NAMES } from "@/agent/profile";

/**
 * "What can you do for me?" -- answered from the profile, not improvised.
 *
 * The instructions described the tools to the model and nothing described the
 * agent to the client, so the model answered from tool documentation. These
 * tests pin the properties that make the generated answer trustworthy: it
 * offers exactly what the profile grants, it names the one platform, it says
 * what the agent will not do, and it never leaks a tool name.
 */

const C4 = PROFILES["linkedin-c4"];
const V1 = PROFILES.linkedin;

/** The generated section alone, as a c4 turn receives it. Forced to c4 so the
 *  v1 tool set can be described too: the list must follow the TOOLS, and the
 *  v1 profile is the only real profile without the read tool. */
function describeCapabilities(profile: CapabilityProfile): string {
  return instructionsFor("", { ...profile, contract: "c4" });
}

describe("what the agent says it can do", () => {
  it("offers looking things up only where the profile grants the read tool", () => {
    expect(describeCapabilities(C4)).toContain("Look things up in what you have shared with me");
    expect(describeCapabilities(V1)).not.toContain("Look things up");
  });

  it("has one line per granted tool, and no more", () => {
    const canLines = (text: string) =>
      text.split("You cannot:")[0].split("\n").filter((line) => line.startsWith("- "));

    expect(canLines(describeCapabilities(C4))).toHaveLength(C4_TOOL_NAMES.length);
    expect(canLines(describeCapabilities(V1))).toHaveLength(TOOL_NAMES.length);
  });

  it("names the platform it writes for, and only that one", () => {
    const text = describeCapabilities(C4);
    expect(text).toContain("This conversation writes LinkedIn posts only.");
    expect(text).not.toMatch(/linkedin-c4/);
  });

  it("says what it will not do", () => {
    const text = describeCapabilities(C4);
    expect(text).toMatch(/Publish or approve anything/);
    expect(text).toMatch(/Make up facts/);
    expect(text).toMatch(/without your confirmation/);
  });

  it("promises no check the product does not make", () => {
    // The server checks the claims a draft cites, not every sentence. An
    // absolute promise ("nothing unsupported") was the sign-off's finding.
    const text = describeCapabilities(C4);
    expect(text).toContain("Check the claims each draft cites");
    expect(text).not.toMatch(/nothing unsupported|every sentence|guarantee/i);
  });

  it("never hands the client a tool name", () => {
    const text = describeCapabilities(C4);
    for (const tool of C4_TOOL_NAMES) expect(text).not.toContain(tool);
  });

  it("refuses a platform it has no client-facing name for", () => {
    expect(() => describeCapabilities({ ...C4, platform: "threads" })).toThrow(/threads/);
  });
});

describe("which turns are given it", () => {
  it("appends it for a c4 turn", () => {
    expect(instructionsFor("BASE", C4)).toContain("## What you can do for this client");
  });

  it("leaves a v1 turn's instructions byte-identical", () => {
    expect(instructionsFor("BASE", V1)).toBe("BASE");
  });
});

/**
 * Review 5, S1: the shared instructions still told a c4 model that `schedule`
 * puts a piece on the calendar, and never mentioned `propose_schedule`, so the
 * prompt pointed at the one action c4 exists to take away from the model.
 */
describe("the instructions' tool tables", () => {
  const INSTRUCTIONS = fs.readFileSync(path.join(process.cwd(), "src/agent/instructions.md"), "utf8");
  const row = (name: string) => INSTRUCTIONS.split(/\r?\n/).find((line) => line.startsWith(`| \`${name}\` |`));

  it.each([...new Set([...TOOL_NAMES, ...C4_TOOL_NAMES])])("describe %s", (name) => {
    expect(row(name)).toBeDefined();
  });

  it("mark schedule as v1 only, and say a proposal schedules nothing", () => {
    expect(row("schedule")).toContain("`context.v1` only");
    expect(row("propose_schedule")).toContain("nothing is scheduled until they confirm it");
  });
});

/** C4 merged main (2026-09-25): every channel main serves has a c4 profile,
 *  and each is named to the client by its own name. The section refuses a
 *  platform it cannot name, so a missing label failed every such turn. */
describe("the capability section on main's channels", () => {
  it.each([
    ["instagram-c4", "Instagram"],
    ["x-c4", "X"],
    ["facebook-c4", "Facebook"],
  ])("names %s's channel as %s", (key, label) => {
    expect(instructionsFor("", PROFILES[key])).toContain(label);
  });
});
