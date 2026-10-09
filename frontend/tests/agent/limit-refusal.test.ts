import { afterEach, describe, expect, it, vi } from "vitest";

import {
  approachingCopy,
  budgetRefusalCopy,
  CAMPAIGN_BUDGET_COPY,
  limitFromError,
  limitRefusalCopy,
  parseLimitRefusal,
  reserveRefusalCopy,
  TURN_IN_PROGRESS_COPY,
  TURN_SETTLED_COPY,
  turnConflictCopy,
  type LimitRefusal,
} from "@/lib/limit-refusal";

/**
 * Cycle 5, P1.6 (spec 10A.3-10A.4): a refused reply names the limit that was
 * reached and when it resets, never "try again shortly". The turn-budget 429
 * carries `limit` beside an unchanged `detail`; this is the one helper that
 * turns it into the sentence the chat shows.
 */

const DAY: LimitRefusal = {
  meter: "writing_daily",
  period: "day",
  used_fraction: 1,
  resets_at: "2026-10-05T00:00:00+00:00",
  reason: "budget_exhausted",
};

describe("limitRefusalCopy", () => {
  it("names today's writing limit and its UTC midnight reset", () => {
    expect(limitRefusalCopy(DAY)).toBe("Today's writing limit is reached. It resets at 00:00 UTC.");
  });

  it("names this month's writing limit and the day it resets", () => {
    const month = { ...DAY, meter: "writing_monthly", period: "month", resets_at: "2026-11-01T00:00:00+00:00" } as const;
    expect(limitRefusalCopy(month)).toBe(
      "This month's writing limit is reached. It resets on 1 November at 00:00 UTC.",
    );
  });

  it("reads the reset day in UTC, across a year end", () => {
    const month = { ...DAY, meter: "writing_monthly", period: "month", resets_at: "2027-01-01T00:00:00Z" } as const;
    expect(limitRefusalCopy(month)).toBe(
      "This month's writing limit is reached. It resets on 1 January at 00:00 UTC.",
    );
  });

  it("says a deployment pause is for everyone", () => {
    expect(limitRefusalCopy({ ...DAY, meter: "deployment_daily" })).toBe(
      "Writing is paused for everyone until 00:00 UTC.",
    );
  });

  it.each(["writing_daily", "writing_monthly", "deployment_daily"] as const)(
    "tells a %s refusal for a missing policy to contact support",
    (meter) => {
      expect(limitRefusalCopy({ ...DAY, meter, reason: "policy_missing" })).toBe(
        "Writing isn't set up for this account yet. Please contact support.",
      );
    },
  );

  it("never says try again shortly", () => {
    for (const meter of ["writing_daily", "writing_monthly", "deployment_daily"] as const) {
      expect(limitRefusalCopy({ ...DAY, meter })).not.toMatch(/try again/i);
    }
  });
});

describe("the monthly upload refusal (P2.2: the same limit shape)", () => {
  // The backend's 429 `monthly_upload_limit` body, verbatim in shape: `used` and
  // `allowed` stay, and `used_fraction` sits beside them.
  const UPLOADS = {
    meter: "uploads_monthly",
    period: "month",
    used: 2,
    allowed: 2,
    used_fraction: 1,
    resets_at: "2026-11-01T00:00:00+00:00",
    reason: "monthly_upload_limit",
  };

  it("is read like every other limit", () => {
    expect(parseLimitRefusal(UPLOADS)).toEqual({
      meter: "uploads_monthly",
      period: "month",
      used_fraction: 1,
      resets_at: "2026-11-01T00:00:00+00:00",
      reason: "monthly_upload_limit",
    });
    expect(limitFromError({ status: 429, body: { detail: "monthly_upload_limit", limit: UPLOADS } })).not.toBeNull();
  });

  it("names the upload limit and the day it resets", () => {
    const limit = parseLimitRefusal(UPLOADS);
    expect(limit && limitRefusalCopy(limit)).toBe(
      "This month's upload limit is reached. It resets on 1 November at 00:00 UTC.",
    );
  });

  it("still refuses the body from before P2.2, which had no used_fraction", () => {
    const { used_fraction: _dropped, ...older } = UPLOADS;
    expect(parseLimitRefusal(older)).toBeNull();
  });
});

describe("limitFromError", () => {
  const refused = (status: number, body: unknown) => ({ status, body });

  it("reads the limit off a 429 whose body carries one", () => {
    expect(limitFromError(refused(429, { detail: { code: "budget_exhausted" }, limit: DAY }))).toEqual(DAY);
  });

  it.each([
    ["no limit (an older backend, or a bucket refusal)", refused(429, { detail: { code: "budget_exhausted" } })],
    ["another status", refused(503, { detail: { code: "unavailable" }, limit: DAY })],
    ["an unknown meter", refused(429, { limit: { ...DAY, meter: "documents_daily" } })],
    ["an unknown reason", refused(429, { limit: { ...DAY, reason: "because" } })],
    ["no reset time", refused(429, { limit: { ...DAY, resets_at: undefined } })],
    ["an unreadable reset time", refused(429, { limit: { ...DAY, resets_at: "tomorrow" } })],
    ["not an error at all", new Error("the network")],
    ["nothing", null],
  ])("is null for %s", (_name, error) => {
    expect(limitFromError(error)).toBeNull();
  });
});

