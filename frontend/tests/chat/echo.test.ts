import { describe, expect, it } from "vitest";

import { dedupeEcho, isSessionReadReady, needsSessionRead } from "@/components/compose/useChatSession";
import type { ChatMessage } from "@/lib/product";

function task(body: string): ChatMessage {
  return { id: crypto.randomUUID(), role: "user", kind: "task", body };
}

function assistant(body: string): ChatMessage {
  return { id: crypto.randomUUID(), role: "assistant", kind: "agent", body };
}

describe("dedupeEcho", () => {
  it("drops an echo entry once its persisted counterpart lands", () => {
    // The transient double-render window `useChatSession`'s own comment
    // describes: `refresh()` resolves before the queue head is dropped, so
    // for one paint both the persisted row and the echo entry are present.
    // `sinceTaskCount` defaults to 0 -- this turn's own row, at index 0.
    expect(dedupeEcho(["write about the launch"], [task("write about the launch")])).toEqual([]);
  });

  it("leaves echo alone when nothing has persisted yet", () => {
    expect(dedupeEcho(["write about the launch"], [])).toEqual(["write about the launch"]);
  });

  it("does not collapse a legitimate repeat send within one turn's dedupe window (Important 2)", () => {
    // A client can send "ok", let it persist, then send "ok" again -- and,
    // within the SAME send-time mark (both still count as "this turn's"
    // rows because neither is before the mark), only one echo may be
    // consumed by the one persisted row.
    expect(dedupeEcho(["ok"], [task("ok")])).toEqual([]);
    expect(dedupeEcho(["ok", "ok"], [task("ok")])).toEqual(["ok"]);
  });

  it("matches by count, oldest first, when several copies are queued at once", () => {
    // Two "ok"s queued together (the client typed and sent twice before
    // either turn resolved) against one persisted row: exactly one is
    // consumed, the other -- still genuinely unrecorded -- survives.
    expect(dedupeEcho(["ok", "ok", "ok"], [task("ok"), task("ok")])).toEqual(["ok"]);
  });

  it("never matches against an assistant row, only a persisted task row", () => {
    // `kind: "task"` is the wire kind a client turn is persisted as
    // (`src/agent/transcript.ts`). An assistant row with coincidentally
    // identical text must not consume an unrelated client echo.
    expect(dedupeEcho(["ok"], [assistant("ok")])).toEqual(["ok"]);
  });

  it("matches on the trimmed body, not the exact string", () => {
    expect(dedupeEcho(["  write it  "], [task("write it")])).toEqual([]);
  });

  // FIX (whole-branch review, Important 3). Text alone cannot tell turn 1's
  // persisted row from turn 2's -- these two cases cover both readings of
  // the SAME inputs `dedupeEcho(["ok"], [task("ok")])` explicitly: right
  // when the persisted row is this turn's own (mark at index 0, the
  // pre-fix default), wrong -- and now fixed -- when it is turn 1's
  // leftover (mark past it, at index 1).

  it("consumes the echo when the persisted row IS this turn's own (mark before it)", () => {
    // sinceTaskCount 0: the one persisted "ok" is at index 0, at or after
    // the mark, so it is eligible and correctly consumes the echo.
    expect(dedupeEcho(["ok"], [task("ok")], 0)).toEqual([]);
  });

  it("a verbatim repeat's NEW echo survives when the only persisted match is an EARLIER turn's (Important 3)", () => {
    // The regression itself: turn 1 already persisted "ok" (index 0). Turn
    // 2 sends "ok" again, and `useChatSession` marks the send at
    // sinceTaskCount 1 (one task row already existed). The persisted "ok"
    // is BEFORE the mark, so it is turn 1's and must not consume turn 2's
    // echo -- which must render, not vanish for the whole turn.
    expect(dedupeEcho(["ok"], [task("ok")], 1)).toEqual(["ok"]);
  });

  it("only rows at or after the mark are eligible, even with several turns' history", () => {
    // Three persisted "ok"s (turns 1-3) and a mark of 2: only the row at
    // index 2 (turn 3's) is eligible. A fourth "ok" sent now consumes that
    // one row and stops -- it must not reach back into turns 1-2's rows.
    expect(dedupeEcho(["ok", "ok"], [task("ok"), task("ok"), task("ok")], 2)).toEqual(["ok"]);
  });
});

describe("session read lifecycle", () => {
  it("does not refetch an envelope already held under the authoritative key", () => {
    expect(needsSessionRead("session-1", "session-1")).toBe(false);
    expect(needsSessionRead(null, "active")).toBe(true);
    expect(needsSessionRead("session-1", "session-2")).toBe(true);
  });

  it("does not allow a send until the initial active-session read settles", () => {
    expect(isSessionReadReady(null, "active", false)).toBe(false);
    expect(isSessionReadReady("active", "active", false)).toBe(true);
    expect(isSessionReadReady("session-1", "session-1", false)).toBe(true);
    expect(isSessionReadReady("session-1", "session-2", false)).toBe(false);
  });

  it("keeps the composer closed after a failed restore", () => {
    expect(isSessionReadReady("active", "active", true)).toBe(false);
  });
});
