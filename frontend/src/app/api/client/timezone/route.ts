// PATCH /api/client/timezone -> PATCH /v1/clients/{session-derived-id}.

import { clientToken, resolveClientId } from "@/lib/client-session";
import { clientTimezone } from "@/lib/client-timezone";
import { EngineHttpError, forwardEngineError, updateClientTimezone } from "@/lib/engine";
import { expiredLinkResponse, forwardProductError, readJsonObject } from "@/lib/product";

const invalidTimezone = () => Response.json({ error: "timezone must be the only non-empty string field" }, { status: 422 });

// GET is DISPLAY ONLY. The picker shows the client which zone their chosen time
// will be read in; the instant itself is built by the schedule route from this
// same helper, so a failed or stale read here can cost a label and can never
// move a post.
export async function GET() {
  const token = await clientToken();
  if (!token) return expiredLinkResponse();
  try {
    return Response.json({ timezone: await clientTimezone(token) });
  } catch (error) {
    return error instanceof EngineHttpError ? forwardEngineError(error) : forwardProductError(error);
  }
}

export async function PATCH(request: Request) {
  const token = await clientToken();
  if (!token) return expiredLinkResponse();

  const body = await readJsonObject(request);
  if (Object.keys(body).length !== 1 || typeof body.timezone !== "string" || !body.timezone.trim()) {
    return invalidTimezone();
  }

  try {
    const clientId = await resolveClientId(token);
    const updated = await updateClientTimezone(clientId, body.timezone);
    return Response.json({ timezone: updated.timezone });
  } catch (error) {
    return error instanceof EngineHttpError ? forwardEngineError(error) : forwardProductError(error);
  }
}
