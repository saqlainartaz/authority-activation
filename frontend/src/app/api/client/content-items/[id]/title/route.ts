import { clientToken } from "@/lib/client-session";
import { changeContentTitle, expiredLinkResponse, forwardProductError, readJsonObject } from "@/lib/product";

type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Params) {
  const token = await clientToken();
  if (!token) return expiredLinkResponse();
  const { id } = await params;
  const raw = await readJsonObject(request);
  try {
    return Response.json(await changeContentTitle(token, id, {
      title: raw.title as string,
      idempotency_key: raw.idempotency_key as string,
    }));
  } catch (error) { return forwardProductError(error); }
}
