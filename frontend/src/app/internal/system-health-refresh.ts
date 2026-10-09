// When the System health page reads `GET /api/internal/ops/health` again (Cycle 5
// P3.3; spec §10.1 "automatic refresh and manual Refresh"). No React: the page
// wires it to its state, and tests drive it with fake timers. The same pattern as
// the Knowledge screen's refresher (P2.7, `refined/knowledge-refresh.ts`):
//
// - After a successful read, the next one is due in 30 s.
// - A failed read is retried with the same bounded back-off (5 s, 10 s, 20 s, 40 s,
//   then every 60 s); a success resets it. The page keeps the last good data and
//   marks it stale meanwhile.
// - Nothing is read while the tab is hidden. A read that fell due then happens as
//   soon as the tab is visible again.

import { retryDelay } from "@/refined/knowledge-refresh";

export const HEALTH_REFRESH_MS = 30_000;

export type HealthRefreshDeps<T> = {
  load: () => Promise<T>;
  onLoaded: (data: T) => void;
  onFailed: (error: unknown) => void;
  /** A read started or finished, for the Refresh button. */
  onReading?: (reading: boolean) => void;
  hidden: () => boolean;
  setTimer?: (run: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
};

export class HealthRefresher<T> {
  private timer: unknown = null;
  private failures = 0;
  private due = false;
  private reading = false;
  private stopped = false;

  constructor(private readonly deps: HealthRefreshDeps<T>) {}

  private clear() {
    if (this.timer !== null) (this.deps.clearTimer ?? ((handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>)))(this.timer);
    this.timer = null;
  }

  private plan(delay: number) {
    this.clear();
    if (this.stopped) return;
    this.timer = (this.deps.setTimer ?? ((run: () => void, ms: number) => setTimeout(run, ms)))(() => this.fire(), delay);
  }

  private fire() {
    this.timer = null;
    if (this.deps.hidden()) { this.due = true; return; }
    void this.refresh();
  }

  private setReading(reading: boolean) {
    this.reading = reading;
    this.deps.onReading?.(reading);
  }

  /** Read now: the first read, the timer's, and the manual Refresh button's. */
  async refresh(): Promise<void> {
    if (this.reading || this.stopped) return;
    this.clear();
    this.due = false;
    this.setReading(true);
    try {
      const data = await this.deps.load();
      if (this.stopped) return;
      this.failures = 0;
      this.setReading(false);
      this.deps.onLoaded(data);
      this.plan(HEALTH_REFRESH_MS);
    } catch (error) {
      if (this.stopped) return;
      this.failures += 1;
      this.setReading(false);
      this.deps.onFailed(error);
      this.plan(retryDelay(this.failures));
    }
  }

  /** The tab was hidden or shown. */
  visibilityChanged() {
    if (this.deps.hidden()) {
      if (this.timer !== null) { this.clear(); this.due = true; }
      return;
    }
    if (this.due) void this.refresh();
  }

  stop() {
    this.stopped = true;
    this.clear();
  }
}
