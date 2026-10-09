import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  WRITER_PRICES,
  WRITER_PRICE_TABLE_VERSION,
  passCostMicrodollars,
  turnCostMicrodollars,
} from "@/agent/lib/pricing";
import writerPrices from "@/agent/lib/writer-prices.json";

/**
 * A turn's actual cost, from the provider's own usage and the list rate the
 * operator approved on 2026-09-25. Until that rate existed every turn settled
 * `uncertain` and a tenant's committed exposure could only grow.
 *
 * CHANGED FORM (Cycle 5, P1.5): a turn is priced PASS BY PASS, each at the
 * model that pass ran on, and the rates come from `writer-prices.json`, which
 * is generated from the backend's price table (the backend test
 * `test_the_frontend_price_file_is_the_backend_table` fails on any drift).
 */
const opus = (usage: Parameters<typeof passCostMicrodollars>[0]) => ({ model: "claude-opus-5", usage });

describe("a turn's actual cost", () => {
  it("prices each kind of token at its own rate", () => {
    // 1M fresh input $5, 1M cache writes $6.25, 1M cache reads $0.50, 1M output $25.
    expect(
      turnCostMicrodollars([
        opus({
          inputTokens: 1_000_000,
          cacheCreationInputTokens: 1_000_000,
          cacheReadInputTokens: 1_000_000,
          outputTokens: 1_000_000,
        }),
      ]),
    ).toBe(36_750_000);
  });

  it("rounds up, never down, so a settlement never under-records", () => {
    expect(
      turnCostMicrodollars([opus({ inputTokens: 0, cacheCreationInputTokens: 0, cacheReadInputTokens: 1, outputTokens: 0 })]),
    ).toBe(1);
  });

  it("rounds up per pass", () => {
    const tiny = { inputTokens: 0, cacheCreationInputTokens: 0, cacheReadInputTokens: 1, outputTokens: 0 };
    expect(turnCostMicrodollars([opus(tiny), opus(tiny)])).toBe(2);
  });

  it("has no cost when the provider did not report every figure", () => {
    expect(
      turnCostMicrodollars([
        opus({ inputTokens: 1, cacheCreationInputTokens: 0, cacheReadInputTokens: 0, outputTokens: 1 }),
        opus({ inputTokens: 10, cacheCreationInputTokens: null, cacheReadInputTokens: 0, outputTokens: 5 }),
      ]),
    ).toBeNull();
  });

  it("prices each pass at its own model and sums them", () => {
    const usage = { inputTokens: 1_000, cacheCreationInputTokens: 0, cacheReadInputTokens: 0, outputTokens: 100 };
    // Opus 5: 1,000 x $5/M + 100 x $25/M = 7,500. Haiku 4.5: 1,000 x $1/M + 100 x $5/M = 1,500.
    expect(passCostMicrodollars(usage, "claude-opus-5")).toBe(7_500);
    expect(passCostMicrodollars(usage, "claude-haiku-4-5-20251001")).toBe(1_500);
    expect(
      turnCostMicrodollars([
        { model: "claude-opus-5", usage },
        { model: "claude-haiku-4-5-20251001", usage },
      ]),
    ).toBe(9_000);
  });

  it("has no cost for a model it has no price for, rather than a guessed one", () => {
    const usage = { inputTokens: 1, cacheCreationInputTokens: 0, cacheReadInputTokens: 0, outputTokens: 1 };
    expect(turnCostMicrodollars([{ model: "claude-unknown", usage }])).toBeNull();
  });

  it("uses prices it is given, such as the reservation's, over its own copy", () => {
    const usage = { inputTokens: 1_000_000, cacheCreationInputTokens: 0, cacheReadInputTokens: 0, outputTokens: 0 };
    const given = { "claude-opus-5": { input: 7_000_000, cache_write_5m: 0, cache_read: 0, output: 0 } };
    expect(turnCostMicrodollars([opus(usage)], given)).toBe(7_000_000);
  });

  it("takes its rates from the generated price file, the backend's writer table", () => {
    expect(WRITER_PRICE_TABLE_VERSION).toBe("prices-placement-1");
    expect(WRITER_PRICE_TABLE_VERSION).toBe(writerPrices.price_table_version);
    expect(WRITER_PRICES).toEqual(writerPrices.prices);
    expect(WRITER_PRICES["claude-opus-5"]).toEqual({
      input: 5_000_000, cache_write_5m: 6_250_000, cache_read: 500_000, output: 25_000_000,
    });
  });
});

describe("the route settles a completed turn at its actual cost", () => {
  // Read from source, the convention this suite uses for the route.
  const route = fs.readFileSync(
    path.join(process.cwd(), "src/app/api/client/chat/sessions/[sessionId]/agent/route.ts"),
    "utf8",
  );

  // CHANGED FORM, same property (Cycle 5, P1.4): the decision moved into
  // `turn-settlement.ts`, which `tests/agent/turn-settlement.test.ts` drives
  // with stub drivers. Only when EVERY pass reported every figure does a turn
  // settle at cost, and a settled outcome always carries that cost. What
  // changed by rule: a turn that threw no longer always stays `uncertain` --
  // with no call made it releases, and with every call fully reported it is
  // charged what ran.
  // CHANGED FORM, same property (Cycle 5, P5.2, Ruling 68): the settlement
  // moved, unchanged, into `metered-operation.ts`, which the route and the
  // voice preview share; the route reaches it through `runMeteredOperation`.
  const operation = fs.readFileSync(path.join(process.cwd(), "src/agent/lib/metered-operation.ts"), "utf8");

  it("settles only with a computed cost, and sends that cost", () => {
    expect(route).toContain("await runMeteredOperation({");
    expect(operation).toContain("const settlement = options.meter.settlement();");
    expect(operation).toMatch(
      /settlement\.outcome === "settled"\s*\?\s*\{ actual_microdollars: settlement\.actualMicrodollars \}/,
    );
  });
});
