// GET /api/client/content-items/[id]/reject-options -> GET .../reject-options
//
// The reject sheet's own definition of itself. `taps`, `ban_available` and
// `claims` all come from here rather than being hardcoded on the client, so the
// sheet's order and membership have ONE definition (D7A-06). `claims` carries
// `claim_id`, which is the handle `RejectIn.claim_id` takes — the ban is keyed on
// an opaque id and offsets never enter the request, which is what degrades
// RISK-10 from a correctness bug to a cosmetic one.

import { clientToken } from "@/lib/client-session";
import {
  expiredLinkResponse,
  forwardProductError,
  rejectOptions,
} from "@/lib/product";

type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Params) {
  const token = await clientToken();
  if (!token) return expiredLinkResponse();
  const { id } = await params;
  try {
    return Response.json(await rejectOptions(token, id));
  } catch (e) {
    return forwardProductError(e);
  }
}
