import "server-only";

import { replyBoundsFromReservation, type ReplyBounds } from "@/agent/lib/reply-cap";
import type { TurnMeter } from "@/agent/lib/turn-settlement";
import { NOT_STARTED_COPY, reserveRefusalCopy } from "@/lib/limit-refusal";

/**
 * One writing operation's money, from reservation to settlement (Cycle 5,
 * P5.2, Ruling 68). The ONE copy of the reserve -> fail closed -> run ->
 * settle sequence: the chat agent route and the voice preview both run their
 * model calls through it, so the Writing meter, the reply cap (Rulings 15-17,
 * 21), the certainly-unbilled settlement (Ruling 63, P4.6) and the refusal
 * sentences cannot drift between them. What differs is only WHERE the
 * reservation lives -- a chat session's turn, or a voice preview -- which the
 * caller supplies as `post`.
 *
 * The sequence, unchanged from the agent route it was extracted from:
 *
 *   1. Reserve before any model call. A refused reservation ends the
 *      operation before any call, with a sentence written by application code
 *      (D7): a budget refusal names its limit and reset, a configuration
 *      refusal sends the client to support, anything else is "not started".
 *      Nothing was reserved, so nothing is settled.
 *   2. FAIL CLOSED (Ruling 17): a reservation whose bounds are missing or
 *      invalid cannot hold the reply to its cap, so the operation ends before
 *      any call; the settlement below releases it as `cancelled_unsent`.
 *   3. Run, with the reservation's bounds.
 *   4. Settle exactly once, from the calls the operation actually made
 *      (`turn-settlement.ts`), on every outcome. A settlement that cannot be
 *      recorded leaves the reservation to expire into `uncertain`; inventing
 *      a release here would free money on a call nobody can account for.
 */

export type BudgetRequest =
  | { action: "reserve" }
  | {
      action: "settle";
      call_id: string;
      outcome: "settled" | "uncertain" | "cancelled_unsent";
      actual_microdollars?: number;
      usage: Record<string, unknown>;
    };

/** Sends one reserve or settle to wherever this operation's reservation lives. */
export type BudgetPost = (body: BudgetRequest) => Promise<unknown>;

export type WritingReservation = {
  call_id: string;
  /** What the reply may spend and send. Never null inside `run`. */
  bounds: ReplyBounds;
  /** The writing meter's 80% notice (P1.6, Ruling 37), or null. */
  approaching: { resetsAt: string; meter: "writing_daily" | "writing_monthly" | null } | null;
};

export type MeteredOperationOptions = {
  post: BudgetPost;
  /** The operation's metered driver wrapper; read once, at settlement. */
  meter: TurnMeter;
  /** Called when the operation ends before any model call, with the sentence
   *  to show. After it, `run` is never called. `stage` says whether anything
   *  was reserved: `reserve` (refused or unreadable, nothing held) or `bounds`
   *  (held, then released as `cancelled_unsent` because it failed closed). */
  onRefused: (explanation: string, stage: "reserve" | "bounds") => void;
  /** Lets the meter price passes at the reservation's prices: called with the
   *  reservation as soon as it is known, before `run`. */
  onReserved?: (reservation: { call_id: string; bounds: ReplyBounds | null }) => void;
  /** The operation itself. Its errors are its own to report; one that escapes
   *  still settles. */
  run: (reservation: WritingReservation) => Promise<void>;
};

function approachingFrom(reserved: Record<string, unknown>): WritingReservation["approaching"] {
  if (reserved.approaching !== true || typeof reserved.writing_resets_at !== "string") return null;
  const meter =
    reserved.writing_meter === "writing_daily" || reserved.writing_meter === "writing_monthly"
      ? reserved.writing_meter
      : null;
  return { resetsAt: reserved.writing_resets_at, meter };
}

/** Reserve, run and settle one metered writing operation. */
export async function runMeteredOperation(options: MeteredOperationOptions): Promise<void> {
  let callId: string;
  let bounds: ReplyBounds | null;
  let approaching: WritingReservation["approaching"];
  try {
    const reserved = (await options.post({ action: "reserve" })) as Record<string, unknown>;
    // Read inside the same `try`, as the route always did: an answer that
    // cannot be read is a start that did not happen, not a thrown operation.
    callId = reserved.call_id as string;
    bounds = replyBoundsFromReservation(reserved);
    approaching = approachingFrom(reserved);
  } catch (error) {
    // A REFUSED RESERVATION ENDS THE OPERATION BEFORE ANY MODEL CALL, and the
    // sentence is application code's. Asking a model to explain that it could
    // not be afforded would be the call the refusal exists to prevent.
    options.onRefused(reserveRefusalCopy(error), "reserve");
    return;
  }
  options.onReserved?.({ call_id: callId, bounds });
  try {
    if (bounds === null) {
      options.onRefused(NOT_STARTED_COPY, "bounds");
      return;
    }
    await options.run({ call_id: callId, bounds, approaching });
  } finally {
    const settlement = options.meter.settlement();
    try {
      await options.post({
        action: "settle",
        call_id: callId,
        outcome: settlement.outcome,
        ...(settlement.outcome === "settled" ? { actual_microdollars: settlement.actualMicrodollars } : {}),
        // Usage on every outcome, including `uncertain`, which most needs
        // reconciling; per model too (P4.3 fix round 1).
        usage: { ...options.meter.usage(), by_model: options.meter.usageByModel() },
      });
    } catch {
      // Left `reserved`; the next writing admission marks it `uncertain` once
      // it expires (P1.4), which the operator's reconciliation covers.
    }
  }
}
