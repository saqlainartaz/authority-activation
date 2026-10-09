import { describe, expect, it } from "vitest";

import { buildToolSpecs, inputSchemaFor } from "@/agent/lib/tool-schemas";
import { C4_TOOL_NAMES, type ToolName } from "@/agent/profile";

/**
 * The c4 tool descriptions: when to use each tool, and examples that are real.
 *
 * Anthropic's guidance is to differentiate tools by WHEN to use them and to
 * show a correct call; OpenAI's is that a model given an example follows it.
 * An example that does not validate against its own schema teaches the model
 * a call that is refused, so every example here is parsed by the schema the
 * executor actually applies.
 */

const c4 = buildToolSpecs(C4_TOOL_NAMES, "c4");

function examplesIn(description: string): unknown[] {
  return [...description.matchAll(/Example: (\{.*?\})(?:$|\s)/g)].map((match) => JSON.parse(match[1]));
}

describe("the c4 tool descriptions", () => {
  it("give every example a call its own schema accepts", () => {
    let checked = 0;
    for (const spec of c4) {
      for (const example of examplesIn(spec.description)) {
        const parsed = inputSchemaFor(spec.name as ToolName, "c4").safeParse(example);
        expect(parsed.success, `${spec.name}: ${JSON.stringify(example)}`).toBe(true);
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThanOrEqual(3);
  });

  it("say when to use the tool, not only what it is", () => {
    for (const spec of c4) {
      expect(spec.description, spec.name).toMatch(/\b(Use it|Call it|Use a fact)\b/);
    }
  });

  it("carry the rules the tool results used to", () => {
    const byName = Object.fromEntries(c4.map((spec) => [spec.name, spec.description]));
    expect(byName.read_knowledge).toMatch(/must be re-read with inspect before you cite it again/);
    expect(byName.prepare_generation).toMatch(/cite by their TA handle as they stand, with no re-read/);
    expect(byName.prepare_generation).toMatch(/a direction in this task outranks/);
  });

  it("tell a revision to keep its voice, so a tone request is not a question", () => {
    // Test-client rerun, 2026-09-27: "shorter and more personal" was answered with
    // a which-voice question instead of a revision.
    const prepare = c4.find((spec) => spec.name === "prepare_generation")!.description;
    expect(prepare).toMatch(/On a revision, keep the perspective the draft is already written in/);
    expect(prepare).toMatch(/more personal[^.]*changes the wording, not who is speaking: revise straight away, without asking/);
    expect(prepare).toMatch(/Ask who should speak only when the client asks to change it/);
    // The mode's own description said "personal (as themselves)": "more
    // personal" was then sent as that mode on a neutral draft.
    const perspective = JSON.stringify(c4.find((spec) => spec.name === "prepare_generation")!.inputSchema);
    expect(perspective).toMatch(/\\"more personal\\" is a tone request, not the personal mode/);
  });

  // v1's exact descriptions are pinned by c4-wiring.test.ts ("leaves v1's
  // M-handles exactly as they were") and tool-schemas.test.ts; not repeated.
});
