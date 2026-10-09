import { describe, expect, it } from "vitest";

import { MAX_IDENTICAL_CALLS, REPEATED_CALL_EXPLANATION } from "@/agent/bounds";
import type { Driver, TurnResult } from "@/agent/lib/driver";
import { runAgentTurn, type ToolExecution } from "@/agent/lib/turn";

/**
 * A model repeating the SAME call is going round in circles.
 *
 * Three in a row with identical arguments, and the third is not run: the
 * turn ends with its own sentence, rather than spending the rest of its
 * working room on an answer the model already has (OpenCode's doom-loop
 * guard, OpenHands' stuck detector). A call with different arguments is a
 * real new attempt and resets the count.
 */

const NO_USAGE = { inputTokens: null, outputTokens: null, cacheReadInputTokens: null, cacheCreationInputTokens: null };

const read = (id: string, query: string): TurnResult => ({
  text: "",
  toolCalls: [{ id, name: "read_knowledge", input: { selector: "find", query, purpose: "p" } }],
  stopReason: "tool_use",
  usage: NO_USAGE,
});

const done: TurnResult = { text: "Here it is.", toolCalls: [], stopReason: "end_turn", usage: NO_USAGE };

function scripted(script: TurnResult[]): Driver {
  let call = 0;
  return { toProviderTools: (tools) => tools, runTurn: async () => script[Math.min(call++, script.length - 1)] };
}

async function run(script: TurnResult[]) {
  let executed = 0;
  const executor = async (): Promise<ToolExecution> => {
    executed += 1;
    return { kind: "ok", result: { items: [] } };
  };
  const outcome = await runAgentTurn({ driver: scripted(script), executor });
  const terminal = outcome.events.find((event) => event.type === "terminal") as
    | { explanation: string }
    | undefined;
  return { executed, terminal };
}

describe("the repeated-call stop", () => {
  it("is three identical calls in a row", () => {
    expect(MAX_IDENTICAL_CALLS).toBe(3);
  });

  it("stops the turn on the third identical call, without running it", async () => {
    const { executed, terminal } = await run([read("a", "price"), read("b", "price"), read("c", "price"), done]);

    expect(executed).toBe(2);
    expect(terminal?.explanation).toBe(REPEATED_CALL_EXPLANATION);
  });

  it("does not count a call with different arguments: a real new attempt", async () => {
    const { executed, terminal } = await run([read("a", "price"), read("b", "pricing"), read("c", "price"), done]);

    expect(executed).toBe(3);
    expect(terminal).toBeUndefined();
  });

  it("lets two identical calls through", async () => {
    const { executed, terminal } = await run([read("a", "price"), read("b", "price"), done]);

    expect(executed).toBe(2);
    expect(terminal).toBeUndefined();
  });
});
