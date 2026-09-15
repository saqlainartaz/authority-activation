// GET /api/client/calendar -> GET /v1/calendar
//
// The calendar is computed from `schedule_slots` ALONE (SCHED-04) — the
// requirement is the ABSENCE of a second store, so nothing on the frontend may
// maintain one. This handler forwards the read and the client renders it; a
// cached or merged copy on this side would be exactly the second store the
// requirement forbids.

import { clientToken } from "@/lib/client-session";
import { calendar, expiredLinkResponse, forwardProductError } from "@/lib/product";

export async function GET() {
  const token = await clientToken();
  if (!token) return expiredLinkResponse();
  try {
    return Response.json(await calendar(token));
  } catch (e) {
    return forwardProductError(e);
  }
}
