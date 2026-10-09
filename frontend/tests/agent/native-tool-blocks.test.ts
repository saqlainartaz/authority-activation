import { describe, expect, it } from "vitest";

import type { Driver, DriverRequest, TurnResult } from "@/agent/lib/driver";
import { withCacheBreakpoints } from "@/agent/lib/loop";
import { runAgentTurn } from "@/agent/lib/turn";
import type { ModelMessage } from "@/agent/transcript";

/**
 * Tool calls and results travel as the API's NATIVE blocks.
 *
 * They used to be flattened: each result became user TEXT
 * (`<tool-result tool="...">`), the model's own tool calls were never sent
 * back, and its thinking was dropped between passes. Every harness studied,
 * and the API itself, sends `tool_use` back as the assistant's and answers
 * each with a `tool_result` in the next user message. These tests pin what
 * the provider receives, which is the only place that matters.
 */

const NO_USAGE = { inputTokens: null, outputTokens: null, cacheReadInputTokens: null, cacheCreationInputTokens: null };
type Block = { type: string; [key: string]: unknown };
type Sent = { role: string; content: string | Block[] };

describe("what the provider is sent", () => {
  it("returns the model's own blocks unchanged, thinking and signature included", () => {
    const providerBlocks = [
      { type: "thinking", thinking: "check the price first", signature: "sig-abc" },
      { type: "tool_use", id: "t1", name: "read_knowledge", input: { selector: "orient" } },
    ];
    const messages: ModelMessage[] = [
      { role: "user", content: "<client-message>hi</client-message>" },
      { role: "assistant", content: "", toolCalls: [{ id: "t1", name: "read_knowledge", input: {} }], providerBlocks },
      { role: "user", content: "", toolResults: [{ toolUseId: "t1", name: "read_knowledge", content: "{}", isError: false }] },
    ];

    const sent = withCacheBreakpoints(messages, null) as Sent[];

    expect(sent[1].content).toEqual(providerBlocks);
  });

  it("answers each call with a tool_result, first in the message, marking failures", () => {
    const messages: ModelMessage[] = [
      { role: "assistant", content: "", toolCalls: [{ id: "a", name: "x", input: {} }, { id: "b", name: "y", input: {} }] },
      {
        role: "user",
        content: "",
        toolResults: [
          { toolUseId: "a", name: "x", content: "fine", isError: false },
          { toolUseId: "b", name: "y", content: "refused: bad date", isError: true },
        ],
      },
      { role: "user", content: "next" },
    ];

    const sent = withCacheBreakpoints(messages, null) as Sent[];
    const results = sent[1].content as Block[];

    expect(results.map((block) => block.type)).toEqual(["tool_result", "tool_result"]);
    expect(results[0]).toMatchObject({ tool_use_id: "a", content: "fine" });
    expect(results[0]).not.toHaveProperty("is_error");
    expect(results[1]).toMatchObject({ tool_use_id: "b", is_error: true });
    // Rebuilt for a driver with no provider blocks: the calls, as tool_use.
    expect((sent[0].content as Block[]).map((block) => block.type)).toEqual(["tool_use", "tool_use"]);
  });

  it("keeps no text wrapper anywhere", () => {
    const messages: ModelMessage[] = [
      { role: "assistant", content: "", toolCalls: [{ id: "a", name: "x", input: {} }] },
      { role: "user", content: "", toolResults: [{ toolUseId: "a", name: "x", content: "{}", isError: false }] },
    ];

    expect(JSON.stringify(withCacheBreakpoints(messages, null))).not.toContain("<tool-result");
  });

  it("puts the within-turn cache mark on the last tool_result block", () => {
    const messages: ModelMessage[] = [
      { role: "assistant", content: "", toolCalls: [{ id: "a", name: "x", input: {} }] },
      { role: "user", content: "", toolResults: [{ toolUseId: "a", name: "x", content: "{}", isError: false }] },
    ];

    const sent = withCacheBreakpoints(messages, null) as Sent[];
    const last = (sent[1].content as Block[]).at(-1)!;

    expect(last.type).toBe("tool_result");
    expect(last.cache_control).toEqual({ type: "ephemeral" });
  });
});

describe("what the loop records", () => {
  it("sends every result of one pass in ONE user message, answering its calls", async () => {
    // Parallel calls: the API requires one tool_result per tool_use, all in
    // the single user message that follows. One message per call was the
    // text-transport habit.
    const requests: DriverRequest[] = [];
    const script: TurnResult[] = [
      {
        text: "",
        toolCalls: [
          { id: "r1", name: "read_knowledge", input: { selector: "orient", purpose: "p" } },
          { id: "r2", name: "list_recent_content", input: {} },
        ],
        providerBlocks: [{ type: "tool_use", id: "r1" }, { type: "tool_use", id: "r2" }],
        stopReason: "tool_use",
        usage: NO_USAGE,
      },
      { text: "done", toolCalls: [], stopReason: "end_turn", usage: NO_USAGE },
    ];
    let call = 0;
    const driver: Driver = {
      toProviderTools: (tools) => tools,
      runTurn: async (request) => {
        requests.push({ ...request, messages: [...request.messages] });
        return script[Math.min(call++, script.length - 1)];
      },
    };

    await runAgentTurn({ driver, executor: async () => ({ kind: "ok", result: { fine: true } }) });

    const second = requests[1].messages;
    const assistant = second.find((message) => message.role === "assistant");
    const answered = second.filter((message) => message.toolResults);
    expect(assistant?.providerBlocks).toEqual(script[0].providerBlocks);
    expect(answered).toHaveLength(1);
    expect(answered[0].toolResults!.map((result) => result.toolUseId)).toEqual(["r1", "r2"]);
  });
});
