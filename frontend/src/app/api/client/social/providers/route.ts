import { clientToken } from "@/lib/client-session";
import {
  expiredLinkResponse,
  forwardProductError,
  listSocialProviders,
} from "@/lib/product";

export async function GET(): Promise<Response> {
  const token = await clientToken();
  if (!token) return expiredLinkResponse();
  try {
    return Response.json(await listSocialProviders(token), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return forwardProductError(error);
  }
}
