// POST /api/client/constraints/[atomId]/unban -> POST /v1/constraints/{atom_id}/unban
//
// SHAPE 1, client-credential passthrough. Lifting one rejection-written ban.
//
// THE ATOM IS THE ADDRESS, NOT A BODY FIELD, and that is load-bearing rather
// than stylistic: it makes the target part of the request's URL, so a replayed
// `idempotency_key` cannot reach a different atom than the one it was minted
// for. `07A-REVIEW` CR-01 was exactly that bug on the reject sheet; here the
// substitution is unrepresentable rather than re-guarded. The backend refuses an
// `atom_id` in the body (`extra="forbid"`), and so does the allowlist below.
//
// THE KEY IS THE CALLER'S AND IS FORWARDED UNCHANGED. Never mint one here: the
// key's whole purpose is that the BROWSER holds one key per action across
// retries, and a server-minted key would be new on every retry, which defeats
// the database's enforcement exactly when it is needed (T-07B-05-05).
//
// ALREADY LIFTED IS A QUIET 200 carrying `already_deprecated: true`, not a 409,
// and the replay arm turns on the ATOM'S STATE rather than on the key — so a
// second tap with a FRESH key gets the same quiet answer. Forwarded as the 200
// it is.
//
// A STANDING RULE IS A 404 HERE, NEVER A 403. It is invisible to the route
// rather than refused by it, and answering "you may not touch this one" would
// confirm which atom it is. The screen withholds the affordance from the
// server's own `can_unban`, so this path is the backstop and not the rule.

import { clientToken } from "@/lib/client-session";
import type { UnbanIn } from "@/lib/product";
import {
  expiredLinkResponse,
  forwardProductError,
  readJsonObject,
  unbanConstraint,
} from "@/lib/product";

type Params = { params: Promise<{ atomId: string }> };

export async function POST(request: Request, { params }: Params) {
  const token = await clientToken();
  if (!token) return expiredLinkResponse();
  const { atomId } = await params;
  const raw = await readJsonObject(request);

  // ALLOWLIST: idempotency_key, note. Exactly `UnbanIn`'s two fields, built
  // field by field. A spread of `raw` is how a widened backend model silently
  // reaches the API, and how an `atom_id` the caller chose would ride along
  // beside the one in the path (T-07B-05-02).
  const body = {
    idempotency_key: raw.idempotency_key,
    note: raw.note,
  } as UnbanIn;

  try {
    return Response.json(await unbanConstraint(token, atomId, body));
  } catch (e) {
    return forwardProductError(e);
  }
}
