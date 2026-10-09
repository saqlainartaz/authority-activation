import "server-only";

import { wasCertainlyUnbilled } from "@/agent/lib/call-billing";
import type { Driver, TurnResult, TurnUsage } from "@/agent/lib/driver";
import { DEFAULT_WRITER_MODEL, turnCostMicrodollars, type PassUsage, type WriterPrices } from "@/agent/lib/pricing";

/**
 * How a C4 turn's reservation is settled, decided from the model calls the turn
 * actually made (Cycle 5, P1.4; spec 10A.1: held -> settled / released /
 * expired).
 *
 * The route used to settle `settled` only when the turn completed normally with
 * every figure reported; any thrown error left it `uncertain`, even when no
 * model call was ever made, or when every call that ran had reported its usage.
 * Each `uncertain` holds its whole reservation until a human reconciles it, so
 * a turn that failed before its first call pinned money nothing had spent.
 *
 *   - No model call was dispatched: `cancelled_unsent`, which releases the
 *     reservation. Nothing reached the provider.
 *   - Every dispatched call came back with full usage, including when the turn
 *     later threw or was cancelled: `settled` at the priced sum. You pay for
 *     what ran; a cancelled call is charged at least its input cost.
 *   - Otherwise (a call that threw, so its usage is unknown, or a figure
 *     missing): `uncertain`, which releases nothing.
 *
 * A call is counted as dispatched BEFORE it is made, so one that throws is a
 * call that may have reached the provider, never a call that was not sent --
 * unless the driver marked the failure CERTAINLY unbilled (Ruling 16's list,
 * after its own retries; P4.3 fix round 1, Ruling 63). That call is uncounted,
 * so the turn settles at the passes that ran. A timeout or a failure after the
 * response began is never marked and still leaves the turn `uncertain`.
 *
 * Each pass is priced at the model it ran on (Cycle 5, P1.5), with the prices
 * the reservation carried when there are any, else the runtime's own copy of
 * the same table (`pricing.ts`).
 */

export type TurnSettlement =
  | { outcome: "cancelled_unsent" }
  | { outcome: "settled"; actualMicrodollars: number }
  | { outcome: "uncertain" };

export type TurnMeter = {
  /** The driver to run the turn with: the inner driver, metered. */
  driver: Driver;
  /** Usage summed over every pass that reported (`null` + 5 is 5). */
  usage(): TurnUsage;
  /** The same sums per model (P4.3 fix round 1, review M3): a reconciler can
   *  price a turn whose passes ran on different models. */
  usageByModel(): Record<string, TurnUsage>;
  /** The settlement the calls made so far call for. */
  settlement(): TurnSettlement;
};

const NO_USAGE: TurnUsage = {
  inputTokens: null,
  outputTokens: null,
  cacheReadInputTokens: null,
  cacheCreationInputTokens: null,
};

/** `null + null` stays null; `null + 5` is 5. */
function add(left: number | null, right: number | null): number | null {
  if (left === null) return right;
  if (right === null) return left;
  return left + right;
}

/** Whether the provider reported all four figures, each a real number. */
function fullyReported(usage: TurnUsage | undefined): boolean {
  if (!usage) return false;
  return [usage.inputTokens, usage.outputTokens, usage.cacheReadInputTokens, usage.cacheCreationInputTokens].every(
    (value) => typeof value === "number" && Number.isFinite(value),
  );
}

/**
 * Wrap `inner` so every model call it makes is counted. `onPass` sees each
 * completed pass (the route keeps the last pass's text for its closing remark).
 */
export function meterTurn(
  inner: Driver,
  onPass?: (result: TurnResult) => void,
  prices?: () => WriterPrices | undefined,
): TurnMeter {
  let dispatched = 0;
  let completed = 0;
  let everyPassReported = true;
  let total: TurnUsage = NO_USAGE;
  const passes: PassUsage[] = [];

  const driver: Driver = {
    toProviderTools: inner.toProviderTools,
    async runTurn(request) {
      dispatched += 1;
      let result: TurnResult;
      try {
        result = await inner.runTurn(request);
      } catch (error) {
        if (wasCertainlyUnbilled(error)) dispatched -= 1;
        throw error;
      }
      completed += 1;
      if (!fullyReported(result.usage)) everyPassReported = false;
      const usage = result.usage ?? NO_USAGE;
      passes.push({ model: result.model ?? DEFAULT_WRITER_MODEL, usage });
      total = {
        inputTokens: add(total.inputTokens, usage.inputTokens),
        outputTokens: add(total.outputTokens, usage.outputTokens),
        cacheReadInputTokens: add(total.cacheReadInputTokens, usage.cacheReadInputTokens),
        cacheCreationInputTokens: add(total.cacheCreationInputTokens, usage.cacheCreationInputTokens),
      };
      onPass?.(result);
      return result;
    },
  };

  return {
    driver,
    usage: () => total,
    usageByModel() {
      const byModel: Record<string, TurnUsage> = {};
      for (const pass of passes) {
        const sum = byModel[pass.model] ?? NO_USAGE;
        byModel[pass.model] = {
          inputTokens: add(sum.inputTokens, pass.usage.inputTokens),
          outputTokens: add(sum.outputTokens, pass.usage.outputTokens),
          cacheReadInputTokens: add(sum.cacheReadInputTokens, pass.usage.cacheReadInputTokens),
          cacheCreationInputTokens: add(sum.cacheCreationInputTokens, pass.usage.cacheCreationInputTokens),
        };
      }
      return byModel;
    },
    settlement(): TurnSettlement {
      if (dispatched === 0) return { outcome: "cancelled_unsent" };
      if (completed === dispatched && everyPassReported) {
        const cost = turnCostMicrodollars(passes, prices?.());
        if (cost !== null) return { outcome: "settled", actualMicrodollars: cost };
      }
      return { outcome: "uncertain" };
    },
  };
}
