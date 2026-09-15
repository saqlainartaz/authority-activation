// GET /api/client/chat/sessions/[sessionId] -> GET /v1/chat/sessions/{session_id}
//
// `params` is asynchronous in Next 16. Keeping the token lookup in this route
// ensures neither the onboarding credential nor the service key joins the
// browser bundle.

import { clientToken } from "@/lib/client-session";
import {
  expiredLinkResponse,
  forwardProductError,
  readChatSession,
} from "@/lib/product";

type Params = { params: Promise<{ sessionId: string }> };

export async function GET(_request: Request, { params }: Params) {
  const token = await clientToken();
  if (!token) return expiredLinkResponse();
  const { sessionId } = await params;
  try {
    return Response.json(await readChatSession(token, sessionId));
  } catch (error) {
    return forwardProductError(error);
  }
}
