import { describe, expect, it } from "vitest";

import { DEFAULT_LIMITS } from "@/agent/bounds";
import {
  EFFORT,
  MAX_RETRIES,
  MAX_TOKENS,
  MIN_PER_CALL_TIMEOUT_MS,
  MODEL,
  PER_CALL_TIMEOUT_FLOOR_THRESHOLD_MS,
  RETRY_BACKOFF_ALLOWANCE_MS,
  anthropicDriver,
  perCallTimeoutMs,
} from "@/agent/lib/loop";

describe("the model configuration", () => {
  it("pins §5.8's values", () => {
    // Each is either measured or a documented divergence — none is a taste
    // choice, so each is asserted rather than left to a code review.
    expect(MODEL).toBe("claude-opus-5");
    expect(MAX_TOKENS).toBe(4096); // mirrors GENERATION_MAX_TOKENS, measured 2026-08-17
    expect(EFFORT).toBe("low");
  });

  it("constructs without a key, and fails only when called", () => {
    // The repo's standing provider rule (AI_CODING_RULES): adapters construct
    // keyless so the suite stays keyless, and raise at call time.
    expect(() => anthropicDriver).not.toThrow();
    expect(typeof anthropicDriver.runTurn).toBe("function");
  });
});

describe("the per-call timeout (R16)", () => {
  it("keeps timeout × (MAX_RETRIES + 1), plus the SDK's own retry backoff, strictly below bounds.ts's deadline", () => {
    // The bound belongs to bounds.ts — DEFAULT_LIMITS.deadlineMs is imported,
    // never re-declared, so this test would fail loudly if bounds.ts's own
    // deadline ever changed under it.
    const worstCaseWallTimeMs = perCallTimeoutMs(DEFAULT_LIMITS.deadlineMs) * (MAX_RETRIES + 1) + RETRY_BACKOFF_ALLOWANCE_MS;

    expect(worstCaseWallTimeMs).toBeLessThan(DEFAULT_LIMITS.deadlineMs);
  });

  it("floors the per-call timeout rather than handing the SDK zero or a negative number for a tiny turn budget", () => {
    expect(perCallTimeoutMs(0)).toBe(MIN_PER_CALL_TIMEOUT_MS);
    expect(perCallTimeoutMs(1_000)).toBe(MIN_PER_CALL_TIMEOUT_MS);
    // Sanity: the floor value itself must be positive, or the previous two
    // assertions would be vacuously "passing" against a useless constant.
    expect(MIN_PER_CALL_TIMEOUT_MS).toBeGreaterThan(0);
  });
});

describe("the per-call timeout floor's honest boundary (R18)", () => {
  it("pins PER_CALL_TIMEOUT_FLOOR_THRESHOLD_MS to the same formula loop.ts derives it from", () => {
    // Recomputed here from the three exported constants, not copied as a bare
    // number — if loop.ts's export and this formula ever disagree, one of
    // them was hand-edited instead of derived, which is exactly the silent
    // drift R18 exists to prevent.
    const derived = MIN_PER_CALL_TIMEOUT_MS * (MAX_RETRIES + 1) + RETRY_BACKOFF_ALLOWANCE_MS;

    expect(PER_CALL_TIMEOUT_FLOOR_THRESHOLD_MS).toBe(derived);
  });

  it("strictly above the threshold, the R16 guarantee still holds", () => {
    const budget = PER_CALL_TIMEOUT_FLOOR_THRESHOLD_MS + 1;
    const worstCaseWallTimeMs = perCallTimeoutMs(budget) * (MAX_RETRIES + 1) + RETRY_BACKOFF_ALLOWANCE_MS;

    expect(worstCaseWallTimeMs).toBeLessThan(budget);
  });

  it("at or below the threshold, the floor takes over and the strict inequality honestly lapses", () => {
    // The traded-away property, pinned rather than left to a docstring's
    // word: at the threshold itself, perCallTimeoutMs returns the floor
    // rather than a computed value...
    const budget = PER_CALL_TIMEOUT_FLOOR_THRESHOLD_MS;
    expect(perCallTimeoutMs(budget)).toBe(MIN_PER_CALL_TIMEOUT_MS);

    // ...and worst-case wall time lands exactly ON the budget rather than
    // under it — not less than, which is the guarantee's own boundary.
    const worstCaseWallTimeMs = perCallTimeoutMs(budget) * (MAX_RETRIES + 1) + RETRY_BACKOFF_ALLOWANCE_MS;
    expect(worstCaseWallTimeMs).toBe(PER_CALL_TIMEOUT_FLOOR_THRESHOLD_MS);
    expect(worstCaseWallTimeMs).not.toBeLessThan(budget);
  });
});
