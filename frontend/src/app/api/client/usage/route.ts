// GET /api/client/usage -> GET /v1/usage (Cycle 5 P2.6; spec 10A.4).
//
// The client's Settings -> Usage view. The client is the session's own: the
// backend derives it from the credential, and nothing from this request (no
// query, no header, no body) is forwarded. The reply passes through unchanged:
// `{"engine": "m1"}` under M1, and under the rehaul engine fractions and reset
// times only, never dollars (the backend sends none, at any depth). A backend
// 503 (`usage_unavailable`) stays a 503, so the screen says the figures are
// unavailable instead of showing zeros.

import { clientToken } from "@/lib/client-session";
import { expiredLinkResponse, forwardProductError, getUsage } from "@/lib/product";

export async function GET() {
  const token = await clientToken();
  if (!token) return expiredLinkResponse();
  try {
    return Response.json(await getUsage(token), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return forwardProductError(error);
  }
}
