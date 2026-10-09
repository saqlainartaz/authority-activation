import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import type { Driver, TurnResult } from "@/agent/lib/driver";
import { runAgentTurn, type ToolExecution } from "@/agent/lib/turn";

/**
 * The per-turn trace: what a turn DID, and never what anyone said.
 *
 * Names, counts, outcomes, durations, tokens and the cache hit rate -- the
 * record the final evaluation reads, and how a regression in tool use or
 * caching shows up before a client notices it.
 */

const usage = (input: number, read: number, write: number, output = 10) => ({
  inputTokens: input,
  outputTokens: output,
  cacheReadInputTokens: read,
  cacheCreationInputTokens: write,
});

const SECRET = "Acme pays 49 a month and the founder is Ada";

function scripted(script: TurnResult[]): Driver {
  let call = 0;
  return { toProviderTools: (tools) => tools, runTurn: async () => script[Math.min(call++, script.length - 1)] };
}

const read: TurnResult = {
  text: "",
  toolCalls: [{ id: "r1", name: "read_knowledge", input: { selector: "find", query: SECRET, purpose: SECRET } }],
  stopReason: "tool_use",
  usage: usage(100, 900, 0),
};
const submit = (id: string): TurnResult => ({
  text: "",
  toolCalls: [{ id, name: "submit_draft", input: { body: `${SECRET} ${id}`, cited_atom_ids: [], agent_text: SECRET } }],
  stopReason: "tool_use",
  usage: usage(50, 950, 0),
});
const reply: TurnResult = { text: SECRET, toolCalls: [], stopReason: "end_turn", usage: usage(20, 980, 0) };

describe("the turn trace", () => {
  it("records each pass and each tool call, and how the turn ended", async () => {
    const outcomes: ToolExecution[] = [
      { kind: "ok", result: { items: [SECRET] } },
      { kind: "ok", result: { outcome: "verified" } },
    ];
    const { trace } = await runAgentTurn({
      driver: scripted([read, submit("s1"), reply]),
      executor: async () => outcomes.shift()!,
    });

    expect(trace.passes.map((pass) => pass.stopReason)).toEqual(["tool_use", "tool_use", "end_turn"]);
    expect(trace.tools.map((tool) => [tool.name, tool.outcome, tool.reachedBackend])).toEqual([
      ["read_knowledge", "ok", true],
      ["submit_draft", "ok", true],
    ]);
    expect(trace.end).toEqual({ kind: "reply", reason: null });
    expect(trace.totals.inputTokens).toBe(170);
    expect(trace.totals.cacheReadInputTokens).toBe(2830);
    expect(trace.totals.cacheHitRate).toBeCloseTo(2830 / 3000, 5);
  });

  it("records a rejection as one, and whether it reached the backend", async () => {
    const outcomes: ToolExecution[] = [
      { kind: "rejected", reason: SECRET, reachedPython: false },
      { kind: "ok", result: { outcome: "verified" } },
    ];
    const { trace } = await runAgentTurn({
      driver: scripted([submit("s1"), submit("s2"), reply]),
      executor: async () => outcomes.shift()!,
    });

    expect(trace.tools[0]).toMatchObject({ name: "submit_draft", outcome: "rejected", reachedBackend: false });
  });

  it("names the limit that stopped a turn", async () => {
    const { trace } = await runAgentTurn({
      driver: scripted([submit("s1"), submit("s2"), reply]),
      executor: async () => ({ kind: "rejected", reason: "no", reachedPython: true }),
    });

    expect(trace.end).toEqual({ kind: "limit", reason: "submit_ceiling" });
  });

  it("records a repeated call as not run, and the repeat as the reason", async () => {
    const { trace } = await runAgentTurn({
      driver: scripted([read, read, read, reply]),
      executor: async () => ({ kind: "ok", result: {} }),
    });

    expect(trace.tools.at(-1)).toMatchObject({ name: "read_knowledge", outcome: "not_run" });
    expect(trace.end).toEqual({ kind: "limit", reason: "repeated_call" });
  });

  it("gives no cache hit rate when the provider did not report every figure", async () => {
    const unreported = { inputTokens: null, outputTokens: null, cacheReadInputTokens: null, cacheCreationInputTokens: null };
    const { trace } = await runAgentTurn({
      driver: scripted([{ ...reply, usage: unreported }]),
      executor: async () => ({ kind: "ok", result: {} }),
    });

    expect(trace.totals.cacheHitRate).toBeNull();
  });

  // Review 5, S5: a tool NAME is the model's text too. One the code never
  // wrote is refused by the executor, but it used to reach the log verbatim.
  it("records a tool name the code never wrote as unknown", async () => {
    const invented: TurnResult = { ...read, toolCalls: [{ id: "x1", name: SECRET, input: {} }] };
    const { trace } = await runAgentTurn({
      driver: scripted([invented, reply]),
      executor: async () => ({ kind: "failed", reason: "unknown tool" }),
    });

    expect(trace.tools.map((tool) => tool.name)).toEqual(["unknown"]);
    expect(JSON.stringify(trace)).not.toContain("Acme");
  });

  it("keeps a known name the contract did not offer, so the attempt shows", async () => {
    const direct: TurnResult = { ...read, toolCalls: [{ id: "x1", name: "schedule", input: {} }] };
    const { trace } = await runAgentTurn({
      driver: scripted([direct, reply]),
      executor: async () => ({ kind: "failed", reason: "unknown tool schedule" }),
    });

    expect(trace.tools.map((tool) => tool.name)).toEqual(["schedule"]);
  });

  it("carries no content: no message text, no tool arguments, no results", async () => {
    const { trace } = await runAgentTurn({
      driver: scripted([read, submit("s1"), reply]),
      executor: async () => ({ kind: "ok", result: { items: [SECRET] } }),
    });

    const logged = JSON.stringify(trace);
    for (const fragment of ["Acme", "49 a month", "Ada"]) {
      expect(logged).not.toContain(fragment);
    }
  });
});

describe("the route logs one trace line per turn", () => {
  // Read from source, the convention tests/chat/agent-recording.test.ts uses
  // for the route: it has no seam a unit test can drive.
  const route = fs.readFileSync(
    path.join(process.cwd(), "src/app/api/client/chat/sessions/[sessionId]/agent/route.ts"),
    "utf8",
  );

  it("logs the turn's trace with its contract and conversation size", () => {
    expect(route).toContain('"[agent.turn]"');
    expect(route).toContain("...outcome.trace");
    expect(route).toContain("transcript: transcriptSize");
  });
});
