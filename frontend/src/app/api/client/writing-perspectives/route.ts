// GET /api/client/writing-perspectives -> GET /v1/clients/me/writing-perspectives
// (Cycle 5 P5.3, Ruling 68).
//
// Who the client may write as, for the voice card's picker: the permitted
// authors and brands, each `{ref, label}`. General is always available and is
// not listed. Client-credential passthrough: nothing from this request is
// forwarded, and the backend derives the client from the session's own token.

import { clientToken } from "@/lib/client-session";
import { expiredLinkResponse, forwardProductError, getWritingPerspectives } from "@/lib/product";

export async function GET() {
  const token = await clientToken();
  if (!token) return expiredLinkResponse();
  try {
    return Response.json(await getWritingPerspectives(token), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return forwardProductError(error);
  }
}
