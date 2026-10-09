import fs from "node:fs";

import { DEFAULT_WRITER_MODEL, WRITER_PRICES, passCostMicrodollars } from "@/agent/lib/pricing";

/**
 * Everything spent so far, from the ledger. A turn is written as RESERVED at
 * its worst case before the paid call and SETTLED at its actual cost right
 * after, so a run that dies between the two still counts the worst case: a
 * charge the ledger lost would let a later run cross the cap (outside review,
 * pass 6). Rows without a turn id cost nothing (they record cards, not calls).
 */
export function spent(ledger: string, worstCase: number): number {
  if (!ledger || !fs.existsSync(ledger)) return 0;
  const turns = new Map<string, { reserved: number; settled: number | null }>();
  for (const line of fs.readFileSync(ledger, "utf8").split("\n").filter(Boolean)) {
    const row = JSON.parse(line) as { turn_id?: string; phase?: string; cost_microdollars?: number | null };
    if (!row.turn_id) continue;
    const entry = turns.get(row.turn_id) ?? { reserved: 0, settled: null };
    if (row.phase === "reserved") entry.reserved = worstCase;
    if (row.phase === "settled") entry.settled = row.cost_microdollars ?? worstCase;
    turns.set(row.turn_id, entry);
  }
  let total = 0;
  for (const entry of turns.values()) total += entry.settled ?? entry.reserved;
  return total;
}

/** A turn's cost priced pass by pass, each at the model it ran on (a trace from
 *  before passes recorded one is the runtime's default model): any pass with a
 *  missing figure makes the whole turn unpriced, so it counts at its worst case. */
export function turnCost(
  passes: { usage: Parameters<typeof passCostMicrodollars>[0]; model?: string }[],
): number | null {
  let total = 0;
  for (const pass of passes) {
    const cost = passCostMicrodollars(pass.usage, pass.model ?? DEFAULT_WRITER_MODEL);
    if (cost === null) return null;
    total += cost;
  }
  return total;
}


/**
 * The most one turn can cost, from the limits the runtime ENFORCES (outside
 * review pass 7: the fixed US$2 it replaces was not an upper bound). A turn
 * makes at most `maxToolCalls + 1` provider passes; each pass bills at most
 * `maxTokens` of output, and at most the model's context window of input --
 * a request larger than the window is refused, not billed -- priced here at
 * the dearest input rate (a cache write). With 10 calls, 4,096 tokens and a
 * 200,000-token window this is about US$14.88.
 *
 * Not covered: an attempt the SDK retries after a timeout that the provider
 * nevertheless billed. `settled` rows record what the provider reported.
 */
export function turnWorstCase(maxToolCalls: number, maxTokens: number, contextWindow: number): number {
  // Rates are microdollars per MILLION tokens (`writer-prices.json`).
  const rate = WRITER_PRICES["claude-opus-5"];
  const input = Math.max(rate.input, rate.cache_write_5m);
  return Math.ceil(((maxToolCalls + 1) * (contextWindow * input + maxTokens * rate.output)) / 1_000_000);
}

/**
 * The ONE ledger an authorized evaluation spends against, named explicitly
 * (outside review pass 7). It used to sit beside the chosen output folder, so
 * two runs with different folders each saw an empty ledger and the operator's
 * cumulative cap held for neither. No ledger named, no paid turn.
 */
export function ledgerPath(env: Record<string, string | undefined>): string {
  const ledger = env.C4_EVAL_LEDGER ?? "";
  if (!ledger) throw new Error("C4_EVAL_LEDGER must name the evaluation's one shared ledger");
  return ledger;
}

/**
 * Check the cap and write the RESERVED row as one step, under an exclusive
 * lock file beside the ledger (verification of outside review pass 7: read,
 * check and append were separate, so two runners at once could each admit a
 * turn against the same balance). Returns false, writing nothing, when the
 * turn could cross the cap. A lock held past `waitMs` is an error, never a
 * reservation made without it.
 */
export function reserve(
  ledger: string, row: Record<string, unknown>, worstCase: number, cap: number, waitMs = 10_000,
): boolean {
  const lock = `${ledger}.lock`;
  const deadline = Date.now() + waitMs;
  let fd: number | null = null;
  while (fd === null) {
    try {
      fd = fs.openSync(lock, "wx");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      if (Date.now() > deadline) throw new Error(`ledger lock held: ${lock}`);
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
    }
  }
  try {
    if (spent(ledger, worstCase) + worstCase > cap) return false;
    fs.appendFileSync(ledger, JSON.stringify({ ...row, phase: "reserved", cost_microdollars: worstCase }) + "\n");
    return true;
  } finally {
    fs.closeSync(fd);
    fs.rmSync(lock, { force: true });
  }
}
