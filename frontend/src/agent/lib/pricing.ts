import "server-only";

import type { TurnUsage } from "@/agent/lib/driver";
import writerPrices from "@/agent/lib/writer-prices.json";

/**
 * The provider's list price for the models a reply may use, and a turn's
 * actual cost from the usage the provider itself reported.
 *
 * **Approved by the operator** (C4 closure goal, 2026-09-25, authorization 4):
 * "Use Anthropic's published list price at run time and record its source".
 * Until then every turn settled `uncertain`, because converting usage into
 * money without a recorded rate would have been inventing a figure, and a
 * tenant's committed exposure could only grow.
 *
 * **One price source (Cycle 5, P1.5).** The rates used to be hand-copied here.
 * They now come from `writer-prices.json`, GENERATED from the backend's writer
 * price table (`src/content_engine/ke/reply_bounds.py`,
 * `scripts/write_writer_prices.py`; the backend test
 * `test_the_frontend_price_file_is_the_backend_table` fails on any drift).
 * The backend table records each rate's source and retrieval date. A C4 turn
 * prefers the prices its reservation carries, which are the same table as
 * served, so the reservation and the settlement are priced alike.
 *
 * Rates are microdollars per million tokens. This runtime's cache markers are
 * the default five-minute kind, so `cache_write_5m` is the write price that
 * applies.
 */

/** One model's rates, microdollars per million tokens. */
export type ModelRates = { input: number; cache_write_5m: number; cache_read: number; output: number };
export type WriterPrices = Readonly<Record<string, ModelRates>>;

export const WRITER_PRICE_TABLE_VERSION: string = writerPrices.price_table_version;
export const WRITER_PRICES: WriterPrices = Object.freeze({ ...writerPrices.prices });

/** The model a pass ran on when it did not say: the runtime's own choice. */
export const DEFAULT_WRITER_MODEL: string = process.env.AGENT_MODEL ?? "claude-opus-5";

/** One model call's usage and the model it ran on. */
export type PassUsage = { model: string; usage: TurnUsage };

const TOKENS_PER_MILLION = 1_000_000;

function reported(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * One pass's cost in whole microdollars, rounded UP, at its own model's rates.
 * `null` when the provider did not report every figure, or the model has no
 * price -- in which case the turn must stay `uncertain` rather than be settled
 * on a guess.
 */
export function passCostMicrodollars(
  usage: TurnUsage,
  model: string,
  prices: WriterPrices = WRITER_PRICES,
): number | null {
  const { inputTokens, outputTokens, cacheReadInputTokens, cacheCreationInputTokens } = usage;
  if (
    !reported(inputTokens) ||
    !reported(outputTokens) ||
    !reported(cacheReadInputTokens) ||
    !reported(cacheCreationInputTokens)
  ) {
    return null;
  }
  const rate = Object.prototype.hasOwnProperty.call(prices, model) ? prices[model] : undefined;
  if (rate === undefined) return null;
  // Whole token counts times whole per-million rates: exact, then rounded up once.
  const exact =
    inputTokens * rate.input +
    cacheCreationInputTokens * rate.cache_write_5m +
    cacheReadInputTokens * rate.cache_read +
    outputTokens * rate.output;
  return Math.ceil(exact / TOKENS_PER_MILLION);
}

/**
 * A turn's cost: each pass priced at the model THAT pass ran on, rounded up per
 * pass, and summed. `null` when any pass is unpriced.
 */
export function turnCostMicrodollars(
  passes: readonly PassUsage[],
  prices: WriterPrices = WRITER_PRICES,
): number | null {
  let total = 0;
  for (const pass of passes) {
    const cost = passCostMicrodollars(pass.usage, pass.model, prices);
    if (cost === null) return null;
    total += cost;
  }
  return total;
}

const RATE_FIELDS = ["input", "cache_write_5m", "cache_read", "output"] as const;

/** Rates as the reserve response carries them, validated; `null` when malformed or empty. */
export function parseWriterPrices(raw: unknown): WriterPrices | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const parsed: Record<string, ModelRates> = {};
  for (const [model, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value !== "object" || value === null) return null;
    const rates = value as Record<string, unknown>;
    if (!RATE_FIELDS.every((field) => Number.isSafeInteger(rates[field]) && (rates[field] as number) >= 0)) {
      return null;
    }
    parsed[model] = {
      input: rates.input as number,
      cache_write_5m: rates.cache_write_5m as number,
      cache_read: rates.cache_read as number,
      output: rates.output as number,
    };
  }
  return Object.keys(parsed).length > 0 ? Object.freeze(parsed) : null;
}
