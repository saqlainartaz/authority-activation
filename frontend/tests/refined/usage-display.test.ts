import { describe, expect, it } from "vitest";

import { meterView } from "@/lib/limits";
import type { KeUsage, UploadsUsage, UsageMeter } from "@/lib/usage";
import {
  formatReset,
  loadUsage,
  meterRow,
  meterRows,
  uploadsRow,
  usageSource,
  usageStateFrom,
  usageSubtitle,
} from "@/refined/usage-display";

/**
 * Cycle 5 P2.6: Settings -> Usage's display rules (spec 10A.4, Ruling 11).
 * `available == false` is the only "reached" signal; an unknown figure is "Not
 * available", never 0; every reset is UTC and says so; no dollars.
 */

const DAY_RESET = "2026-10-06T00:00:00+00:00";
const MONTH_RESET = "2026-11-01T00:00:00+00:00";
const meter = (used_fraction: number | null, available = true, resets_at = DAY_RESET): UsageMeter =>
  ({ used_fraction, available, resets_at });

const UPLOADS: UploadsUsage = {
  month: "2026-10", base: 20, extra: 10, used: 18, remaining: 12, unlimited: false, resets_at: MONTH_RESET,
};

const KE: KeUsage = {
  engine: "ke",
  uploads: UPLOADS,
  writing: { today: meter(0.42), month: meter(0.18, true, MONTH_RESET) },
  documents: { today: meter(0.05) },
};

describe("a budget meter's row", () => {
  it("shows a null fraction as Not available, with no bar and no 0", () => {
    const row = meterRow("Writing today", meter(null, false), "day");
    expect(row).toEqual({ label: "Writing today", state: "unavailable", usage: "Not available", fraction: null, note: null });
    expect(JSON.stringify(row)).not.toMatch(/0%/);
  });

  it("says Limit reached, with the UTC reset, only when the meter is not available", () => {
    const row = meterRow("Writing today", meter(1, false), "day");
    expect(row.state).toBe("reached");
    expect(row.note).toBe("Limit reached · resets 00:00 UTC");
  });

  it("reads 1.0 that is still available as nearly used up, not reached (Ruling 11)", () => {
    const row = meterRow("Writing today", meter(1, true), "day");
    expect(row.state).toBe("near");
    expect(row.usage).toBe("100% used");
    expect(row.note).toBe("Nearly used up · resets 00:00 UTC");
    expect(row.note).not.toContain("Limit reached");
  });

  it("says nearly used up at 0.85", () => {
    expect(meterRow("Writing today", meter(0.85), "day").note).toBe("Nearly used up · resets 00:00 UTC");
  });

  it("shows only the reset below 80%", () => {
    expect(meterRow("Writing today", meter(0.42), "day")).toMatchObject({ usage: "42% used", fraction: 0.42, note: "Resets 00:00 UTC" });
  });

  it("clamps the bar to [0, 1]", () => {
    expect(meterRow("x", meter(1.4, false), "day").fraction).toBe(1);
    expect(meterRow("x", meter(-0.2), "day").fraction).toBe(0);
  });

  it("names a monthly reset by its date", () => {
    expect(meterRow("Writing this month", meter(0.9, false, MONTH_RESET), "month").note)
      .toBe("Limit reached · resets 1 November, 00:00 UTC");
  });

  it("lists writing today, writing this month and document processing today, in that order", () => {
    expect(meterRows(KE).map((row) => row.label)).toEqual(["Writing today", "Writing this month", "Document processing today"]);
  });

  it("agrees with the operator's Limits card on the same meter", () => {
    for (const [fraction, available] of [[1, true], [1, false], [0.5, false], [0.3, true]] as const) {
      const client = meterRow("x", meter(fraction, available), "day");
      const operator = meterView({ limit_usd: 10, spent_usd: 1, used_fraction: fraction, available });
      expect(client.note?.startsWith("Limit reached") ?? false).toBe(operator.status === "Limit reached");
      expect(client.usage).toBe(operator.usage);
    }
    expect(meterRow("x", meter(null, false), "day").usage).toBe(
      meterView({ limit_usd: 10, spent_usd: 1, used_fraction: null, available: false }).usage,
    );
  });
});

