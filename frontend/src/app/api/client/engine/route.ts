// GET /api/client/engine -> which engine serves this client (Cycle 5 P2.6, A47).
//
// The value `GET /v1/me` publishes (`knowledge_engine`, from the backend's one
// switch), read with the session's own credential. The client app reads it once
// when it loads, so a screen with engine-specific content (Settings -> Usage)
// can decide before fetching anything, and under M1 show only what it always
// showed. Nothing else from `/v1/me` (no client or user id) reaches the browser,
// except `signed_in` (Cycle 5 P8.3): whether this credential is a signed-in
// session, so the Knowledge screen offers Delete file to a signed-in member only.

import { clientToken } from "@/lib/client-session";
import { expiredLinkResponse, forwardProductError, getMe, usesKnowledgeEngine } from "@/lib/product";

export async function GET() {
  const token = await clientToken();
  if (!token) return expiredLinkResponse();
  try {
    const me = await getMe(token);
    return Response.json(
      { knowledge_engine: usesKnowledgeEngine(me) ? "ke" : "m1", signed_in: me.signed_in === true },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return forwardProductError(error);
  }
}
