import { describe, expect, it } from "vitest";

import { instantInZone, wallClockInZone } from "@/lib/zoned-instant";

describe("zoned scheduling instants", () => {
  it("converts an ordinary summer wall-clock time using the named zone", () => {
    expect(instantInZone("2026-06-01", "09:00", "Europe/London"))
      .toBe("2026-06-01T08:00:00.000Z");
  });

  it("normalizes a nonexistent spring-forward time to the next valid local time", () => {
    const instant = instantInZone("2026-03-29", "01:30", "Europe/London");
    expect(instant).toBe("2026-03-29T01:30:00.000Z");
    expect(wallClockInZone(new Date(instant), "Europe/London"))
      .toEqual({ date: "2026-03-29", time: "02:30" });
  });

  it("chooses the later occurrence of an ambiguous fall-back time", () => {
    expect(instantInZone("2026-10-25", "01:30", "Europe/London"))
      .toBe("2026-10-25T01:30:00.000Z");
  });
});