describe("a product error keeps the whole refusal body", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("so postTurnBudget's 429 still carries `limit`", async () => {
    vi.resetModules();
    vi.stubEnv("ENGINE_URL", "https://engine.test");
    vi.stubEnv("ENGINE_SERVICE_KEY", "service-key");
    const body = { detail: { code: "budget_exhausted", detail: "does not fit" }, limit: DAY };
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(body), { status: 429 })));
    const { postTurnBudget } = await import("@/lib/product");

    const error = await postTurnBudget("tok", "s", { action: "reserve", turn_id: "t" }).catch((e: unknown) => e);

    expect(error).toMatchObject({ status: 429, detail: body.detail, body });
    expect(limitFromError(error)).toEqual(DAY);
  });
});

/** A thrown product error, as `lib/product.ts` shapes it: the status and the whole body. */
const failed = (status: number, body: unknown) => ({ status, body });

describe("budgetRefusalCopy (P2.6, P1 milestone review Minor 8)", () => {
  it("names the limit when the 429 carries one", () => {
    expect(budgetRefusalCopy(failed(429, { detail: { code: "budget_exhausted" }, limit: DAY })))
      .toBe("Today's writing limit is reached. It resets at 00:00 UTC.");
  });

  it("says a bucket's budget is used up when the 429 names no limit, never 'try again shortly'", () => {
    const copy = budgetRefusalCopy(failed(429, { detail: { code: "budget_exhausted", detail: "does not fit" } }));
    expect(copy).toBe(CAMPAIGN_BUDGET_COPY);
    expect(copy).toBe("This campaign's writing budget is used up.");
    expect(copy).not.toMatch(/try again|nothing was saved/i);
  });

  it.each([
    ["a configuration refusal", failed(503, { detail: { code: "unavailable" } })],
    ["another 429", failed(429, { detail: "slow down" })],
    ["a lost connection", new Error("the network")],
    ["nothing", null],
  ])("is null for %s, which is not a budget refusal", (_name, error) => {
    expect(budgetRefusalCopy(error)).toBeNull();
  });
});

describe("approachingCopy (spec 10A.3)", () => {
  it("names today's writing budget and its UTC reset", () => {
    expect(approachingCopy("2026-10-06T00:00:00+00:00", "writing_daily"))
      .toBe("You've used most of today's writing budget. It resets at 00:00 UTC.");
  });

  it("names this month's budget and the reset date when the monthly meter binds", () => {
    expect(approachingCopy("2026-11-01T00:00:00+00:00", "writing_monthly"))
      .toBe("You've used most of this month's writing budget. It resets on 1 November at 00:00 UTC.");
  });

  it("names this month's budget on the month's last day too, when the monthly meter binds", () => {
    // On 31 October both resets are 1 November 00:00: the meter decides, not the date.
    expect(approachingCopy("2026-11-01T00:00:00+00:00", "writing_monthly"))
      .toContain("this month's writing budget");
    expect(approachingCopy("2026-11-01T00:00:00+00:00", "writing_daily"))
      .toBe("You've used most of today's writing budget. It resets at 00:00 UTC.");
  });

  it("reads the reset's own kind when an older backend names no meter", () => {
    expect(approachingCopy("2026-11-01T00:00:00+00:00"))
      .toBe("You've used most of this month's writing budget. It resets on 1 November at 00:00 UTC.");
    expect(approachingCopy("2026-10-06T00:00:00+00:00", null))
      .toBe("You've used most of today's writing budget. It resets at 00:00 UTC.");
  });
});

describe("a reserve for a turn id that already has a reservation (Ruling 70)", () => {
  const conflict = (code: unknown, status = 409) => ({ status, body: { detail: { code, detail: "x" } } });

  it("says a reply is already running, or already finished", () => {
    expect(turnConflictCopy(conflict("turn_in_progress"))).toBe(TURN_IN_PROGRESS_COPY);
    expect(turnConflictCopy(conflict("turn_settled"))).toBe(TURN_SETTLED_COPY);
    expect(reserveRefusalCopy(conflict("turn_in_progress"))).toBe("A reply to this message is already being written.");
    expect(reserveRefusalCopy(conflict("turn_settled"))).toBe("This message has already been answered.");
  });

  it("speaks for nothing else", () => {
    expect(turnConflictCopy(conflict("idempotency_conflict"))).toBeNull();
    expect(turnConflictCopy(conflict("turn_in_progress", 429))).toBeNull();
    expect(turnConflictCopy(null)).toBeNull();
    expect(reserveRefusalCopy(conflict("idempotency_conflict"))).toBe("I can't start this one right now. Nothing was sent — try again shortly.");
  });
});
