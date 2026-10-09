import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { todayMessage } from "@/agent/lib/context-assembly";

/**
 * The agent could not resolve "next Friday" because nothing told it today's
 * date (first paid evaluation run, 2026-09-25). A c4 turn now carries today in
 * the client's own zone, as data.
 */
describe("today, in the client's zone", () => {
  // 23:30 UTC on Thursday 24 September 2026: already Friday in London? No --
  // London is UTC+1, so 00:30 Friday; New York is UTC-4, so 19:30 Thursday.
  const instant = new Date("2026-09-24T23:30:00Z");

  it("gives the client's own calendar date and weekday", () => {
    expect(todayMessage(instant, "Europe/London").content).toBe(
      '<today zone="Europe/London" date="2026-09-25" weekday="Friday" time="00:30"></today>',
    );
    expect(todayMessage(instant, "America/New_York").content).toBe(
      '<today zone="America/New_York" date="2026-09-24" weekday="Thursday" time="19:30"></today>',
    );
  });

  it("escapes the zone like any other value", () => {
    expect(todayMessage(instant, "UTC").content).not.toContain("<script");
  });
});

describe("the route tells a c4 turn today's date", () => {
  const route = fs.readFileSync(
    path.join(process.cwd(), "src/app/api/client/chat/sessions/[sessionId]/agent/route.ts"),
    "utf8",
  );

  it("under c4 only, from the client's configured zone", () => {
    expect(route).toMatch(/if \(profile\.contract === "c4"\) \{\s*try \{\s*turnContext\.push\(todayMessage\(new Date\(\), await clientTimezone\(token\)\)\);/);
  });
});
