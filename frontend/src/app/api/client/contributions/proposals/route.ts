// GET /api/client/contributions/proposals -> GET /v1/contributions/proposals (Cycle 5 P6.8; review I-4).
//
// The guidance lines proposed by the client's messages and answered questions
// that are not yet in their guidance, for "Add to my guidance". Nothing is
// forwarded but the session's own credential. Rehaul only (404 under M1).

import { clientToken } from "@/lib/client-session";
import { expiredLinkResponse, forwardProductError, getGuidanceProposals } from "@/lib/product";

export async function GET() {
  const token = await clientToken();
  if (!token) return expiredLinkResponse();
  try {
    return Response.json(await getGuidanceProposals(token), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return forwardProductError(error);
  }
}
