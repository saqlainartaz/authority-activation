// GET /api/client/awaiting-review -> GET /v1/content-items/awaiting-review
//
// WHY THIS IS A TOP-LEVEL PATH AND NOT `/api/client/content-items/awaiting-review`.
// The sibling `content-items/[id]/...` tree carries a DYNAMIC segment, and Next
// would happily match the literal `awaiting-review` as an `[id]` for any nested
// route beneath it. Giving this read its own top-level path means the literal can
// never be captured as an id — the backend has the same shape one level down
// (`schedule.py:599` declares the full path itself for the same reason) and this
// side does not have to rely on a resolution-order rule to stay correct.
//
// HELD VERSIONS ARE EXCLUDED FROM THIS LIST BY DESIGN (DIS6-04). A held draft is a
// real, fully provenanced version this API will not serve to a client, and it
// reaches the operator queue in `/internal` instead (D7A-08).

import { clientToken } from "@/lib/client-session";
import {
  awaitingReviewWithBodies,
  expiredLinkResponse,
  forwardProductError,
} from "@/lib/product";

export async function GET() {
  const token = await clientToken();
  if (!token) return expiredLinkResponse();
  try {
    return Response.json(await awaitingReviewWithBodies(token));
  } catch (e) {
    return forwardProductError(e);
  }
}
