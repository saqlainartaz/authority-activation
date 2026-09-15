import { describe, expect, it } from "vitest";

import { encodeEvent } from "@/agent/lib/stream";
import type { AgentEvent } from "@/agent/events";

describe("SSE encoding", () => {
  it("emits one event per line-pair, parseable as JSON", () => {
    const encoded = encodeEvent({ type: "draft.ready", variant_id: "v1" });

    expect(encoded.endsWith("\n\n")).toBe(true);
    expect(JSON.parse(encoded.replace(/^data: /, "").trim())).toEqual({
      type: "draft.ready",
      variant_id: "v1",
    });
  });

  it("survives a newline in agent prose without breaking the frame", () => {
    // The one real encoding hazard: SSE is newline-delimited and the agent's own
    // words legitimately contain newlines. JSON-encoding the whole event escapes
    // them; concatenating raw text would truncate the frame mid-sentence.
    const event: AgentEvent = { type: "message.delta", text: "line one\nline two" };
    const decoded = JSON.parse(encodeEvent(event).replace(/^data: /, "").trim());

    expect(decoded.text).toBe("line one\nline two");
  });
});
