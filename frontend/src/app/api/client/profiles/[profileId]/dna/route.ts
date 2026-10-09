// GET /api/client/profiles/{profileId}/dna -> GET /v1/profiles/{id}/dna (Cycle 5 P9.3; A02).
//
// One permitted profile's Business DNA. The backend re-checks permission on
// every read: a profile no longer permitted (or never) is 404, and the page
// falls back to the permitted choices. The id is a profile id or `account`;
// anything else is answered 404 here without calling the backend. Client
// credential; read only. Rehaul only: under M1 the backend answers 404.

import { clientToken } from "@/lib/client-session";
import { expiredLinkResponse, forwardProductError, getProfileDna } from "@/lib/product";

type Params = { params: Promise<{ profileId: string }> };

const PROFILE_ID = /^(account|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

export async function GET(_request: Request, { params }: Params) {
  const token = await clientToken();
  if (!token) return expiredLinkResponse();
  const { profileId } = await params;
  if (!PROFILE_ID.test(profileId)) {
    return Response.json({ error: "That profile isn't available.", detail: "profile_not_found" }, { status: 404 });
  }
  try {
    return Response.json(await getProfileDna(token, profileId), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return forwardProductError(error);
  }
}
