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

/**
 * A model repeating the SAME call is not making progress, and every repeat
 * spends the turn's working room on an answer it already has.
 *
 * Three in a row, with identical arguments, and the third is not run: the
 * turn ends with its own sentence. OpenCode's `doom_loop` guard fires at the
 * same count and OpenHands' stuck detector on the same shape. A retry with
 * DIFFERENT arguments is a real second attempt and is never counted -- the
 * streak resets on any change.
 */
export const MAX_IDENTICAL_CALLS = 3;

export const REPEATED_CALL_EXPLANATION =
  "I kept trying the same step without getting anywhere, so I've stopped rather than " +
  "go round in circles. Tell me what to change, or point me at what you want, and I'll go again.";

/**
 * Cycle 5, P1.5 (spec 10A.2): how a C4 reply that reached its per-reply cap, or
 * whose next call would exceed the per-call input bound, ends when it has not
 * already submitted a draft. Written by the application, never by a model:
 * asking a model to explain that it ran out of budget would be the call the
 * cap exists to prevent.
 */
export const REPLY_CAP_EXPLANATION =
  "This needs more work than one reply allows. Try a narrower request, or ask me to continue.";

export type Limits = {
  maxToolCalls: number;
  maxSubmitDraftCalls: number;
  deadlineMs: number;
  /** P7. The client-side half of `read_calls_per_turn`.
   *
   *  **Python enforces the real cap and this does not replace it.** The
   *  server refuses a read past its own limit and the runtime cannot talk
   *  it out of that. This bound exists so the loop stops ASKING once it is
   *  out of room, rather than spending its remaining tool calls collecting
   *  429s — and so the stop carries a sentence, which a 429 inside a tool
   *  result does not.
   *
   *  It is deliberately the SAME number as the server's profile. A looser
   *  one here would make the server the only thing stopping the loop; a
   *  tighter one would silently cut reads the operator allowed. */
  maxReadCalls: number;
  /** P7. The assembled bytes one turn may put in front of the model.
   *
   *  Counted over what the runtime actually renders, not over what the
   *  server returned: a result can be large and still contribute little
   *  once projected. Zero means "not counted", which is what every caller
   *  that does not track it gets. */
  maxPackedBytes: number;
  /** Cycle 5, P1.5. The per-reply cap in microdollars, from the C4
   *  reservation (`reply_cap_microdollars`). The reply stops once its running
   *  cost reaches it. ABSENT means no cap, which is the M1 (`context.v1`) path:
   *  it has no reservation, and none is invented here. */
  maxReplyCostMicrodollars?: number;
  /** Cycle 5, P1.5. The largest estimated input, in tokens, one model call may
   *  be sent with (`max_call_input_tokens`; `lib/reply-cap.ts` estimates it).
   *  The reservation is derived from it. Absent on the M1 path. */
  maxCallInputTokens?: number;
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
  /** `INITIAL_PROFILE.read_calls_per_turn`. Kept equal on purpose — see
   *  the field's own comment. Not an approved value: plan section 6 lists
   *  it as a proposal pending the operator's envelope. */
  maxReadCalls: 6,
  /** `INITIAL_PROFILE.broad_bytes`, for the same reason. */
  maxPackedBytes: 48_000,
});

export type TurnState = {
  toolCalls: number;
  submitDraftCalls: number;
  startedAt: number;
  now: number;
  /** Optional so every existing caller keeps its exact behaviour: an
   *  undefined counter is zero, and a turn that never reads is never
   *  stopped for reading. */
  readCalls?: number;
  packedBytes?: number;
  /** Cycle 5, P1.5. The reply's running cost so far, every pass priced at its
   *  own model (`lib/reply-cap.ts`). `null` is UNKNOWN -- a pass reported no
   *  usable cost -- and is treated as at the cap, because the cap can no longer
   *  be shown to hold. Absent is zero. */
  replyCostMicrodollars?: number | null;
};

export type StopVerdict = {
  stop: boolean;
  reason:
    | null
    | "tool_ceiling"
    | "submit_ceiling"
    | "deadline"
    | "read_ceiling"
    | "packed_ceiling"
    | "reply_cap";
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
  // AFTER the submit ceiling (the specific thing that failed, when both have
  // tripped) and before every other limit: money is the bound the reservation
  // was sized against. Only with a cap; the M1 path has none.
  if (bounds.maxReplyCostMicrodollars !== undefined) {
    const cost = state.replyCostMicrodollars === undefined ? 0 : state.replyCostMicrodollars;
    if (cost === null || cost >= bounds.maxReplyCostMicrodollars) {
      return { stop: true, reason: "reply_cap", explanation: REPLY_CAP_EXPLANATION };
    }
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
  // AFTER the submit ceiling and BEFORE the tool ceiling. A turn that has
  // read all it may is not out of working room: C4-27 says it "may still
  // submit", so stopping it under `tool_ceiling` — whose sentence says no
  // draft was landed — would end a turn that was about to land one.
  if ((state.readCalls ?? 0) >= bounds.maxReadCalls) {
    return {
      stop: true,
      reason: "read_ceiling",
      explanation:
        "I've read as much of your knowledge as I can in one turn, so what I write next " +
        "rests on what I already have rather than on everything there is. If it misses " +
        "something you know is in there, point me at it and I'll go again.",
    };
  }
  if ((state.packedBytes ?? 0) >= bounds.maxPackedBytes) {
    return {
      stop: true,
      reason: "packed_ceiling",
      explanation:
        "I've gathered as much material as I can hold at once for this turn. Narrow it to " +
        "the part that matters and I'll work from that instead.",
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
