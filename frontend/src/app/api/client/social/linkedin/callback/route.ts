import { clientToken } from "@/lib/client-session";
import { completeLinkedInOAuth } from "@/lib/product";

const CODE_LIMIT = 4096;
const STATE_LIMIT = 512;

function finish(request: Request, result: string): Response {
  const target = new URL("/refined/home", request.url);
  target.searchParams.set("linkedin", result);
  return new Response(null, {
    status: 303,
    headers: {
      Location: target.toString(),
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
    },
  });
}

// LinkedIn returns a browser GET. Exchange the short-lived code only from this
// server route, using the same httpOnly product session that began the flow.
// Redirect immediately so the code/state do not remain in the browser URL.
export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  if (url.searchParams.has("error")) return finish(request, "denied");

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (
    !code || code.length > CODE_LIMIT ||
    !state || state.length < 20 || state.length > STATE_LIMIT
  ) {
    return finish(request, "invalid-response");
  }

  const token = await clientToken();
  if (!token) return finish(request, "session-expired");
  try {
    await completeLinkedInOAuth(token, code, state);
    return finish(request, "connected");
  } catch {
    // Never put provider errors, codes, state, or credentials in redirect URLs.
    return finish(request, "failed");
  }
}
