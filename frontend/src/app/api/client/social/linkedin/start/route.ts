import { clientToken } from "@/lib/client-session";
import {
  expiredLinkResponse,
  forwardProductError,
  startLinkedInOAuth,
} from "@/lib/product";

// Initiated by an authenticated, same-origin client action. No browser-supplied
// redirect URI, scopes, tenant, or LinkedIn credentials are accepted here.
export async function POST(request: Request): Promise<Response> {
  const origin = request.headers.get("origin");
  if (origin) {
    try {
      if (new URL(origin).origin !== new URL(request.url).origin) {
        return Response.json({ error: "Origin not allowed." }, { status: 403 });
      }
    } catch {
      return Response.json({ error: "Origin not allowed." }, { status: 403 });
    }
  }

  const token = await clientToken();
  if (!token) return expiredLinkResponse();
  try {
    return Response.json(await startLinkedInOAuth(token), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return forwardProductError(error);
  }
}
