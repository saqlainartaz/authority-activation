import { clientToken } from "@/lib/client-session";
import { expiredLinkResponse, forwardProductError, uploadPostMedia } from "@/lib/product";

export async function POST(request: Request) {
  const token = await clientToken();
  if (!token) return expiredLinkResponse();
  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  const idempotencyKey = form?.get("idempotency_key");
  if (!(file instanceof File) || typeof idempotencyKey !== "string") {
    return Response.json({ error: "Choose one JPEG, PNG, or WebP image." }, { status: 422 });
  }
  try {
    return Response.json(await uploadPostMedia(token, file, idempotencyKey), { status: 201 });
  } catch (error) {
    return forwardProductError(error);
  }
}
