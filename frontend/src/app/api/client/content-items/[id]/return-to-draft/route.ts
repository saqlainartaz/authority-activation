import { clientToken } from "@/lib/client-session";
import { expiredLinkResponse, forwardProductError, readJsonObject, returnContentToDraft } from "@/lib/product";

type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Params) {
  const token = await clientToken();
  if (!token) return expiredLinkResponse();
  const { id } = await params;
  const raw = await readJsonObject(request);
  try {
    return Response.json(await returnContentToDraft(token, id, { idempotency_key: raw.idempotency_key as string }));
  } catch (error) { return forwardProductError(error); }
}
