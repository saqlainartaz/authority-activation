import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { HEALTH_REFRESH_MS, HealthRefresher } from "@/app/internal/system-health-refresh";

/**
 * Cycle 5 P3.3 (spec §10.1 "automatic refresh and manual Refresh"): System health
 * reads again every 30 s while the tab is visible, pauses while it is hidden, backs
 * off after a failure as the Knowledge screen does (P2.7), and Refresh reads now.
 */

function harness(answers: Array<string | Error> = []) {
  const state = { hidden: false, loads: 0, loaded: [] as string[], failed: 0, reading: [] as boolean[] };
  const refresher = new HealthRefresher<string>({
    load: async () => {
      state.loads += 1;
      const answer = answers.shift() ?? `read-${state.loads}`;
      if (answer instanceof Error) throw answer;
      return answer;
    },
    onLoaded: (data) => { state.loaded.push(data); },
    onFailed: () => { state.failed += 1; },
    onReading: (reading) => { state.reading.push(reading); },
    hidden: () => state.hidden,
  });
  return { state, refresher };
}

describe("HealthRefresher", () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-07T09:00:00Z")); });
  afterEach(() => { vi.useRealTimers(); });

  it("reads every 30 s while the tab is visible", async () => {
    const { state, refresher } = harness();
    await refresher.refresh();
    expect(state.loads).toBe(1);
    await vi.advanceTimersByTimeAsync(HEALTH_REFRESH_MS - 1);
    expect(state.loads).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(state.loads).toBe(2);
    await vi.advanceTimersByTimeAsync(HEALTH_REFRESH_MS);
    expect(state.loads).toBe(3);
    expect(HEALTH_REFRESH_MS).toBe(30_000);
    refresher.stop();
  });

  it("reads nothing while the tab is hidden, and reads as soon as it is visible again", async () => {
    const { state, refresher } = harness();
    await refresher.refresh();
    state.hidden = true;
    refresher.visibilityChanged();
    await vi.advanceTimersByTimeAsync(5 * HEALTH_REFRESH_MS);
    expect(state.loads).toBe(1);
    state.hidden = false;
    refresher.visibilityChanged();
    await vi.advanceTimersByTimeAsync(0);
    expect(state.loads).toBe(2);
    refresher.stop();
  });

  it("a timer that fires while hidden waits for the tab to be shown", async () => {
    const { state, refresher } = harness();
    await refresher.refresh();
    state.hidden = true; // hidden without a visibility event reaching the refresher yet
    await vi.advanceTimersByTimeAsync(HEALTH_REFRESH_MS);
    expect(state.loads).toBe(1);
    state.hidden = false;
    refresher.visibilityChanged();
    await vi.advanceTimersByTimeAsync(0);
    expect(state.loads).toBe(2);
    refresher.stop();
  });

  it("backs off after failures (5, 10, 20 s) and returns to 30 s after a success", async () => {
    const { state, refresher } = harness([new Error("503"), new Error("503"), new Error("503"), "ok"]);
    await refresher.refresh();
    expect(state.failed).toBe(1);
    for (const wait of [5_000, 10_000, 20_000]) {
      await vi.advanceTimersByTimeAsync(wait - 1);
      const before = state.loads;
      await vi.advanceTimersByTimeAsync(1);
      expect(state.loads).toBe(before + 1);
    }
    expect(state.loaded).toEqual(["ok"]);
    await vi.advanceTimersByTimeAsync(HEALTH_REFRESH_MS - 1);
    expect(state.loads).toBe(4);
    await vi.advanceTimersByTimeAsync(1);
    expect(state.loads).toBe(5);
    refresher.stop();
  });

  it("Refresh reads now, restarts the 30 s wait, and reports that a read is running", async () => {
    const { state, refresher } = harness();
    await refresher.refresh();
    await vi.advanceTimersByTimeAsync(20_000);
    await refresher.refresh();
    expect(state.loads).toBe(2);
    await vi.advanceTimersByTimeAsync(HEALTH_REFRESH_MS - 1);
    expect(state.loads).toBe(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(state.loads).toBe(3);
    expect(state.reading.slice(0, 2)).toEqual([true, false]);
    refresher.stop();
  });

  it("reads nothing after stop", async () => {
    const { state, refresher } = harness();
    await refresher.refresh();
    refresher.stop();
    await vi.advanceTimersByTimeAsync(10 * HEALTH_REFRESH_MS);
    await refresher.refresh();
    expect(state.loads).toBe(1);
  });
});
