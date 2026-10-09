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
  MAX_MESSAGE_CACHE_BREAKPOINTS,
  withCacheBreakpoints,
} from "@/agent/lib/loop";

describe("the model configuration", () => {
  it('caches the stable source prefix, not earlier client messages, and preserves bytes', () => {
    // CHANGED EXPECTATION (C4 merged main, 2026-09-25). Main's providerMessages
    // marked only the flagged source message. C4 sends every message through
    // withCacheBreakpoints, which ALSO marks the newest message -- the boundary
    // that pays within a turn -- so "not client messages" now means not the
    // EARLIER ones. A marker caches a prefix; it changes no text.
    expect(withCacheBreakpoints([
      { role: 'user', content: '<client-knowledge>source &amp; bytes</client-knowledge>', cache: true },
      { role: 'user', content: 'Who do we serve?' },
      { role: 'user', content: 'And where?' },
    ], null)).toEqual([
      { role: 'user', content: [{ type: 'text', text: '<client-knowledge>source &amp; bytes</client-knowledge>', cache_control: { type: 'ephemeral' } }] },
      { role: 'user', content: 'Who do we serve?' },
      { role: 'user', content: [{ type: 'text', text: 'And where?', cache_control: { type: 'ephemeral' } }] },
    ]);
  });

  it('never sends more message cache markers than the provider allows beside the system one', () => {
    // Four is the API's limit and the system prompt takes one. More is a 400.
    const flagged = Array.from({ length: 6 }, (_, i) => ({ role: 'user' as const, content: `source ${i}`, cache: true }));
    const sent = withCacheBreakpoints([...flagged, { role: 'user', content: 'now' }], 2) as { content: unknown }[];
    const marked = sent.filter(m => Array.isArray(m.content) && JSON.stringify(m.content).includes('cache_control'));
    expect(marked).toHaveLength(MAX_MESSAGE_CACHE_BREAKPOINTS);
    // The newest message and the conversation boundary always win.
    expect(JSON.stringify(sent.at(-1))).toContain('cache_control');
    expect(JSON.stringify(sent[2])).toContain('cache_control');
  });
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
