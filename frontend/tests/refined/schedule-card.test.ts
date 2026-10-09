import { describe, expect, it } from "vitest";

import type { ScheduleProposal } from "@/lib/product";
import { buildConversationMessages } from "@/refined/conversation";
import { scheduleCardView } from "@/refined/schedule-card-view";

/**
 * The schedule card, as the operator designed it (2026-09-24): the card STATES
 * the plan with the exact post and Confirm; no picker unless the client asks
 * to change the time; after Confirm the same card is the receipt.
 */

const PENDING: ScheduleProposal = {
  id: "p1",
  kind: "schedule",
  status: "pending",
  slot_at: "2026-10-03T08:00:00+00:00",
  slot_zone: "Europe/London",
  goes_out: "Saturday 3 October 2026, 09:00 (Europe/London)",
  when_local: "2026-10-03T09:00",
  proposed_goes_out: "Saturday 3 October 2026, 09:00 (Europe/London)",
  preview: "Membership costs 49 a month.",
  expires_at: "2026-10-03T08:00:00+00:00",
  delivery: { channel: "linkedin", mode: "automatic", line: "LinkedIn: goes out automatically" },
};

const POST_NOW: ScheduleProposal = { ...PENDING, id: "n1", kind: "post_now" };

describe("the schedule card", () => {
  it("states the plan and the exact post, with Confirm first", () => {
    const view = scheduleCardView(PENDING);

    expect(view.title).toBe("Goes out Saturday 3 October 2026, 09:00 (Europe/London)");
    expect(view.preview).toBe("Membership costs 49 a month.");
    expect(view.actions).toEqual(["confirm", "change", "dismiss"]);
  });

  it("becomes the receipt once confirmed, with nothing left to click", () => {
    const view = scheduleCardView({ ...PENDING, status: "confirmed" });

    expect(view.title).toBe("✓ Scheduled for Saturday 3 October 2026, 09:00 (Europe/London)");
    expect(view.actions).toEqual([]);
  });

  it("says plainly when a card no longer acts, and offers nothing", () => {
    expect(scheduleCardView({ ...PENDING, status: "declined" }).note).toMatch(/Nothing was scheduled/);
    expect(scheduleCardView({ ...PENDING, status: "expired" }).note).toMatch(/expired/);
    expect(scheduleCardView({ ...PENDING, status: "superseded" }).note).toMatch(/Replaced by a newer time/);
    for (const status of ["declined", "expired", "superseded"] as const) {
      expect(scheduleCardView({ ...PENDING, status }).actions).toEqual([]);
    }
  });

  // REPLACES "claims nothing about channels, which need main's publishing
  // code". Its exit condition was main's publishing code arriving, and it did
  // (C4 merged main, 2026-09-25). The property it guarded -- the card shows
  // only what is true -- now reads: the line is the SERVER's, verbatim, and a
  // card that no longer acts claims nothing about delivery.
  it("shows the server's delivery line, verbatim, and only while it is true", () => {
    expect(scheduleCardView(PENDING).delivery).toBe("LinkedIn: goes out automatically");
    const manual = { ...PENDING, delivery: { channel: "instagram", mode: "manual", line: "Instagram: you post this one" } } as const;
    expect(scheduleCardView(manual).delivery).toBe("Instagram: you post this one");
    expect(scheduleCardView({ ...PENDING, status: "confirmed" }).delivery).toBe("LinkedIn: goes out automatically");
    for (const status of ["declined", "expired", "superseded"] as const) {
      expect(scheduleCardView({ ...PENDING, status }).delivery).toBeNull();
    }
  });
});

describe("the post-now card", () => {
  it("states the plan and the post, with Confirm and no time to change", () => {
    const view = scheduleCardView(POST_NOW);

    expect(view.eyebrow).toBe("Post this now");
    expect(view.title).toBe("Goes out as soon as you confirm");
    expect(view.preview).toBe("Membership costs 49 a month.");
    expect(view.actions).toEqual(["confirm", "dismiss"]);
    expect(view.busyLabel).toBe("Posting…");
  });

  it("says what happened, and never that it scheduled", () => {
    expect(scheduleCardView({ ...POST_NOW, status: "confirmed" }).title).toBe("✓ Sent for publishing");
    expect(scheduleCardView({ ...POST_NOW, status: "declined" }).note).toBe("Dismissed. Nothing was published.");
    expect(JSON.stringify(scheduleCardView({ ...POST_NOW, status: "expired" }))).not.toMatch(/schedul/i);
  });
});

describe("where cards sit in the stream", () => {
  const ws = (proposals: ScheduleProposal[]) =>
    ({
      thread: [
        { who: "u", text: "schedule it for saturday" },
        { who: "a", text: "Here is the card.", text2: "", strong: "" },
      ],
      showDraft: false,
      proposals: { proposals },
    }) as never;

  it("adds one stream message per live card, after the conversation", () => {
    const messages = buildConversationMessages(ws([PENDING]), false);

    expect(messages.at(-1)?.id).toBe("proposal:p1");
  });

  it("hides a card a newer one replaced", () => {
    const messages = buildConversationMessages(
      ws([{ ...PENDING, id: "p2" }, { ...PENDING, status: "superseded" }]),
      false,
    );

    expect(messages.map((message) => message.id)).toContain("proposal:p2");
    expect(messages.map((message) => message.id)).not.toContain("proposal:p1");
  });
});
