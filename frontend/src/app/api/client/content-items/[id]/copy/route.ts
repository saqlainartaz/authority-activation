// GET /api/client/content-items/[id]/copy -> GET .../copy
//
// The approved body, ready to paste, with its `body_sha256` beside it. A GET, so
// it takes no idempotency key: D6-19's rule is that the screening happens AT
// GENERATION and not at copy time, so this route reads a version that was already
// checked rather than sanitising one on the way out.

import { clientToken } from "@/lib/client-session";
import {
  copyApproved,
  expiredLinkResponse,
  forwardProductError,
} from "@/lib/product";

type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Params) {
  const token = await clientToken();
  if (!token) return expiredLinkResponse();
  const { id } = await params;
  try {
    return Response.json(await copyApproved(token, id));
  } catch (e) {
    return forwardProductError(e);
  }
}
