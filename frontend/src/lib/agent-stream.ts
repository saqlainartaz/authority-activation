import type { AgentEvent } from "@/lib/agent-events";

/**
 * The reading half of `src/agent/lib/stream.ts`'s twenty-line transport.
 *
 * `encodeEvent` writes `data: ${JSON.stringify(event)}\n\n` — the WHOLE event
 * JSON-encoded, which is what makes a newline inside the agent's prose safe:
 * SSE frames are newline-delimited, and a raw concatenation would truncate a
 * frame mid-sentence. This function is the exact inverse, and it is a pure
 * function so every case can be tested without a network, a key, or a fake
 * `Response`.
 *
 * IT NEVER THROWS. A stream reader that throws on one malformed frame loses
 * the rest of the turn — including the `terminal` event that explains what
 * went wrong. A frame that will not parse is dropped and its neighbours are
 * returned; that is a strictly better failure than a dead stream. The events
 * are additive by construction (`message.delta` appends, `activity` replaces a
 * label), so a dropped frame degrades the narration rather than corrupting
 * state.
 *
 * `rest` is the trailing partial frame, if any. The caller threads it back in
 * as the head of the next buffer — a chunk boundary can fall anywhere,
 * including mid-JSON.
 */
export function parseEventFrames(buffer: string): { events: AgentEvent[]; rest: string } {
  const frames = buffer.split("\n\n");
  // The last element is either "" (the buffer ended on a frame boundary) or a
  // partial frame. Either way it is not ready to parse.
  const rest = frames.pop() ?? "";
  const events: AgentEvent[] = [];
  for (const frame of frames) {
    const line = frame.trim();
    if (!line.startsWith("data:")) continue;
    try {
      events.push(JSON.parse(line.slice("data:".length).trim()) as AgentEvent);
    } catch {
      // Deliberately swallowed — see the note above.
    }
  }
  return { events, rest };
}
