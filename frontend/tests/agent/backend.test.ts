import { describe, expect, it } from "vitest";

import { derivedKey } from "@/agent/lib/backend";

describe("idempotency keys", () => {
  it("is derived from (turn, tool, attempt) and never supplied by the model", () => {
    // A11. The model fills tool inputs; anything that must be TRUE rather than
    // claimed is derived here. Same triple, same key — so a retried call is
    // recognised as the same operation rather than replayed as a new one.
    expect(derivedKey("turn-1", "submit_draft", 1)).toBe(derivedKey("turn-1", "submit_draft", 1));
    expect(derivedKey("turn-1", "submit_draft", 1)).not.toBe(derivedKey("turn-1", "submit_draft", 2));
    expect(derivedKey("turn-1", "submit_draft", 1)).not.toBe(derivedKey("turn-2", "submit_draft", 1));
  });

  it("clears Python's min_length of 8", () => {
    // ChatMessageIn / DraftSubmitIn both declare idempotency_key with
    // min_length=8; a shorter key is a 422 at the wire, not a local bug.
    expect(derivedKey("t", "x", 1).length).toBeGreaterThanOrEqual(8);
  });
});
