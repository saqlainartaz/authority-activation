import { clientToken } from "@/lib/client-session";
import { expiredLinkResponse, forwardProductError, setSocialAutoPublish } from "@/lib/product";

export async function PATCH(request: Request, context: { params: Promise<{ accountId: string }> }): Promise<Response> {
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
  let body: unknown;
  try { body = await request.json(); }
  catch { return Response.json({ error: "Invalid JSON." }, { status: 400 }); }
  if (typeof body !== "object" || body === null || Object.keys(body).length !== 1 || typeof (body as { enabled?: unknown }).enabled !== "boolean") {
    return Response.json({ error: "Expected an enabled boolean." }, { status: 400 });
  }
  try {
    const { accountId } = await context.params;
    return Response.json(await setSocialAutoPublish(token, accountId, (body as { enabled: boolean }).enabled), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return forwardProductError(error);
  }
}
