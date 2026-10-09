// GET /api/client/questions/answers/{answerId} -> GET /v1/questions/answers/{id}
// (Cycle 5 P6.6; spec 5.1).
//
// One answer's application state and its "what changed" sentence, built from
// committed effects only (P6.3). The client is the session's own.

import { clientToken } from "@/lib/client-session";
import { expiredLinkResponse, forwardProductError, getClientAnswer } from "@/lib/product";

type Params = { params: Promise<{ answerId: string }> };

export async function GET(_request: Request, { params }: Params) {
  const token = await clientToken();
  if (!token) return expiredLinkResponse();
  const { answerId } = await params;
  try {
    return Response.json(await getClientAnswer(token, answerId), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return forwardProductError(error);
  }
}
