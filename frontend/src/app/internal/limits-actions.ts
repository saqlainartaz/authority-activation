// One Limits mutation, end to end from the browser (Cycle 5 P2.5): the same-origin
// BFF call and what the operator is told. React-free so the full-path tests run
// exactly this.
//
// A limits edit (PUT) is a plain request: `expected_revision` keeps it from
// overwriting a newer edit, so a save whose answer was lost and is sent again is
// refused as `stale_limits` and the form re-reads the values. Extra uploads carry
// one intent key per operator action, reused until a definitive answer, so a +10
// sent twice adds ten once. (The frozen "Send again / Check what was saved" form
// and the edit replay were removed as over-engineered, 2026-10-08.)

import { IntentKeyHolder, isDefinitiveFailure, withIntentKey } from "@/lib/intent-key";
import { limitsRefusalMessage, RETRY_MESSAGE, type ClientLimits } from "@/lib/limits";
import { failureCode, type InternalApi } from "./internal-api";

export type LimitsOutcome =
  /** Saved, or answered again as a replay of an extra-uploads grant whose answer was lost. */
  | { kind: "saved"; limits: ClientLimits; replayed: boolean }
  /** No definitive answer: it may or may not have been saved. */
  | { kind: "retry"; message: string }
  /** A definitive refusal (4xx), with the backend's code when it gave one. */
  | { kind: "refused"; code: string | null; message: string };

/** Send one limits request. With a `holder` the body carries its intent key
 *  (extra uploads); without one it is sent as it is (the PUT edit). */
export async function sendLimitsAction(
  api: InternalApi,
  holder: IntentKeyHolder | null,
  path: string,
  method: "PUT" | "POST",
  body: Record<string, unknown>,
): Promise<LimitsOutcome> {
  const request = (payload: Record<string, unknown>) => api<ClientLimits>(path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  try {
    const limits = holder
      ? await withIntentKey(holder, (intentKey) => request({ ...body, intent_key: intentKey }))
      : await request(body);
    return { kind: "saved", limits, replayed: limits.replayed === true };
  } catch (error) {
    if (!isDefinitiveFailure(error)) return { kind: "retry", message: RETRY_MESSAGE };
    const code = failureCode(error);
    const fallback = error instanceof Error ? error.message : "That did not work.";
    return { kind: "refused", code, message: limitsRefusalMessage(code, fallback) };
  }
}
