// The OPERATOR's read of the held-draft queue (D7A-08, IC-12), passcode-gated.
//
// THE TENANT IS A PATH SEGMENT HERE, AND THAT IS A DEVIATION FROM PATTERNS § 2c
// (which sketched `/api/internal/held`) IN FAVOUR OF THE SHIPPED `/api/internal/**`
// CONVENTION — `api/internal/clients/[clientId]/atoms/route.ts` and its three
// siblings all carry it. It is correct on THIS surface and on no other: `/internal`
// has its own client picker, an operator legitimately acts across clients, and
// `GET /v1/clients/{id}/held` is service-only and takes the tenant in its own path
// for exactly that reason (`operator_queue.py`'s "THE CREDENTIAL FORK" docstring).
// Every `/api/client/**` handler is the opposite by construction (D7A-14): a tenant
// segment there would let a browser name the tenant it reads, which is the spoofing
// case the client-credential design exists to prevent.
//
// WHAT MUST NEVER HAPPEN ON THE OTHER SIDE OF THIS PROXY: the queue publishes
// `rejection_kind`, `first_rejection_kind` and `hold_origin` — precisely the fields
// the client's own generation poll withholds. That asymmetry IS DECIDE-06's
// requirement. Do not add a client-credential twin of this route.

import { checkInternalPasscode, unauthorized } from "@/lib/internal-auth";
import { forwardProductError, heldQueue } from "@/lib/product";

type Params = { params: Promise<{ clientId: string }> };

export async function GET(request: Request, { params }: Params) {
  if (!checkInternalPasscode(request)) return unauthorized();
  const { clientId } = await params;
  try {
    return Response.json(await heldQueue(clientId));
  } catch (error) {
    return forwardProductError(error);
  }
}
