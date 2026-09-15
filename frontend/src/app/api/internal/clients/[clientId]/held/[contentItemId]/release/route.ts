// The one click that releases a held draft back to `draft` (D-13, D7A-08),
// passcode-gated.
//
// THE TENANT IS A PATH SEGMENT HERE, for the reason spelled out in full in
// `../../route.ts`: this is the OPERATOR surface with its own client picker, which is
// the one place a tenant id in the path is correct. A tenant segment under
// `/api/client/**` would violate D7A-14.
//
// THERE IS NO REQUEST BODY, AND THAT IS MEASURED RATHER THAN ASSUMED.
// `src/product/api/operator_queue.py::release_held_draft(client_id, content_item_id,
// request)` declares no body parameter, so `request.json()` is not read and no
// `idempotency_key` is synthesised: there is no model to accept one, a posted body
// would be ignored in SILENCE, and every mutating model in this API sets
// `extra="forbid"` — so inventing a key would be a 422 at best and a lie at worst
// (the caller would believe the key did something). Idempotence comes from the
// route's own precondition instead: it refuses anything not currently held, so a
// second release meets a clean 4xx naming the state and nothing is written.
//
// NO OPERATOR EDIT PATH IS PROXIED HERE AND THERE MUST NOT BE ONE (D-13, reaffirmed
// by D6-13): a shared-passcode actor cannot name who wrote the words, and the release
// is the one operator write this queue is allowed.

import { checkInternalPasscode, unauthorized } from "@/lib/internal-auth";
import { forwardProductError, releaseHeld } from "@/lib/product";

type Params = { params: Promise<{ clientId: string; contentItemId: string }> };

export async function POST(request: Request, { params }: Params) {
  if (!checkInternalPasscode(request)) return unauthorized();
  const { clientId, contentItemId } = await params;
  try {
    return Response.json(await releaseHeld(clientId, contentItemId));
  } catch (error) {
    return forwardProductError(error);
  }
}
