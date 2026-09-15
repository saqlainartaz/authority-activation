import { describe, expect, it } from "vitest";
import { vi } from "vitest";

/**
 * The missing driver test (final whole-branch review's own triage of my
 * deferred items — this is the gap named as the single highest-value test
 * absent from the branch, because it would have caught BOTH C2 and I1):
 *
 *   - I1: no fake driver anywhere on this branch ever called `request.onText`,
 *     which is exactly why `turn.ts`'s duplicate final-pass `message.delta`
 *     re-emit went unnoticed by every test (`tests/agent/turn.test.ts`'s
 *     `recordingDriver` now calls it too, but that is a SCRIPTED fake — this
 *     file is the one that proves the REAL driver, `anthropicDriver`, calls
 *     `onText` per delta and that `result.text` is the accumulated whole,
 *     never re-derived or re-sent by `runTurn` itself).
 *   - C2: this file's second test pins that `null` usage fields survive
 *     `anthropicDriver.runTurn`'s own mapping unchanged — the SAME
 *     `null !== 0 !== absent` property `lib/product.ts`'s `ChatDraftSubmitCreate`
 *     and Python's widened `DraftSubmitIn.usage` (C2) exist to carry all the
 *     way to the wire. A driver that coerced a null cache-token count to `0`
 *     here would have produced the exact payload C2's Python-side fix had to
 *     start accepting.
 *
 * `@anthropic-ai/sdk` is mocked at the module level — this is `loop.ts`'s own
 * documented exception to "no provider SDK outside this file" (A2), and
 * mocking it here (rather than hitting the network) is what makes this test
 * keyless. The fake reproduces exactly the two SDK behaviours `runTurn`
 * depends on: `messages.stream(...)` returns an object with `.on("text", cb)`
 * and an async `.finalMessage()`, and `.withOptions(...)` is chainable.
 */
const fakeState = vi.hoisted(() => ({
  message: null as {
    content: Array<
      | { type: "text"; text: string }
      | { type: "tool_use"; id: string; name: string; input: unknown }
    >;
    stop_reason: string;
    usage: {
      input_tokens: number | null;
      output_tokens: number | null;
      cache_read_input_tokens: number | null;
      cache_creation_input_tokens: number | null;
    };
  } | null,
  textChunks: [] as string[],
}));

vi.mock("@anthropic-ai/sdk", () => {
  class FakeMessageStream {
    private textHandlers: Array<(delta: string) => void> = [];
    on(event: string, callback: (delta: string) => void) {
      if (event === "text") this.textHandlers.push(callback);
      return this;
    }
    async finalMessage() {
      // Mirrors the REAL SDK: text deltas fire via the "text" event as the
      // stream progresses, before `finalMessage()` resolves with the whole
      // accumulated message — never the other way around.
      for (const chunk of fakeState.textChunks) {
        for (const handler of this.textHandlers) handler(chunk);
      }
      return fakeState.message;
    }
  }

  class FakeAnthropicClient {
    withOptions() {
      return this;
    }
    messages = {
      stream: () => new FakeMessageStream(),
    };
  }

  return { default: FakeAnthropicClient };
});

import { anthropicDriver } from "@/agent/lib/loop";

describe("anthropicDriver.runTurn — the loop's own mapping, against a mocked SDK stream", () => {
  it("streams every delta via onText as it arrives, and the returned text is the full accumulated message — not re-derived, not re-sent", async () => {
    fakeState.textChunks = ["Here", " is", " your draft."];
    fakeState.message = {
      content: [{ type: "text", text: "Here is your draft." }],
      stop_reason: "end_turn",
      usage: { input_tokens: 120, output_tokens: 40, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    };

    const seenDeltas: string[] = [];
    const result = await anthropicDriver.runTurn({
      system: [],
      messages: [{ role: "user", content: "write a post" }],
      tools: [],
      onText: (delta) => seenDeltas.push(delta),
      timeoutMs: 120_000,
    });

    expect(seenDeltas).toEqual(["Here", " is", " your draft."]);
    expect(result.text).toBe("Here is your draft.");
    expect(result.stopReason).toBe("end_turn");
    expect(result.toolCalls).toEqual([]);
  });

  it("preserves a NULL usage field rather than coercing it to zero (C2's exact property, one layer down)", async () => {
    fakeState.textChunks = [];
    fakeState.message = {
      content: [{ type: "tool_use", id: "call-1", name: "submit_draft", input: { body: "b" } }],
      stop_reason: "tool_use",
      // A real, ordinary shape: no cache activity this call, so the SDK
      // itself reports these two as null (or omits them — `?? null` in
      // loop.ts covers `undefined` too). Not the same fact as zero.
      usage: { input_tokens: 300, output_tokens: 90, cache_read_input_tokens: null, cache_creation_input_tokens: null },
    };

    const result = await anthropicDriver.runTurn({
      system: [],
      messages: [],
      tools: [],
      onText: () => {},
      timeoutMs: 120_000,
    });

    expect(result.toolCalls).toEqual([{ id: "call-1", name: "submit_draft", input: { body: "b" } }]);
    expect(result.usage).toEqual({
      inputTokens: 300,
      outputTokens: 90,
      cacheReadInputTokens: null,
      cacheCreationInputTokens: null,
    });
    // Non-vacuity: a driver that wrote `?? 0` instead of `?? null` would still
    // pass a test that only checked `.toBeDefined()` — this pins the actual
    // value, and null specifically, not "a number".
    expect(result.usage.cacheReadInputTokens).not.toBe(0);
  });
});
