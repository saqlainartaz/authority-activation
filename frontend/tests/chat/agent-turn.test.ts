import { describe, expect, it } from "vitest";

import { foldEvent, IDLE_TURN, refusedTurn, type AgentTurnState } from "@/components/compose/useAgentTurn";

const streaming: AgentTurnState = { ...IDLE_TURN, status: "streaming", echo: ["write about the launch"] };

describe("foldEvent", () => {
  it("appends message deltas rather than replacing them", () => {
    const first = foldEvent(streaming, { type: "message.delta", text: "Working from " });
    const second = foldEvent(first, { type: "message.delta", text: "your 14 March call" });
    expect(second.text).toBe("Working from your 14 March call");
  });

  it("replaces the activity label rather than accumulating it", () => {
    const first = foldEvent(streaming, { type: "activity", label: "Checking your client context" });
    const second = foldEvent(first, { type: "activity", label: "Verifying claims and sources" });
    expect(second.label).toBe("Verifying claims and sources");
  });

  it("records a terminal outcome without ending the stream itself", () => {
    // Only `turn.end` closes the stream (§5.3). A terminal event says what
    // happened; the route still sends `turn.end` after it.
    const next = foldEvent(streaming, {
      type: "terminal",
      outcome: "held",
      explanation: "The checks held this draft.",
    });
    expect(next.terminal).toEqual({ outcome: "held", explanation: "The checks held this draft." });
    expect(next.status).toBe("streaming");
  });

  it("returns to idle on turn.end and clears the narration", () => {
    // The narration is now persisted as a kind=agent row, so keeping the local
    // copy would render it twice once the envelope refetch lands.
    const spoken = foldEvent(streaming, { type: "message.delta", text: "Here it is." });
    const next = foldEvent(spoken, { type: "turn.end" });
    expect(next.status).toBe("idle");
    expect(next.text).toBe("");
    expect(next.label).toBe(null);
  });

  it("keeps the echo across turn.end, because the caller drops the head after refetching", () => {
    const next = foldEvent({ ...streaming, echo: ["one", "two"] }, { type: "turn.end" });
    expect(next.echo).toEqual(["one", "two"]);
  });

  it("carries a draft.ready without inventing a body field", () => {
    const next = foldEvent(streaming, { type: "draft.ready", variant_id: "v-1" });
    // The union has nowhere to put a body and neither does this state.
    expect(Object.keys(next)).toEqual(Object.keys(IDLE_TURN));
    expect(JSON.stringify(next)).not.toContain("body");
  });

  it("keeps a terminal outcome across turn.end too, the same as the echo", () => {
    // The mirror of the echo-survives-turn.end case above: the whole
    // held/refused UI depends on `terminal` still being on screen after the
    // stream closes, whether the terminal is real or the synthetic one
    // `runOneTurn`'s own `finally` folds when the server never sent one.
    const held: AgentTurnState = {
      ...streaming,
      terminal: { outcome: "refused", explanation: "Couldn't reach the writer. Nothing was saved — try again." },
    };
    const next = foldEvent(held, { type: "turn.end" });
    expect(next.terminal).toEqual({
      outcome: "refused",
      explanation: "Couldn't reach the writer. Nothing was saved — try again.",
    });
  });

  it("folding turn.end twice is a no-op the second time", () => {
    // `runOneTurn`'s `finally` folds a synthetic turn.end whenever the
    // stream didn't send a real one — but it must also be safe to fold on
    // top of a state that ALREADY got a real one (or an already-refused
    // shape), since the guard only checks whether one was SEEN, not whether
    // folding again would change anything.
    const once = foldEvent(streaming, { type: "turn.end" });
    const twice = foldEvent(once, { type: "turn.end" });
    expect(twice).toEqual(once);
  });
});

describe("refusedTurn", () => {
  it("resets to idle with the refusal explanation, leaving echo untouched", () => {
    const next = refusedTurn({ ...streaming, text: "partial words" }, "Couldn't reach the writer. Nothing was saved — try again.");
    expect(next).toEqual({
      status: "idle",
      label: null,
      text: "",
      terminal: { outcome: "refused", explanation: "Couldn't reach the writer. Nothing was saved — try again." },
      echo: ["write about the launch"],
      // The run's schedule-card counter is carried, not reset: a refusal does
      // not un-propose a card the server already recorded.
      proposed: streaming.proposed,
      // Carried too (Cycle 5, P1.6): a refusal does not make the limit less near.
      approachingResetsAt: streaming.approachingResetsAt,
      approachingMeter: streaming.approachingMeter,
      // And the session is no shorter (Cycle 5, P4.4).
      sessionLong: streaming.sessionLong,
    });
  });

  it("overwrites an existing terminal rather than merging with it", () => {
    const held: AgentTurnState = {
      ...streaming,
      terminal: { outcome: "held", explanation: "The checks held this draft." },
    };
    const next = refusedTurn(held, "Couldn't reach the writer. Nothing was saved — try again.");
    expect(next.terminal).toEqual({
      outcome: "refused",
      explanation: "Couldn't reach the writer. Nothing was saved — try again.",
    });
  });
});

describe("the schedule card counter", () => {
  it("moves on schedule.proposed, so the card list refetches at once", () => {
    const next = foldEvent(IDLE_TURN, { type: "schedule.proposed", proposal_id: "p1" });

    expect(next.proposed).toBe(IDLE_TURN.proposed + 1);
  });
});

describe("the approaching notice (Cycle 5, P1.6)", () => {
  it("starts empty", () => {
    expect(IDLE_TURN.approachingResetsAt).toBeNull();
  });

  it("records when the writing limit resets on usage.approaching", () => {
    const next = foldEvent(streaming, { type: "usage.approaching", resets_at: "2026-10-05T00:00:00+00:00" });

    expect(next.approachingResetsAt).toBe("2026-10-05T00:00:00+00:00");
    expect(next.status).toBe("streaming");
  });

  it("records which writing budget it is when the stream names it, and none otherwise (P2.6)", () => {
    const named = foldEvent(streaming, { type: "usage.approaching", resets_at: "2026-11-01T00:00:00+00:00", meter: "writing_monthly" });
    expect(named.approachingMeter).toBe("writing_monthly");
    expect(IDLE_TURN.approachingMeter).toBeNull();
    expect(foldEvent(named, { type: "usage.approaching", resets_at: "2026-10-05T00:00:00+00:00" }).approachingMeter).toBeNull();
  });

  it("keeps it across turn.end, so the composer can still show it", () => {
    const near = foldEvent(streaming, { type: "usage.approaching", resets_at: "2026-10-05T00:00:00+00:00" });

    expect(foldEvent(near, { type: "turn.end" }).approachingResetsAt).toBe("2026-10-05T00:00:00+00:00");
  });
});

describe("the session-length notice (Cycle 5, P4.4)", () => {
  it("starts off, and turns on at session.long while the turn goes on", () => {
    expect(IDLE_TURN.sessionLong).toBe(false);
    const next = foldEvent(streaming, { type: "session.long" });
    expect(next.sessionLong).toBe(true);
    expect(next.status).toBe("streaming");
  });

  it("stays on across turn.end, and is off for a turn that never says it", () => {
    const long = foldEvent(foldEvent(streaming, { type: "session.long" }), { type: "turn.end" });
    expect(long.sessionLong).toBe(true);
    expect(foldEvent(foldEvent(streaming, { type: "message.delta", text: "hi" }), { type: "turn.end" }).sessionLong).toBe(false);
  });
});
