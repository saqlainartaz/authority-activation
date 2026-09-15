import "server-only";

/**
 * §5.4 — the bounds on one turn. Nothing bounds a turn in Python today;
 * `call_with_budget` bounds a single provider call, which is a different thing.
 *
 * THE TOOL CEILING IS 10, NOT §5.4's 6, and the spec invited this: it calls the
 * number "a derivation to re-run, not a constant to defend". The original six
 * came from the GENERATION path alone — prepare, judge the material, prepare
 * again, submit, one pre-flight correction, submit. A conversation legitimately
 * runs longer: show sources, propose a durable fact, and only then that
 * sequence, which is eight. Six would truncate honest work, and a truncated turn
 * looks exactly like a stupid agent.
 *
 * There is deliberately NO per-tool cap on `prepare_generation`. Re-retrieval is
 * a feature: the agent may read the material, judge it wrong, and prepare again
 * with a sharper task. Capping that forecloses the behaviour this whole cycle
 * exists to enable. Runaway loops are held by the total and the deadline.
 *
 * AND EVERY STOP CARRIES AN EXPLANATION. A ceiling that ends the turn silently
 * is indistinguishable from a crash. The same fact — "I ran out of room" — is a
 * conversation when it is said and a defect when it is not.
 */

export type Limits = {
  maxToolCalls: number;
  maxSubmitDraftCalls: number;
  deadlineMs: number;
};

// E3, 2026-08-24: frozen. `DEFAULT_LIMITS.maxSubmitDraftCalls = 99` was
// TYPE-LEGAL — nothing marked these fields `readonly` — and would have
// silently removed §5.5's bound for the rest of the process's lifetime.
// `Object.freeze` makes that mutation throw (this module runs under ESM
// strict mode) instead of succeeding silently.
export const DEFAULT_LIMITS: Limits = Object.freeze({
  maxToolCalls: 10,
  /** §5.5: the primary attempt plus exactly one silent correction. This is
   *  D-10's double call moved out of Python; the bound survives the move. */
  maxSubmitDraftCalls: 2,
  deadlineMs: 120_000,
});

export type TurnState = {
  toolCalls: number;
  submitDraftCalls: number;
  startedAt: number;
  now: number;
};

export type StopVerdict = {
  stop: boolean;
  reason: null | "tool_ceiling" | "submit_ceiling" | "deadline";
  explanation: string | null;
};

// E3, 2026-08-24: frozen AND never returned directly. `shouldStop` used to
// hand this exact object back to every non-stopping caller, so `const v =
// shouldStop(state); v.stop = true` mutated the ONE shared instance and
// poisoned every later non-stop verdict for the rest of the process's
// lifetime — a caller three turns later, on a different conversation, would
// see `stop: true` it never earned. `Object.freeze` stops a direct write to
// this constant from succeeding; returning `{ ...KEEP_GOING }` below (a
// fresh object literal on every call, not this shared reference) is what
// actually stops the poisoning, since freezing alone would not have helped a
// caller who received and mutated a fresh copy anyway — the fix is
// "never share the identity", and freezing is defence in depth on top of it.
const KEEP_GOING: StopVerdict = Object.freeze({ stop: false, reason: null, explanation: null });

export function shouldStop(state: TurnState, limits: Partial<Limits> = {}): StopVerdict {
  const bounds = { ...DEFAULT_LIMITS, ...limits };

  // Submit first: when both have tripped, the draft attempts are the specific
  // thing that failed and the generic budget is not what the client needs told.
  if (state.submitDraftCalls >= bounds.maxSubmitDraftCalls) {
    return {
      stop: true,
      reason: "submit_ceiling",
      // R19 (Task 5's third re-review): phrased in terms of ATTEMPTS, never
      // "rejected" or any other claim about what happened to them. This
      // counter — `submitDraftCalls` — tracks how many `submit_draft` calls
      // were made, not their outcome; it climbs the same whether Python
      // verified, rejected, or errored on each one (turn.ts's R13 gate only
      // decides which terminal a FAILURE gets — it does not change what this
      // counter means). Before Ruling R5 removed the loop's break on a
      // successful `draft.ready`, this branch was reachable only via
      // rejection, because two SUCCESSES could never both occur before the
      // turn ended on the first one — so "rejected both" was true whenever
      // this fired. R5 made the turn continue after a success specifically
      // so the model could see its own submit result, which means this
      // ceiling is now also reachable after two successful, verified
      // drafts (turn.ts's own R17 test constructs exactly that case). A
      // sentence that says "rejected" there tells a client whose work went
      // well that it went badly — the opposite of what happened. What this
      // function actually knows, in every case, is that the attempts are
      // used up; the explanation says only that, and leaves the "look at
      // what I sent" / "tell me what to change" offer of a way forward,
      // which holds regardless of how the attempts went.
      explanation:
        "I've used both of my submit attempts for this turn, so I'm stopping here rather " +
        "than trying a third time. Take a look at what I sent — if you want changes, tell " +
        "me what to fix and I'll pick it back up.",
    };
  }
  if (state.toolCalls >= bounds.maxToolCalls) {
    return {
      stop: true,
      reason: "tool_ceiling",
      explanation:
        "I've used up the working room for this turn without landing a draft. Narrow it " +
        "down for me — a single angle or a single claim — and I'll go again.",
    };
  }
  if (state.now - state.startedAt >= bounds.deadlineMs) {
    return {
      stop: true,
      reason: "deadline",
      explanation:
        "This one took too long and I've stopped rather than leave you waiting. Ask me " +
        "again and I'll pick it up.",
    };
  }
  // A fresh object literal, not the shared `KEEP_GOING` reference — see its
  // comment above for why returning the constant itself was the actual bug.
  return { ...KEEP_GOING };
}
