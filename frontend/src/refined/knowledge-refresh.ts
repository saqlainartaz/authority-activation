// When the Knowledge screen reads a rehaul-engine list again (Cycle 5 P2.7, fix
// round 1). No React: the screen wires it to its state, and tests drive it with
// fake timers.
//
// - After a successful read, the next one follows `knowledgeRefreshDelay`.
// - A failed read is retried with a bounded back-off (5 s, 10 s, 20 s, 40 s, then
//   every 60 s); a success resets it. The screen marks the list stale meanwhile
//   (spec §7.2: "Failed retrieval of status MUST appear unavailable/stale").
// - Nothing is read while the tab is hidden. A read that fell due then happens as
//   soon as the tab is visible again.

import { knowledgeRefreshDelay, type ServerDocument } from './knowledge-view';

export const RETRY_FIRST_MS = 5_000;
export const RETRY_MAX_MS = 60_000;

/** The wait before retry number `failures` (1-based). */
export function retryDelay(failures: number): number {
  return Math.min(RETRY_MAX_MS, RETRY_FIRST_MS * 2 ** Math.max(0, failures - 1));
}

export type KnowledgeRefreshDeps = {
  load: () => Promise<ServerDocument[]>;
  onLoaded: (documents: ServerDocument[]) => void;
  onFailed: () => void;
  hidden: () => boolean;
  now?: () => number;
  setTimer?: (run: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
};

export class KnowledgeRefresher {
  private timer: unknown = null;
  private failures = 0;
  private due = false;
  private reading = false;
  private stopped = false;

  constructor(private readonly deps: KnowledgeRefreshDeps) {}

  private now() { return (this.deps.now ?? Date.now)(); }

  private clear() {
    if (this.timer !== null) (this.deps.clearTimer ?? ((handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>)))(this.timer);
    this.timer = null;
  }

  private plan(delay: number | null) {
    this.clear();
    if (delay === null || this.stopped) return;
    this.timer = (this.deps.setTimer ?? ((run: () => void, ms: number) => setTimeout(run, ms)))(() => this.fire(), delay);
  }

  private fire() {
    this.timer = null;
    if (this.deps.hidden()) { this.due = true; return; }
    void this.refresh();
  }

  /** The list on screen changed (a read, an upload): plan the next read from it.
   *  While a failed read is being retried, the retry keeps its own timer. */
  schedule(documents: ServerDocument[]) {
    if (this.failures > 0 || this.reading) return;
    this.due = false;
    this.plan(knowledgeRefreshDelay(documents, this.now()));
  }

  /** Read now (also the stale note's Retry). */
  async refresh(): Promise<void> {
    if (this.reading || this.stopped) return;
    this.reading = true;
    this.clear();
    this.due = false;
    try {
      const documents = await this.deps.load();
      if (this.stopped) return;
      this.failures = 0;
      this.reading = false;
      this.deps.onLoaded(documents);
      this.plan(knowledgeRefreshDelay(documents, this.now()));
    } catch {
      if (this.stopped) return;
      this.failures += 1;
      this.reading = false;
      this.deps.onFailed();
      this.plan(retryDelay(this.failures));
    } finally {
      this.reading = false;
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
