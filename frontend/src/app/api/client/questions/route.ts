// GET /api/client/questions?surface=questions|onboarding|source:{id} -> GET /v1/questions
// (Cycle 5 P6.6; spec 5.1).
//
// The open questions one surface shows, from the question store. The client is
// the session's own; only the surface is forwarded, and only one of the three
// shapes the backend takes. Rehaul only: under M1 the backend answers 404.

import { clientToken } from "@/lib/client-session";
import { expiredLinkResponse, forwardProductError, getClientQuestions } from "@/lib/product";

const SURFACE = /^(questions|onboarding|source:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

export async function GET(request: Request) {
  const token = await clientToken();
  if (!token) return expiredLinkResponse();
  const surface = new URL(request.url).searchParams.get("surface") ?? "";
  if (!SURFACE.test(surface)) {
    return Response.json({ error: "Those questions cannot be listed.", detail: "invalid_surface" }, { status: 400 });
  }
  try {
    return Response.json(await getClientQuestions(token, surface), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return forwardProductError(error);
  }
}
