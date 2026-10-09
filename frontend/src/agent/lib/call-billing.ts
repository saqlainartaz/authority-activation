import "server-only";

/**
 * A failed call that was CERTAINLY not billed (Cycle 5, P4.3 fix round 1,
 * Ruling 63): the driver's own retries ended on a failure answered before any
 * generation (Ruling 16's list: 429, 529, 503 before generation, connection
 * refused or unresolved before send). The error itself is thrown unchanged and
 * only marked, so callers that test its provider type still can; the meter
 * then counts the call as never dispatched. A timeout or any failure after the
 * response began is never marked: its cost stays unknown.
 */
const CERTAINLY_UNBILLED = Symbol.for("agent.driver.certainly-unbilled");

export function markCertainlyUnbilled<T>(error: T): T {
  if (typeof error === "object" && error !== null) {
    Object.defineProperty(error, CERTAINLY_UNBILLED, { value: true, enumerable: false });
  }
  return error;
}

export function wasCertainlyUnbilled(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as Record<symbol, unknown>)[CERTAINLY_UNBILLED] === true;
}
