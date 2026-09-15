import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Task 8 fix round, item 6. `schedule` used to pass the model's `when`
 * straight through as Python's `slot_at`, on the assumption that Python's
 * own `AwareDatetime` requirement was enough of a guardrail — but the
 * model-facing schema only ever promised "ISO-8601", which an ordinary NAIVE
 * datetime satisfies, and `instructions.md` gave the model nothing to
 * self-correct with. The fix removes the dependency instead of prompting
 * around it: the server resolves the client's own timezone (mirroring
 * `api/client/content-items/[id]/schedule/route.ts`) and the model reports a
 * local date and time only.
 *
 * `clientTimezone`/`scheduleContentItem` are mocked; this is a pure unit test
 * of the parsing/zone-resolution logic. `requireClientToken` is no longer
 * called by `schedule.ts` at all (final whole-branch review, C1) — the token
 * now arrives via `context.token`, supplied directly below, the same runtime
 * struct the route builds once per turn and threads through every tool.
 */
vi.mock("@/lib/client-timezone", () => ({
  clientTimezone: vi.fn(async () => "America/New_York"),
}));
vi.mock("@/lib/product", () => ({
  scheduleContentItem: vi.fn(async (_token: string, _id: string, body: { idempotency_key: string; slot_at: string }) => ({
    content_item_id: "item-1",
    content_version_id: "version-1",
    slot: { slot_id: "slot-1", slot_at: body.slot_at, slot_zone: "America/New_York", status: "scheduled", relaxation: "none" },
  })),
}));

import { clientTimezone } from "@/lib/client-timezone";
import { scheduleContentItem } from "@/lib/product";

import type { ToolContext } from "@/agent/lib/backend";
import { schedule } from "@/agent/tools/schedule";

// Unread by this tool — only submit-draft.ts reads skillVersions.
const context: ToolContext = { sessionId: "session-1", turnId: "turn-1", handles: new Map(), token: "token-abc", skillVersions: [] };

describe("schedule — resolves the client's timezone server-side", () => {
  beforeEach(() => {
    vi.mocked(clientTimezone).mockClear();
    vi.mocked(scheduleContentItem).mockClear();
  });

  it("accepts a local date and time with no offset, and builds an AWARE instant from the server's own timezone", async () => {
    const result = await schedule({ contentItemId: "item-1", when: "2026-08-20T09:00" }, context);

    expect(clientTimezone).toHaveBeenCalledWith("token-abc");
    expect(scheduleContentItem).toHaveBeenCalledTimes(1);
    const [, , body] = vi.mocked(scheduleContentItem).mock.calls[0];
    // An aware instant ends in Z (UTC) once built — never the naive string
    // the model supplied.
    expect(body.slot_at).not.toBe("2026-08-20T09:00");
    expect(body.slot_at.endsWith("Z")).toBe(true);
    expect(result.scheduledFor).toBe(body.slot_at);
  });

  it("rejects a value carrying a Z suffix — the model must never report a zone at all", async () => {
    await expect(schedule({ contentItemId: "item-1", when: "2026-08-20T09:00:00Z" }, context)).rejects.toThrow(
      /local date and time/,
    );
    expect(scheduleContentItem).not.toHaveBeenCalled();
  });

  it("rejects a value carrying a +/-offset", async () => {
    await expect(schedule({ contentItemId: "item-1", when: "2026-08-20T09:00-05:00" }, context)).rejects.toThrow(
      /local date and time/,
    );
    expect(scheduleContentItem).not.toHaveBeenCalled();
  });

  it("rejects a calendar date that does not exist, rather than silently rolling it over", async () => {
    // `Date.UTC` would otherwise roll 31 February into 3 March, scheduling a
    // real day the client never named.
    await expect(schedule({ contentItemId: "item-1", when: "2026-02-31T09:00" }, context)).rejects.toThrow();
    expect(scheduleContentItem).not.toHaveBeenCalled();
  });

  it("rejects a missing time component", async () => {
    await expect(schedule({ contentItemId: "item-1", when: "2026-08-20" }, context)).rejects.toThrow();
    expect(scheduleContentItem).not.toHaveBeenCalled();
  });
});
