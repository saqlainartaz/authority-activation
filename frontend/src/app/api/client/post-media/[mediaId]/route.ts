import { clientToken } from "@/lib/client-session";
import { downloadPostMedia, expiredLinkResponse, forwardProductError } from "@/lib/product";

type Params = { params: Promise<{ mediaId: string }> };

export async function GET(request: Request, { params }: Params) {
  const token = await clientToken();
  if (!token) return expiredLinkResponse();
  const { mediaId } = await params;
  try {
    const upstream = await downloadPostMedia(token, mediaId);
    return new Response(upstream.body, {
      status: upstream.status,
      headers: {
        "Content-Type": upstream.headers.get("Content-Type") ?? "application/octet-stream",
        "Content-Disposition": new URL(request.url).searchParams.has("preview") ? "inline" : upstream.headers.get("Content-Disposition") ?? "attachment",
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return forwardProductError(error);
  }
}