describe("reset times", () => {
  it("are formatted in UTC and labelled UTC, whatever offset they were sent in", () => {
    expect(formatReset("2026-10-06T02:00:00+02:00", "day")).toBe("00:00 UTC");
    expect(formatReset(DAY_RESET, "day")).toBe("00:00 UTC");
  });

  it("show a month reset as a date", () => {
    expect(formatReset(MONTH_RESET, "month")).toBe("1 November, 00:00 UTC");
  });

  it("are left out when they cannot be read", () => {
    expect(formatReset("not a date", "day")).toBeNull();
    expect(meterRow("x", meter(0.3, true, ""), "day").note).toBeNull();
  });
});

describe("the uploads line", () => {
  it("counts the plan and this month's extra uploads", () => {
    expect(uploadsRow(UPLOADS)).toEqual({
      summary: "18 of 30 uploads used this month · 12 left",
      note: "Resets 1 November, 00:00 UTC",
      reached: false,
    });
  });

  it("says Unlimited uploads when there is no monthly limit", () => {
    const row = uploadsRow({ ...UPLOADS, base: null, remaining: null, unlimited: true });
    expect(row.summary).toBe("Unlimited uploads");
    expect(row.note).toBe("18 used this month");
  });

  it("says uploads are not set up for an unprovisioned client, never 0", () => {
    const row = uploadsRow({ ...UPLOADS, base: null, extra: null, remaining: null, unlimited: false });
    expect(row).toEqual({ summary: "Uploads aren't set up for this account yet", note: null, reached: false });
  });

  it("says the limit is reached when nothing is left", () => {
    expect(uploadsRow({ ...UPLOADS, used: 30, remaining: 0 }).note).toBe("Limit reached · resets 1 November, 00:00 UTC");
  });
});

describe("reading the BFF's answer", () => {
  it("reads M1 as M1, and nothing else", () => {
    expect(usageStateFrom({ engine: "m1" })).toEqual({ kind: "m1" });
  });

  it("reads the rehaul figures", () => {
    expect(usageStateFrom(KE)).toEqual({ kind: "ke", usage: KE });
  });

  it("reads an unrecognised body as an error, never as zeros", () => {
    for (const body of [null, "x", {}, { engine: "other" }, { engine: "ke" }]) {
      expect(usageStateFrom(body)).toEqual({ kind: "error" });
    }
  });

  it("reads a malformed meter as unavailable, not reached", () => {
    const state = usageStateFrom({ ...KE, writing: { today: { used_fraction: 0.9 }, month: "x" } });
    expect(state.kind).toBe("ke");
    if (state.kind !== "ke") return;
    expect(meterRow("x", state.usage.writing.today, "day").state).toBe("unavailable");
    expect(meterRow("x", state.usage.writing.month, "month").state).toBe("unavailable");
  });

  it("turns a failed request into the error state", async () => {
    expect(await loadUsage(async () => { throw new Error("503"); })).toEqual({ kind: "error" });
    expect(await loadUsage(async () => ({ engine: "m1" }))).toEqual({ kind: "m1" });
  });

  it("never carries a dollar figure into the screen state", () => {
    const state = usageStateFrom({ ...KE, uploads: { ...UPLOADS, limit_usd: 50 }, spent_usd: 3 });
    expect(JSON.stringify(state)).not.toMatch(/usd|\$/i);
  });
});

describe("deciding before any read (A47)", () => {
  it("never reads usage under M1, and shows the old copy while the engine is unknown", () => {
    expect(usageSource("m1")).toBe("m1");
    // Changed expectation (P2.9, review M5): an unknown engine showed nothing at all,
    // which left the M1 Usage tab blank when `/api/client/engine` failed.
    expect(usageSource(null)).toBe("m1");
    expect(usageSource("ke")).toBe("fetch");
  });

  it("gives the Usage tab a neutral subtitle under the rehaul engine only", () => {
    expect(usageSubtitle(false, "ke")).toBe("Uploads and writing this month");
    expect(usageSubtitle(false, "m1")).toBe("Generations left this month");
    expect(usageSubtitle(false, null)).toBe("Generations left this month");
    expect(usageSubtitle(true, "ke")).toBe("Generations left this month");
  });
});
