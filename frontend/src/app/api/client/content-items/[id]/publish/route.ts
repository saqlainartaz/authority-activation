import { clientToken } from "@/lib/client-session";
import {
  expiredLinkResponse,
  forwardProductError,
  publishContentItemNow,
  readJsonObject,
} from "@/lib/product";

type Params = { params: Promise<{ id: string }> };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request: Request, { params }: Params): Promise<Response> {
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
  const { id } = await params;
  if (!UUID.test(id)) return Response.json({ error: "Content item not found." }, { status: 404 });
  const body = await readJsonObject(request);
  const key = body.idempotency_key;
  if (Object.keys(body).some((field) => field !== "idempotency_key") ||
      typeof key !== "string" || key.length < 8 || key.length > 200) {
    return Response.json({ error: "A valid idempotency key is required." }, { status: 422 });
  }

  try {
    return Response.json(await publishContentItemNow(token, id, key), {
      status: 202,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return forwardProductError(error);
  }
}
