// POST /api/client/content-items/[id]/mark-posted -> POST .../mark-posted
//
// The client says they posted it. `MarkPostedIn` is exactly `{ idempotency_key }`,
// and the key matters here more than anywhere: a double-tap on a phone with bad
// signal is the case PITFALLS names by name, and a replay must be the same write
// rather than a second transition.

import { clientToken } from "@/lib/client-session";
import type { KeyedIn } from "@/lib/product";
import {
  expiredLinkResponse,
  forwardProductError,
  markPosted,
  readJsonObject,
} from "@/lib/product";

type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Params) {
  const token = await clientToken();
  if (!token) return expiredLinkResponse();
  const { id } = await params;
  const raw = await readJsonObject(request);

  // ALLOWLIST: idempotency_key.
  const body = { idempotency_key: raw.idempotency_key } as KeyedIn;

  try {
    return Response.json(await markPosted(token, id, body));
  } catch (e) {
    return forwardProductError(e);
  }
}
