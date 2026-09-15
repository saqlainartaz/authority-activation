// POST /api/client/schedule-slots/[slotId]/reschedule -> POST .../reschedule
//
// A slot may not move outside its campaign's range (DIS6-06); that refusal is a
// 422 and IC-8.3 renders it as an inline form refusal under the field rather than
// as a snap-back animation. Forwarded verbatim — the server's sentence names the
// range, and a friendlier replacement written here would drop the numbers the
// client needs.

import { clientToken } from "@/lib/client-session";
import type { RescheduleIn } from "@/lib/product";
import {
  expiredLinkResponse,
  forwardProductError,
  readJsonObject,
  reschedule,
} from "@/lib/product";

type Params = { params: Promise<{ slotId: string }> };

export async function POST(request: Request, { params }: Params) {
  const token = await clientToken();
  if (!token) return expiredLinkResponse();
  const { slotId } = await params;
  const raw = await readJsonObject(request);

  // ALLOWLIST: idempotency_key, slot_at. `slot_at` must be an AWARE ISO
  // timestamp — `AwareDatetime` on the Python side, so a naive
  // `"2026-08-20T09:00"` from a `datetime-local` input is a 422. The conversion
  // belongs to the picker that produced it, not here: this layer cannot know
  // which timezone the client meant, and guessing one would silently move the
  // post.
  const body = {
    idempotency_key: raw.idempotency_key,
    slot_at: raw.slot_at,
  } as RescheduleIn;

  try {
    return Response.json(await reschedule(token, slotId, body));
  } catch (e) {
    return forwardProductError(e);
  }
}
