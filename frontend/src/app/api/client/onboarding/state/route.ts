// GET /api/client/onboarding/state -> GET /v1/onboarding/state (Cycle 5 P6.5; spec 4.2).
//
// Where the client's onboarding stands on the new engine: `preparing`,
// `generating`, `failed`, `ready` or `complete` (D01), with the packet's question
// count and how many are still open. The client is the session's own. Rehaul
// only: under M1 the backend answers 404 and the M1 questionnaire is used.

import { clientToken } from "@/lib/client-session";
import { expiredLinkResponse, forwardProductError, getOnboardingState } from "@/lib/product";

export async function GET() {
  const token = await clientToken();
  if (!token) return expiredLinkResponse();
  try {
    return Response.json(await getOnboardingState(token), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return forwardProductError(error);
  }
}
