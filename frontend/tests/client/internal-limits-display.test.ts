import { describe, expect, it } from "vitest";

import {
  changedLimits,
  formFromLimits,
  formatUsd,
  formatUtc,
  historyValue,
  limitsEditBody,
  limitsRefusalMessage,
  mergeForm,
  meterView,
  principalLabel,
  settingLabel,
  uploadsView,
  type ClientLimits,
} from "@/lib/limits";

// Cycle 5 P2.5: the Limits card's pure display rules (spec §10.2, §10A.4).

const limits: ClientLimits = {
  month: "2026-10-01", monthly_uploads: 20, extra_uploads: 10, uploads_used: 18, uploads_remaining: 12,
  daily_limit_usd: 15, spent_today_usd: 3, revision: 3, writing_daily_limit_usd: 10, writing_monthly_limit_usd: 50,
  resets: { daily: "2026-10-06T00:00:00Z", monthly: "2026-11-01T00:00:00Z" },
  meters: {},
};

describe("budget use", () => {
  it("shows a null used_fraction as Not set, never as 0%", () => {
    const view = meterView({ limit_usd: null, spent_usd: 0, available: false, used_fraction: null });
    expect(view.usage).toBe("Not set");
    expect(view.fraction).toBeNull();
    expect(view.usage).not.toContain("0%");
    expect(view.status).not.toBe("Limit reached");
  });

  it("shows a configured budget whose fraction the deployment cannot compute as Not available (Ruling 33)", () => {
    const view = meterView({ limit_usd: 10, spent_usd: 4, available: false, used_fraction: null });
    expect(view.usage).toBe("Not available");
    expect(view.fraction).toBeNull();
    expect(view.status).not.toBe("Limit reached");
  });

  it("shows Limit reached when available is false", () => {
    expect(meterView({ limit_usd: 10, spent_usd: 7, available: false, used_fraction: 0.6 }).status).toBe("Limit reached");
  });

  it("does not show a fraction of 1.0 as reached while it is still available", () => {
    const view = meterView({ limit_usd: 10, spent_usd: 8.2, available: true, used_fraction: 1.0 });
    expect(view.status).toBeNull();
    expect(view.usage).toBe("100% used");
  });

  it("clamps the bar to the 0..1 range", () => {
    expect(meterView({ limit_usd: 10, spent_usd: 1, available: true, used_fraction: 1.4 }).fraction).toBe(1);
    expect(meterView({ limit_usd: 10, spent_usd: 1, available: true, used_fraction: -0.2 }).fraction).toBe(0);
  });

  it("shows a missing amount as Not set and dollars with the currency", () => {
    expect(formatUsd(null)).toBe("Not set");
    expect(formatUsd(10)).toBe("US$10.00");
    expect(formatUsd(8.1476)).toBe("US$8.15");
  });
});

describe("uploads", () => {
  it("shows no monthly limit as Unlimited", () => {
    expect(uploadsView({ monthly_uploads: null, extra_uploads: 0, uploads_used: 4, uploads_remaining: null }))
      .toEqual({ base: "Unlimited", extra: "0", used: "4", remaining: "Unlimited" });
  });

  it("shows base, extra, used and remaining as counts", () => {
    expect(uploadsView(limits)).toEqual({ base: "20", extra: "10", used: "18", remaining: "12" });
  });
});

describe("resets", () => {
  it("are formatted in UTC whatever the zone of the offset given", () => {
    expect(formatUtc("2026-10-06T00:00:00Z")).toBe("6 Oct 2026, 00:00 UTC");
    expect(formatUtc("2026-10-31T21:30:00-04:00")).toBe("1 Nov 2026, 01:30 UTC");
    expect(formatUtc("not a time")).toBe("Not recorded");
  });
});

describe("the edit form", () => {
  it("sends only the settings that changed", () => {
    const form = { ...formFromLimits(limits), writingDaily: "12.5" };
    expect(changedLimits(limits, form)).toEqual({ change: { writing_daily_usd: 12.5 }, error: null });
  });

  it("sends monthly_uploads null for Unlimited, and nothing when nothing changed", () => {
    expect(changedLimits(limits, { ...formFromLimits(limits), unlimitedUploads: true }).change).toEqual({ monthly_uploads: null });
    expect(changedLimits(limits, formFromLimits(limits)).change).toEqual({});
  });

  it("leaves a budget nobody configured alone while it stays empty", () => {
    const unset = { ...limits, writing_daily_limit_usd: null };
    expect(changedLimits(unset, formFromLimits(unset))).toEqual({ change: {}, error: null });
  });

  it("refuses an amount outside the backend's range", () => {
    expect(changedLimits(limits, { ...formFromLimits(limits), documentsDaily: "0" }).error).toContain("above US$0");
    expect(changedLimits(limits, { ...formFromLimits(limits), monthlyUploads: "2.5" }).error).toContain("whole number");
  });

  it("after a stale edit keeps what was typed and takes the current value for everything else", () => {
    const typed = { ...formFromLimits(limits), writingDaily: "12" };
    const current = formFromLimits({ ...limits, daily_limit_usd: 25, writing_daily_limit_usd: 11 });
    expect(mergeForm(current, typed, new Set(["writingDaily"] as const))).toEqual({ ...current, writingDaily: "12" });
  });
});

describe("the edit body", () => {
  it("diffs against the baseline the form was built from and sends its revision", () => {
    const form = { ...formFromLimits(limits), writingDaily: "12" };
    expect(limitsEditBody(limits, form, " Launch ")).toEqual({
      body: { writing_daily_usd: 12, reason: "Launch", expected_revision: 3 }, error: null,
    });
  });

  it("refuses to build a body with nothing changed or no reason", () => {
    expect(limitsEditBody(limits, formFromLimits(limits), "why").body).toBeNull();
    expect(limitsEditBody(limits, { ...formFromLimits(limits), writingDaily: "12" }, " ").error).toContain("reason");
  });
});

describe("history", () => {
  it("names settings, values and the shared principal plainly", () => {
    expect(settingLabel("writing_monthly_usd")).toBe("Writing monthly budget");
    expect(historyValue("monthly_uploads", null)).toBe("Unlimited");
    expect(historyValue("writing_daily_usd", "12.5")).toBe("US$12.50");
    expect(historyValue("extra_uploads", "+10 for 2026-10-01")).toBe("+10 for 2026-10-01");
    expect(principalLabel("operator:shared-passcode")).toBe("Operator (shared access)");
  });

  it("explains each refusal the card can meet", () => {
    expect(limitsRefusalMessage("stale_limits", "x")).toBe(
      "These limits were changed by someone else. Review the current values and save again.");
    expect(limitsRefusalMessage("writing_limit_below_one_reply", "x")).toContain("at least one reply");
    expect(limitsRefusalMessage("intent_key_reused", "x")).toBe("Your earlier attempt was saved. Here are the current values.");
    for (const code of ["daily_limit_required", "writing_limit_required", "invalid_cursor"]) {
      expect(limitsRefusalMessage(code, code)).not.toBe(code);
    }
    expect(limitsRefusalMessage(null, "Fallback sentence.")).toBe("Fallback sentence.");
  });
});
