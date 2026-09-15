// POST /api/client/content-items/[id]/reject -> POST .../reject
//
// The constraint loop. One transaction writes the rejection and, on the
// `never_say_this_again` tap, the constraint. This handler forwards the
// result as the 200 it is.
//
// NO LONGER ALSO A REGENERATION LOOP (D-B, 2026-08-25). This comment used to
// describe a SECOND arm on the answer, `regeneration.status ===
// "enqueue_failed"`, as a first-class non-error case worth a tap of
// "generate again" — that field is gone from `RejectedOut` on the Python
// side and from `Rejected` here (`lib/product.ts`). Reject records and
// stops; a new draft is a chat action now, not something this endpoint
// starts.

import { clientToken } from "@/lib/client-session";
import type { RejectIn } from "@/lib/product";
import {
  expiredLinkResponse,
  forwardProductError,
  readJsonObject,
  reject,
} from "@/lib/product";

type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Params) {
  const token = await clientToken();
  if (!token) return expiredLinkResponse();
  const { id } = await params;
  const raw = await readJsonObject(request);

  // ALLOWLIST: idempotency_key, tap, note, claim_id, steer_topic_key. Exactly
  // `RejectIn`'s five fields. A model validator refuses `claim_id` on any tap
  // other than `never_say_this_again` AND refuses its absence on that one, so
  // both directions are the API's 422 rather than this layer's guess.
  const body = {
    idempotency_key: raw.idempotency_key,
    tap: raw.tap,
    note: raw.note,
    claim_id: raw.claim_id,
    steer_topic_key: raw.steer_topic_key,
  } as RejectIn;

  try {
    return Response.json(await reject(token, id, body));
  } catch (e) {
    return forwardProductError(e);
  }
}
