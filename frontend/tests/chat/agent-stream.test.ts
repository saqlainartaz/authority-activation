import { describe, expect, it } from "vitest";

import { parseEventFrames } from "@/lib/agent-stream";
import { encodeEvent } from "@/agent/lib/stream";
import type { AgentEvent } from "@/lib/agent-events";

describe("parseEventFrames", () => {
  it("reads one complete frame and leaves nothing over", () => {
    const { events, rest } = parseEventFrames('data: {"type":"turn.end"}\n\n');
    expect(events).toEqual([{ type: "turn.end" }]);
    expect(rest).toBe("");
  });

  it("reads several frames arriving in one chunk", () => {
    const chunk =
      'data: {"type":"activity","label":"Checking your client context"}\n\n' +
      'data: {"type":"message.delta","text":"Working from your "}\n\n';
    const { events } = parseEventFrames(chunk);
    expect(events).toHaveLength(2);
    expect(events[0]).toEqual({ type: "activity", label: "Checking your client context" });
  });

  it("holds a frame split across chunks until it is whole", () => {
    // THE CASE THAT BREAKS A NAIVE PARSER. A chunk boundary can fall anywhere,
    // including mid-JSON, and dropping the partial loses a real event.
    const first = parseEventFrames('data: {"type":"draft.ready","varia');
    expect(first.events).toEqual([]);
    expect(first.rest).toBe('data: {"type":"draft.ready","varia');

    const second = parseEventFrames(first.rest + 'nt_id":"abc"}\n\n');
    expect(second.events).toEqual([{ type: "draft.ready", variant_id: "abc" }]);
    expect(second.rest).toBe("");
  });

  it("survives newlines inside the agent's own prose", () => {
    // `encodeEvent` JSON-encodes the whole event precisely so a newline in the
    // model's text cannot truncate a frame. This pins that end of the deal.
    const text = "First line.\n\nSecond paragraph.";
    const frame = `data: ${JSON.stringify({ type: "message.delta", text })}\n\n`;
    const { events, rest } = parseEventFrames(frame);
    expect(events).toEqual([{ type: "message.delta", text }]);
    expect(rest).toBe("");
  });

  it("drops one malformed frame without taking its neighbours with it", () => {
    const chunk =
      'data: {"type":"activity","label":"first"}\n\n' +
      "data: {not json\n\n" +
      'data: {"type":"turn.end"}\n\n';
    const { events } = parseEventFrames(chunk);
    expect(events).toEqual([
      { type: "activity", label: "first" },
      { type: "turn.end" },
    ]);
  });

  it("ignores a frame that is not a data line", () => {
    const { events } = parseEventFrames(": keep-alive comment\n\n");
    expect(events).toEqual([]);
  });

  it("round-trips every event through the real encoder", () => {
    // THE PROPERTY THAT MATTERS. Every other case in this file builds its
    // input from the same assumptions the parser holds, so none of them
    // would notice the encoder changing its separator, its `data: ` prefix,
    // or moving to a multi-line frame with an `event:` field. This one would.
    const events: AgentEvent[] = [
      { type: "activity", label: "Checking your client context" },
      { type: "message.delta", text: "First line.\n\nSecond paragraph." },
      { type: "draft.ready", variant_id: "v-1" },
      { type: "terminal", outcome: "held", explanation: "The checks held this draft." },
      { type: "turn.end" },
    ];
    const wire = events.map(encodeEvent).join("");
    const { events: parsed, rest } = parseEventFrames(wire);
    expect(parsed).toEqual(events);
    expect(rest).toBe("");
  });
});
