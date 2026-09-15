import { describe, expect, it } from "vitest";

import { DEFAULT_LIMITS, shouldStop, type TurnState } from "@/agent/bounds";

function state(partial: Partial<TurnState> = {}): TurnState {
  return { toolCalls: 0, submitDraftCalls: 0, startedAt: 0, now: 1_000, ...partial };
}

describe("shouldStop", () => {
  it("lets a fresh turn run", () => {
    expect(shouldStop(state())).toEqual({ stop: false, reason: null, explanation: null });
  });

  it("allows the full conversational worst case", () => {
    // The DERIVATION, and it is meant to be re-run rather than defended. §5.4
    // derived 6 from the generation path alone: prepare, judge, prepare, submit,
    // correct, submit. A conversation legitimately runs longer — show sources,
    // propose a durable fact, THEN that sequence — which is eight. Ten leaves
    // room without licensing a runaway, because the wall-clock deadline and the
    // submit ceiling already bound the expensive half.
    expect(shouldStop(state({ toolCalls: 8 })).stop).toBe(false);
  });

  it("stops at the tool ceiling", () => {
    const verdict = shouldStop(state({ toolCalls: DEFAULT_LIMITS.maxToolCalls }));

    expect(verdict.stop).toBe(true);
    expect(verdict.reason).toBe("tool_ceiling");
  });

  it("stops at two submit_draft calls", () => {
    // §5.5: the primary attempt plus exactly one correction. This is D-10's
    // double call, moved out of Python — the bound has to survive the move or a
    // guarantee has been silently removed (§6.2).
    const verdict = shouldStop(state({ submitDraftCalls: 2 }));

    expect(verdict.stop).toBe(true);
    expect(verdict.reason).toBe("submit_ceiling");
  });

  it("stops at the wall-clock deadline", () => {
    // E6, 2026-08-24: exact boundary, matching the other two ceiling tests
    // above (`toolCalls: DEFAULT_LIMITS.maxToolCalls`, `submitDraftCalls: 2`
    // both test the exact limit, not limit + 1). The check itself is `>=`
    // (`state.now - state.startedAt >= bounds.deadlineMs`), so testing at
    // `deadlineMs + 1` alone could not have caught a regression to `>`,
    // which would still stop one tick later and pass this test either way.
    const verdict = shouldStop(state({ startedAt: 0, now: DEFAULT_LIMITS.deadlineMs }));

    expect(verdict.stop).toBe(true);
    expect(verdict.reason).toBe("deadline");
  });

  it("always carries a human explanation when it stops", () => {
    // The turn must not simply end mid-thought. A ceiling hit that produces
    // silence looks to the client like the agent going stupid; a ceiling hit
    // that produces "I ran out of room, can you narrow it down" is a
    // conversation, and it is the same information.
    for (const overloaded of [
      state({ toolCalls: DEFAULT_LIMITS.maxToolCalls }),
      state({ submitDraftCalls: 2 }),
      state({ now: DEFAULT_LIMITS.deadlineMs + 1 }),
    ]) {
      const verdict = shouldStop(overloaded);

      expect(verdict.stop).toBe(true);
      expect(verdict.explanation).toBeTruthy();
      expect(verdict.explanation!.length).toBeGreaterThan(20);
    }
  });

  it("never claims rejection in the submit_ceiling explanation — shouldStop cannot know that", () => {
    // R19 (Task 5's third re-review). `submitDraftCalls` counts ATTEMPTS, not
    // outcomes — it climbs the same whether a submit was verified, rejected,
    // or errored. Before Ruling R5 removed the loop's break on a successful
    // `draft.ready` (turn.ts), this branch was reachable only via two
    // REJECTIONS, because two SUCCESSES could never both occur before the
    // turn ended on the first one — so "rejected both drafts" happened to be
    // true every time this fired. R5 made the turn continue after a success
    // specifically so the model could see its own submit result, which made
    // this ceiling ALSO reachable after two successful, VERIFIED drafts (see
    // `tests/agent/turn.test.ts`'s R17 test, which constructs exactly that
    // case and checks this same explanation from the other side). `TurnState`
    // carries no field that could ever distinguish the two routes — both
    // present here as the identical `submitDraftCalls: 2` — so the only way
    // to make the sentence true on both is to never claim rejection at all.
    const verdict = shouldStop(state({ submitDraftCalls: 2 }));

    expect(verdict.explanation).not.toMatch(/reject/i);
  });

  it("still offers the client a way forward, even though it no longer claims rejection", () => {
    // The second half of bounds.ts's own rule survives R19: "a ceiling that
    // ends the turn silently is indistinguishable from a crash." Only the
    // false factual claim was removed — the invitation to act stays.
    const verdict = shouldStop(state({ submitDraftCalls: 2 }));

    expect(verdict.explanation).toMatch(/tell me/i);
  });

  it("reports the submit ceiling ahead of the tool ceiling", () => {
    // Both tripped means the client should hear about the draft attempts, which
    // is the specific thing that failed, not the generic budget.
    const verdict = shouldStop(
      state({ toolCalls: DEFAULT_LIMITS.maxToolCalls, submitDraftCalls: 2 }),
    );

    expect(verdict.reason).toBe("submit_ceiling");
  });

  it("takes overridden limits", () => {
    expect(shouldStop(state({ toolCalls: 3 }), { maxToolCalls: 3 }).stop).toBe(true);
  });

  it("refuses to let a limit be raised at runtime — DEFAULT_LIMITS is frozen", () => {
    // E3, 2026-08-24. Nothing marked `Limits`'s fields `readonly`, so
    // `DEFAULT_LIMITS.maxSubmitDraftCalls = 99` was TYPE-LEGAL and would have
    // silently removed §5.5's bound for the rest of the process's lifetime.
    // Proved with the reviewer's own exact mutation.
    expect(() => {
      (DEFAULT_LIMITS as { maxSubmitDraftCalls: number }).maxSubmitDraftCalls = 99;
    }).toThrow(TypeError);
    expect(DEFAULT_LIMITS.maxSubmitDraftCalls).toBe(2);
  });

  it("returns a fresh verdict object every call — mutating one must not poison the next", () => {
    // E3, 2026-08-24: the non-stop path used to return the SAME shared
    // `KEEP_GOING` object to every caller. `const v = shouldStop(state()); v.stop
    // = true;` mutated that one instance and made every LATER non-stop call, for
    // the rest of the process's lifetime, report `stop: true` it never earned —
    // a poisoned singleton, not a fresh answer. Proved directly here: mutate the
    // first verdict, then confirm a second, independent call is unaffected.
    const first = shouldStop(state());
    first.stop = true;
    first.reason = "tool_ceiling";
    first.explanation = "poisoned";

    const second = shouldStop(state());

    expect(second).toEqual({ stop: false, reason: null, explanation: null });
  });
});
