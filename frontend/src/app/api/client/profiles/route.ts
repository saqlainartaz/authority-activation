// GET /api/client/profiles -> GET /v1/profiles (Cycle 5 P9.3, spec 3.1; Ruling 88).
//
// The profiles this member may open in Business DNA: what the backend's
// `visible_profiles` permits, or the one account default (`"id": "account"`)
// when it permits none. Client-credential passthrough: nothing from the
// browser is forwarded, and the backend derives the client and member from the
// session's own token. Rehaul only: under M1 the backend answers 404.

import { clientToken } from "@/lib/client-session";
import { expiredLinkResponse, forwardProductError, getProfiles } from "@/lib/product";

export async function GET() {
  const token = await clientToken();
  if (!token) return expiredLinkResponse();
  try {
    return Response.json(await getProfiles(token), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return forwardProductError(error);
  }
}
