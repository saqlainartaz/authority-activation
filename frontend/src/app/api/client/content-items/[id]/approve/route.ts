// POST /api/client/content-items/[id]/approve -> POST /v1/content-items/{id}/approve
//
// This used to say approve allocates the calendar slot IN THE SAME TRANSACTION
// (D6-05), and that there was deliberately no approved-but-unscheduled state.
// That was true only while approve called an allocator of its own. Pass 1
// (spec 2026-08-20-campaign-removal-and-softening-design.md, decision D2)
// deleted that allocator: `slot: null` is now the ORDINARY answer for every
// approve, not an edge case, and a date enters the system afterward through
// `POST /v1/content-items/{id}/schedule` (../schedule/route.ts). See
// `Approved` in `@/lib/product` for the type-level record of the same
// reversal.

import { clientToken } from "@/lib/client-session";
import type { KeyedIn } from "@/lib/product";
import {
  approve,
  expiredLinkResponse,
  forwardProductError,
  readJsonObject,
} from "@/lib/product";

type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Params) {
  const token = await clientToken();
  if (!token) return expiredLinkResponse();
  const { id } = await params;
  const raw = await readJsonObject(request);

  // ALLOWLIST: idempotency_key. `ApproveIn` has exactly that one field and sets
  // `extra="forbid"`, so one stray key is a 422 — which is why the body is built
  // rather than passed through.
  const body = { idempotency_key: raw.idempotency_key } as KeyedIn;

  try {
    return Response.json(await approve(token, id, body));
  } catch (e) {
    return forwardProductError(e);
  }
}
