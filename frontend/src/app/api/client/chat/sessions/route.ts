// GET/POST /api/client/chat/sessions -> /v1/chat/sessions/active|/v1/chat/sessions
// The BFF owns both credentials. Browser requests never choose a tenant,
// campaign, content item, provider, platform, or artifact.

import { clientToken } from "@/lib/client-session";
import { activeChatSession, createChatSession, expiredLinkResponse, forwardProductError, readJsonObject } from "@/lib/product";
import type { ChatSessionCreate } from "@/lib/product";

const MESSAGE_MAX = 4_000;
const IDEMPOTENCY_MIN = 8;
const IDEMPOTENCY_MAX = 200;
const CREATE_KEYS = new Set(["message", "idempotency_key"]);

function invalidRequest(message: string): Response {
  return Response.json({ error: message }, { status: 422 });
}

export async function POST(request: Request) {
  const token = await clientToken();
  if (!token) return expiredLinkResponse();

  const raw = await readJsonObject(request);
  if (Object.keys(raw).some((key) => !CREATE_KEYS.has(key))) {
    return invalidRequest("A chat request can contain only message and idempotency_key.");
  }
  // ABSENT is legal (the agent bootstrap); PRESENT-BUT-NOT-A-STRING is not.
  // Collapsing these two into one `typeof` check is what rejected the
  // bootstrap, and it is also what would have let `null` through as a body.
  if (raw.message !== undefined && typeof raw.message !== "string") {
    return invalidRequest("message must be text when it is given.");
  }
  if (typeof raw.idempotency_key !== "string") {
    return invalidRequest("message and idempotency_key must be text.");
  }
  const message = raw.message === undefined ? undefined : raw.message.trim();
  const idempotency_key = raw.idempotency_key.trim();
  if (message !== undefined && (message.length === 0 || message.length > MESSAGE_MAX))
    return invalidRequest("message must be between 1 and 4000 characters.");
  if (idempotency_key.length < IDEMPOTENCY_MIN || idempotency_key.length > IDEMPOTENCY_MAX) return invalidRequest("idempotency_key must be between 8 and 200 characters.");
  const body: ChatSessionCreate = message === undefined ? { idempotency_key } : { message, idempotency_key };
  try {
    return Response.json(await createChatSession(token, body), { status: 201 });
  } catch (error) {
    return forwardProductError(error);
  }
}

export async function GET() {
  const token = await clientToken();
  if (!token) return expiredLinkResponse();
  try {
    return Response.json(await activeChatSession(token));
  } catch (error) {
    return forwardProductError(error);
  }
}
