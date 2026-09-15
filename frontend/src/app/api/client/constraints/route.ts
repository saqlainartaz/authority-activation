// GET /api/client/constraints -> GET /v1/constraints
//
// SHAPE 1, client-credential passthrough. The onboarding token comes from the
// session cookie and nowhere else; there is no `client_id` in the path, the
// query or the body, and the handler takes no parameters at all, so there is no
// caller-supplied value that could reach the upstream call.
//
// THE RESPONSE IS FORWARDED WHOLE, AND THAT IS DELIBERATE. The console handler
// beside this one strips, because a service-key read returns operator
// vocabulary. This is a CLIENT-credential read of the client's own constraints:
// every field on it — `origin`, `can_unban`, `atom_type`, the two counts — was
// designed for this screen. `atom_type` is the one piece of engine vocabulary
// present, and it is present on purpose (a blacklisted claim and a voice
// constraint mean different things to a reader); the constraints screen labels
// it. Stripping it here would leave the screen guessing.
//
// `text` carries `trust: "untrusted"` — the client's own bytes. The screen must
// escape it and must never render it as HTML or markdown (IC-5.5).

import { clientToken } from "@/lib/client-session";
import {
  expiredLinkResponse,
  forwardProductError,
  listConstraints,
} from "@/lib/product";

export async function GET() {
  const token = await clientToken();
  if (!token) return expiredLinkResponse();
  try {
    return Response.json(await listConstraints(token));
  } catch (e) {
    return forwardProductError(e);
  }
}
