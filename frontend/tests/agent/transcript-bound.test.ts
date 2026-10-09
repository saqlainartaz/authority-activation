import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { PROFILES } from "@/agent/profile";
import { instructionsFor } from "@/agent/capabilities";
import { buildTurnMessages } from "@/agent/lib/context-assembly";
import type { Driver, DriverRequest, TurnResult } from "@/agent/lib/driver";
import { withCacheBreakpoints } from "@/agent/lib/loop";
import { MAX_TRANSCRIPT_CHARS, TRIM_BLOCK, boundTranscript } from "@/agent/lib/transcript-bound";
import { runAgentTurn } from "@/agent/lib/turn";
import type { ModelMessage } from "@/agent/transcript";

/**
 * Long conversations: what the model is given, and what it costs to give it.
 *
 * Two changes, pinned together because they interact. The earlier chat is
 * capped (the opening message kept, the oldest middle left out in whole
 * blocks), and it is now a prompt-cache boundary -- only the system prefix was
 * cached before, so every pass re-sent the whole chat at full price. Trimming
 * in blocks is what keeps the cached prefix stable while the chat grows.
 */

function chat(count: number, size = 1_000): ModelMessage[] {
  return Array.from({ length: count }, (_, index) => ({
    role: index % 2 === 0 ? ("user" as const) : ("assistant" as const),
    content: `${index}:`.padEnd(size, "x"),
  }));
}

const NO_USAGE = { inputTokens: null, outputTokens: null, cacheReadInputTokens: null, cacheCreationInputTokens: null };

describe("the conversation cap", () => {
  it("is 30k tokens at 3.5 characters a token", () => {
    expect(MAX_TRANSCRIPT_CHARS).toBe(105_000);
  });

  it("leaves a conversation under the cap exactly as it was", () => {
    const transcript = chat(20);
    const bounded = boundTranscript(transcript);

    expect(bounded.messages).toBe(transcript);
    expect(bounded.omitted).toBe(0);
  });

  it("keeps the opening message and leaves out the agent's own replies first", () => {
    // 200 alternating messages of 1,000 characters: the client's hundred fit
    // under the cap once the replies go, so no client message may be lost.
    const transcript = chat(200);
    const bounded = boundTranscript(transcript);

    expect(bounded.chars).toBeLessThanOrEqual(MAX_TRANSCRIPT_CHARS);
    expect(bounded.messages[0]).toBe(transcript[0]);
    const clientKept = bounded.messages.filter((message) => transcript.includes(message) && message.role === "user");
    expect(clientKept).toHaveLength(transcript.filter((message) => message.role === "user").length);
    expect(bounded.messages[1].content).toContain("of your own earlier replies");
    expect(bounded.messages[1].content).not.toContain("client's earliest");
  });

  it("keeps what it keeps in the conversation's order", () => {
    const transcript = chat(200);
    const kept = boundTranscript(transcript).messages.filter((message) => transcript.includes(message));
    const positions = kept.map((message) => transcript.indexOf(message));

    expect(positions).toEqual([...positions].sort((left, right) => left - right));
  });

  it("drops the client's oldest messages only once every reply is gone, and says so", () => {
    // Client messages alone exceed the cap here: 150 of 1,000 characters.
    const transcript: ModelMessage[] = [
      ...chat(1),
      ...Array.from({ length: 150 }, (_, index) => ({ role: "user" as const, content: `c${index}:`.padEnd(1_000, "x") })),
      { role: "assistant", content: "the only reply" },
    ];
    const bounded = boundTranscript(transcript);

    expect(bounded.chars).toBeLessThanOrEqual(MAX_TRANSCRIPT_CHARS);
    expect(bounded.messages).not.toContainEqual({ role: "assistant", content: "the only reply" });
    expect(bounded.messages[1].content).toContain("of the client's earliest messages");
    expect(bounded.messages.at(-1)).toBe(transcript.at(-2));
  });

  it("leaves out whole blocks, so the start of what the model sees rarely moves", () => {
    // Recomputed from scratch every turn. Dropping one message at a time would
    // shift the start on every turn once over the cap, and the cached prefix
    // with it; in blocks, consecutive turns mostly see the same start.
    let moves = 0;
    let previous = boundTranscript(chat(120)).omitted;
    for (let count = 121; count <= 220; count += 1) {
      const omitted = boundTranscript(chat(count)).omitted;
      expect(omitted % TRIM_BLOCK).toBe(0);
      if (omitted !== previous) moves += 1;
      previous = omitted;
    }
    expect(moves).toBeLessThanOrEqual(100 / TRIM_BLOCK + 1);
  });
});

describe("the cache boundaries", () => {
  it("marks the end of the earlier chat and the newest message, and nothing else", () => {
    const messages = chat(6, 20);
    const sent = withCacheBreakpoints(messages, 3) as { content: unknown }[];

    const marked = sent
      .map((message, index) => (Array.isArray(message.content) ? index : -1))
      .filter((index) => index >= 0);
    expect(marked).toEqual([3, 5]);
  });

  it("changes no text the model reads", () => {
    const messages = chat(6, 20);
    const sent = withCacheBreakpoints(messages, 3) as { content: string | { text: string }[] }[];

    const text = sent.map((message) =>
      typeof message.content === "string" ? message.content : message.content[0].text,
    );
    expect(text).toEqual(messages.map((message) => message.content));
  });

  it("points at the last earlier message, and at nothing when there is none", () => {
    const transcript = chat(4, 20);
    const { messages, cacheThrough } = buildTurnMessages([], transcript, "now");

    expect(messages[cacheThrough as number]).toBe(transcript.at(-1));
    expect(buildTurnMessages([], [], "now").cacheThrough).toBeNull();
  });

  it("reaches the driver on every pass of a turn", async () => {
    const requests: DriverRequest[] = [];
    const script: TurnResult[] = [
      {
        text: "",
        toolCalls: [{ id: "t1", name: "prepare_generation", input: { message: "m", operation: "generate" } }],
        stopReason: "tool_use",
        usage: NO_USAGE,
      },
      { text: "done", toolCalls: [], stopReason: "end_turn", usage: NO_USAGE },
    ];
    let call = 0;
    const driver: Driver = {
      toProviderTools: (tools) => tools,
      runTurn: async (request) => {
        requests.push(request);
        return script[Math.min(call++, script.length - 1)];
      },
    };

    await runAgentTurn({
      driver,
      executor: async () => ({ kind: "ok", result: {} }),
      messages: chat(4, 20),
      cacheThrough: 2,
    });

    expect(requests.length).toBeGreaterThan(1);
    expect(requests.map((request) => request.cacheThrough)).toEqual(requests.map(() => 2));
  });
});

describe("what the model is told about a trimmed conversation", () => {
  it("is told under c4, and v1's instructions do not move", () => {
    expect(instructionsFor("BASE", PROFILES["linkedin-c4"])).toContain("## Long conversations");
    expect(instructionsFor("BASE", PROFILES.linkedin)).toBe("BASE");
  });
});

describe("the route applies both", () => {
  // Read from source, the convention `tests/chat/agent-recording.test.ts`
  // uses for the route: it has no seam a unit test can drive, and the
  // typecheck does not flag a destructured value that is never passed on.
  const route = fs.readFileSync(
    path.join(process.cwd(), "src/app/api/client/chat/sessions/[sessionId]/agent/route.ts"),
    "utf8",
  );

  it("hands the cache boundary to the turn loop", () => {
    const call = route.slice(route.indexOf("await runAgentTurn({"), route.indexOf("onEvent:", route.indexOf("await runAgentTurn({")));
    expect(call).toContain("cacheThrough,");
  });
});
