import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { KnowledgeRefresher, retryDelay } from "@/refined/knowledge-refresh";
import type { ServerDocument } from "@/refined/knowledge-view";

/**
 * Cycle 5 P2.7 fix round 1 (review I1 and M4; spec §7.2 "Failed retrieval of
 * status MUST appear unavailable/stale"): the Knowledge screen's rehaul-engine
 * refresh keeps going after a failed read, backs off, recovers, and reads
 * nothing while the tab is hidden.
 */

const doc = (tone: "working" | "ready" | "waiting", extra: Record<string, unknown> = {}): ServerDocument => ({
  id: `d-${tone}`, source_type: "a.txt", source_authority: "CLIENT", status: "uploaded", created_at: "2026-10-06T09:00:00Z",
  knowledge: { label: tone === "ready" ? "Available" : tone === "working" ? "Processing" : "Processing delayed", tone, ...extra },
});

function harness(answers: Array<ServerDocument[] | Error>) {
  const state = { hidden: false, loads: 0, loaded: 0, failed: 0 };
  const refresher = new KnowledgeRefresher({
    load: async () => {
      state.loads += 1;
      const answer = answers.shift() ?? [doc("working")];
      if (answer instanceof Error) throw answer;
      return answer;
    },
    onLoaded: () => { state.loaded += 1; },
    onFailed: () => { state.failed += 1; },
    hidden: () => state.hidden,
  });
  return { state, refresher };
}

describe("KnowledgeRefresher", () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-06T12:00:00Z")); });
  afterEach(() => { vi.useRealTimers(); });

  it("keeps updating after a failed read: the next success resumes the normal cadence", async () => {
    const { state, refresher } = harness([new Error("503"), [doc("working")], [doc("working")]]);
    refresher.schedule([doc("working")]);

    await vi.advanceTimersByTimeAsync(5_000);
    expect(state).toMatchObject({ loads: 1, failed: 1, loaded: 0 });

    await vi.advanceTimersByTimeAsync(5_000); // the first retry
    expect(state).toMatchObject({ loads: 2, failed: 1, loaded: 1 });

    await vi.advanceTimersByTimeAsync(5_000); // back on the 5 s cadence
    expect(state).toMatchObject({ loads: 3, loaded: 2 });
    refresher.stop();
  });

  it("backs off 5, 10, 20, 40 s, then every 60 s, and a success resets it", async () => {
    const failures = Array.from({ length: 6 }, () => new Error("down"));
    const { state, refresher } = harness([...failures, [doc("working")], new Error("again")]);
    refresher.schedule([doc("working")]);
    await vi.advanceTimersByTimeAsync(5_000);
    const waits = [5_000, 10_000, 20_000, 40_000, 60_000, 60_000];
    for (const [index, wait] of waits.entries()) {
      await vi.advanceTimersByTimeAsync(wait - 1);
      expect(state.loads).toBe(index + 1);
      await vi.advanceTimersByTimeAsync(1);
      expect(state.loads).toBe(index + 2);
    }
    // The seventh read succeeded; the next failure starts again at 5 s.
    expect(state.loaded).toBe(1);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(state.failed).toBe(7);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(state.loads).toBe(9);
    refresher.stop();
    expect([1, 2, 3, 4, 5, 9].map(retryDelay)).toEqual([5_000, 10_000, 20_000, 40_000, 60_000, 60_000]);
  });

  it("reads nothing while the tab is hidden, and reads at once when it is shown again", async () => {
    const { state, refresher } = harness([]);
    refresher.schedule([doc("working")]);
    state.hidden = true;
    refresher.visibilityChanged();

    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(state.loads).toBe(0);

    state.hidden = false;
    refresher.visibilityChanged();
    await vi.advanceTimersByTimeAsync(0);
    expect(state.loads).toBe(1);
    refresher.stop();
  });

  it("does not read when a timer falls due while hidden, until shown", async () => {
    const { state, refresher } = harness([]);
    refresher.schedule([doc("working")]);
    state.hidden = true; // hidden without the event having arrived yet
    await vi.advanceTimersByTimeAsync(5_000);
    expect(state.loads).toBe(0);
    state.hidden = false;
    refresher.visibilityChanged();
    await vi.advanceTimersByTimeAsync(0);
    expect(state.loads).toBe(1);
    refresher.stop();
  });

  it("sets no timer when every source is settled, and reads nothing on showing the tab", async () => {
    const { state, refresher } = harness([]);
    refresher.schedule([doc("ready")]);
    state.hidden = true; refresher.visibilityChanged();
    state.hidden = false; refresher.visibilityChanged();
    await vi.advanceTimersByTimeAsync(24 * 60 * 60_000);
    expect(state.loads).toBe(0);
  });

  it("re-reads a failed stage the engine may retry by itself on the normal cadence", async () => {
    const { state, refresher } = harness([]);
    refresher.schedule([doc("waiting", { recheck: true })]);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(state.loads).toBe(1);
    refresher.stop();
  });

  it("reads nothing after it is stopped", async () => {
    const { state, refresher } = harness([]);
    refresher.schedule([doc("working")]);
    refresher.stop();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(state.loads).toBe(0);
  });
});
