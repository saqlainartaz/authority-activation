import { clientToken } from "@/lib/client-session";
import {
  expiredLinkResponse,
  forwardProductError,
  listSocialAccounts,
} from "@/lib/product";

export async function GET(): Promise<Response> {
  const token = await clientToken();
  if (!token) return expiredLinkResponse();
  try {
    return Response.json(await listSocialAccounts(token), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return forwardProductError(error);
  }
}
