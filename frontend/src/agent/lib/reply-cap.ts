import "server-only";

import { REPLY_CAP_EXPLANATION, type Limits } from "@/agent/bounds";
import type { SystemBlock, ToolSpec, TurnUsage } from "@/agent/lib/driver";
import {
  DEFAULT_WRITER_MODEL,
  WRITER_PRICES,
  parseWriterPrices,
  passCostMicrodollars,
  type WriterPrices,
} from "@/agent/lib/pricing";
import type { ModelMessage } from "@/agent/transcript";

export { REPLY_CAP_EXPLANATION };

/**
 * The per-reply cap and the per-call input bound (Cycle 5, P1.5; spec 10A.2).
 *
 * A C4 reply is reserved at the cap plus ONE model call's worst case, derived
 * by the backend from the limits enforced here (`reply_bounds.py`). Both halves
 * of that sum are this file's to hold:
 *
 * - **The cap.** The running cost, every pass priced at its own model, is
 *   checked before each call (`shouldStop`, `bounds.ts`); once it reaches the
 *   cap no further call is sent. So the most a reply spends is just under the
 *   cap plus the one call that started there.
 * - **One call's worst case.** That call's output is bounded by `max_tokens`
 *   (`loop.ts`, `MAX_TOKENS`, which must equal the backend's
 *   `MAX_CALL_OUTPUT_TOKENS`) and its input by `maxCallInputTokens`: a call
 *   whose estimated input is larger is never sent.
 *
 * A pass whose cost cannot be computed (a missing usage figure, or a model with
 * no price) makes the running cost UNKNOWN, and an unknown cost is treated as
 * at the cap: the cap can no longer be shown to hold, and stopping keeps the
 * reply inside its reservation, since the reservation already covers the one
 * call that just ran.
 *
 * Only a C4 reply has a reservation, and only it gets these bounds. The M1
 * (`context.v1`) path passes none and is unchanged.
 */

/** Characters per token for content the provider has not counted yet. Deliberately low (most English
 *  prose runs nearer four), so the estimate errs towards refusing a call rather than sending one too large. */
export const CHARS_PER_TOKEN = 3;

/** The bounds a reservation carries, as the turn uses them. */
export type ReplyBounds = {
  limits: Required<Pick<Limits, "maxReplyCostMicrodollars" | "maxCallInputTokens">>;
  /** Not enforced here: `loop.ts` sends `MAX_TOKENS`. Kept so a test can pin the two equal. */
  maxCallOutputTokens: number;
  prices: WriterPrices;
};

function positiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0;
}

/**
 * The bounds in a `reserve` response, or `null` when any part is missing or
 * invalid: a cap, input or output bound that is not a positive integer, or
 * prices that are absent or malformed.
 *
 * **`null` refuses the reply** (fix round 1, ruling 17): the route ends a C4
 * turn before any model call when this returns `null`. It used to mean "no
 * cap", so a malformed or zero-cap response ran the reply uncapped against a
 * reservation sized for a cap. A reservation whose bounds cannot be read is
 * not one the reply can be held to.
 */
export function replyBoundsFromReservation(raw: unknown): ReplyBounds | null {
  if (typeof raw !== "object" || raw === null) return null;
  const body = raw as Record<string, unknown>;
  if (
    !positiveInteger(body.reply_cap_microdollars) ||
    !positiveInteger(body.max_call_input_tokens) ||
    !positiveInteger(body.max_call_output_tokens)
  ) {
    return null;
  }
  const prices = parseWriterPrices(body.prices);
  if (prices === null) return null;
  return {
    limits: {
      maxReplyCostMicrodollars: body.reply_cap_microdollars,
      maxCallInputTokens: body.max_call_input_tokens,
    },
    maxCallOutputTokens: body.max_call_output_tokens,
    prices,
  };
}

/** The estimated input of the next call: what the provider last reported, plus what was added since. */
export function estimateCallInputTokens(lastReportedInputTokens: number | null, newChars: number): number {
  return (lastReportedInputTokens ?? 0) + Math.ceil(Math.max(newChars, 0) / CHARS_PER_TOKEN);
}

function messageChars(message: ModelMessage): number {
  // The provider's own blocks when the message carries them (thinking included,
  // which is sent back); otherwise the text and the native tool blocks.
  if (message.providerBlocks && message.providerBlocks.length > 0) {
    return JSON.stringify(message.providerBlocks).length;
  }
  let chars = message.content.length;
  if (message.toolCalls) chars += JSON.stringify(message.toolCalls).length;
  if (message.toolResults) {
    for (const result of message.toolResults) chars += result.content.length + result.toolUseId.length;
  }
  return chars;
}

/** Every character a call would send: system, tools and messages. */
export function requestChars(system: SystemBlock[], messages: ModelMessage[], tools: ToolSpec[]): number {
  let chars = 0;
  for (const block of system) chars += block.text.length;
  for (const tool of tools) chars += tool.name.length + tool.description.length + JSON.stringify(tool.inputSchema).length;
  for (const message of messages) chars += messageChars(message);
  return chars;
}

/** The running cost of one reply, and the input baseline for the next estimate. */
export type ReplyMeter = {
  /** The estimated input of a call that would send `chars` characters. */
  estimate(chars: number): number;
  /** Record a completed pass that was sent with `chars` characters. */
  record(chars: number, model: string | undefined, usage: TurnUsage): void;
  /** The running cost, or `null` when a pass could not be priced. */
  cost(): number | null;
};

function reportedInput(usage: TurnUsage): number | null {
  const figures = [usage.inputTokens, usage.cacheReadInputTokens, usage.cacheCreationInputTokens];
  if (!figures.every((value) => typeof value === "number" && Number.isFinite(value))) return null;
  return (figures as number[]).reduce((sum, value) => sum + value, 0);
}

/**
 * `spent` is what this reply cost before its first loop pass: the session
 * summary (Cycle 5, P4.3), a pass of the same reply on another model.
 */
export function createReplyMeter(prices: WriterPrices = WRITER_PRICES, spent = 0): ReplyMeter {
  let cost: number | null = spent;
  // The input the provider last reported, and how many characters that call
  // sent. With none (first call, or a pass that did not report its input),
  // everything is new content.
  let baselineTokens: number | null = null;
  let baselineChars = 0;
  return {
    estimate(chars) {
      return estimateCallInputTokens(baselineTokens, baselineTokens === null ? chars : chars - baselineChars);
    },
    record(chars, model, usage) {
      const passCost = passCostMicrodollars(usage, model ?? DEFAULT_WRITER_MODEL, prices);
      cost = cost === null || passCost === null ? null : cost + passCost;
      baselineTokens = reportedInput(usage);
      baselineChars = chars;
    },
    cost: () => cost,
  };
}
