// One intent key per operator action (Cycle 5 plan §3.2; P2.5). Client-safe and
// React-free, so the full-path retry test drives exactly what the panel runs.
//
// - The key is minted when the operator confirms the action (lazily, on the
//   first attempt), never at mount.
// - Every retry of that action reuses it until a DEFINITIVE answer arrives: a
//   2xx, or a 4xx. A network failure, a timeout or a 5xx is not definitive: the
//   first attempt may have committed, and only the same key lets the backend
//   answer the retry as a replay instead of doing the action twice.
// - After a definitive answer the next action gets a new key.
//
// The BFF forwards the key unchanged and never makes one up; the backend stores
// it with a hash of the action's contents.

export type FailureLike = { status?: number };

/** True when an error is a definitive answer from the server (a 4xx). A thrown
 *  error with no status (the network), a 408 or a 5xx may hide a committed
 *  first attempt, so it is not. */
export function isDefinitiveFailure(error: unknown): boolean {
  const status = (error as FailureLike | null)?.status;
  if (typeof status !== "number") return false;
  return status >= 400 && status < 500 && status !== 408;
}

export class IntentKeyHolder {
  private held: string | null = null;

  constructor(private readonly mint: () => string = () => crypto.randomUUID()) {}

  /** The current action's key: minted on first use, then the same until settled. */
  current(): string {
    if (this.held === null) this.held = this.mint();
    return this.held;
  }

  /** Called after every attempt. Only a definitive answer ends the action. */
  settle(definitive: boolean): void {
    if (definitive) this.held = null;
  }
}

/** Runs one attempt of the holder's action with its key, and settles the key by
 *  what came back. Rethrows the failure for the caller to show. */
export async function withIntentKey<T>(holder: IntentKeyHolder, send: (intentKey: string) => Promise<T>): Promise<T> {
  const intentKey = holder.current();
  try {
    const result = await send(intentKey);
    holder.settle(true);
    return result;
  } catch (error) {
    holder.settle(isDefinitiveFailure(error));
    throw error;
  }
}
