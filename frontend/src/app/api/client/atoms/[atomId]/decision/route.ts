// POST /api/client/atoms/[atomId]/decision -> POST /v1/atoms/{atom_id}/decision
//
// SHAPE 1, client-credential passthrough. Confirm or suppress one of the
// client's own atoms.
//
// THIS IS THE CLIENT FORK, NOT THE OPERATOR ONE. The operator's route is
// `POST /v1/clients/{client_id}/atoms/{atom_id}/decision` — a service key, a
// tenant in the path, and the whole `confirm | override | deprecate` vocabulary.
// `/internal/clients/[clientId]/atoms/[atomId]/decision/route.ts` in this tree
// proxies THAT one. They are not interchangeable and neither should be "tidied"
// into the other: `override` EDITS the atom's text and re-embeds it, which is an
// editorial act nobody has decided a client performs. The backend answers 422
// naming the two accepted verbs, and the allowlist below does not filter it out
// — a caller who sends `override` should meet that 422 rather than have this
// layer quietly drop the field and send a request meaning something else.
//
// THE ATOM IS THE ADDRESS, so a replayed `idempotency_key` cannot reach a
// different atom. Same property and same reason as the un-ban route.
//
// THE KEY IS THE CALLER'S AND IS FORWARDED UNCHANGED — never minted here
// (T-07B-05-05).
//
// A DECISION THAT IS ALREADY THE ATOM'S STATUS IS A QUIET 200 carrying
// `unchanged: true`, not a 409. Forwarded as the 200 it is.
//
// AN ONBOARDING-WRITTEN GUARDRAIL CANNOT BE DEPRECATED THROUGH THIS DOOR
// EITHER — a 404, never a 403, and invisible to the route rather than refused by
// it. A CONFIRM on such an atom is allowed and changes nothing.

import { clientToken } from "@/lib/client-session";
import type { ClientAtomDecisionIn } from "@/lib/product";
import {
  decideClientAtom,
  expiredLinkResponse,
  forwardProductError,
  readJsonObject,
} from "@/lib/product";

type Params = { params: Promise<{ atomId: string }> };

export async function POST(request: Request, { params }: Params) {
  const token = await clientToken();
  if (!token) return expiredLinkResponse();
  const { atomId } = await params;
  const raw = await readJsonObject(request);

  // ALLOWLIST: decision, idempotency_key, note. Exactly
  // `ClientAtomDecisionIn`'s three fields, built field by field. A spread of
  // `raw` is how a widened backend model silently reaches the API
  // (T-07B-05-02).
  const body = {
    decision: raw.decision,
    idempotency_key: raw.idempotency_key,
    note: raw.note,
  } as ClientAtomDecisionIn;

  try {
    return Response.json(await decideClientAtom(token, atomId, body));
  } catch (e) {
    return forwardProductError(e);
  }
}
