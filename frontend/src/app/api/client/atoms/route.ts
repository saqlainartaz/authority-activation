// GET /api/client/atoms?atom_type= -> GET /v1/atoms
//
// SHAPE 1, client-credential passthrough. The client's own live atoms — the
// corpus behind Train Your AI.
//
// THE ONE QUERY VALUE IS VALIDATED AGAINST THE NINE BEFORE IT IS FORWARDED, and
// an unknown one is refused HERE rather than round-tripped. The convention is
// the shipped one at `api/internal/voice-profile/route.ts:25`: a query
// parameter this layer can judge is this layer's own refusal. The nine names
// come from `ATOM_TYPES` in `@/lib/product`, which is the only place in this
// frontend they are spelled; the backend's own 422 lists the same nine, built
// from `M1_ATOM_TYPES`.
//
// ABSENT MEANS EVERY TYPE, which is not the same as an empty string. A screen
// wanting every badge asks unfiltered and gets rows and `atom_counts` out of ONE
// consistent read — `atom_counts` describes the RETURNED set, so a filtered
// request returns one key.
//
// THERE IS NO `client_id` ANYWHERE ON THIS PATH. The tenant is the token's.
//
// THE RESPONSE IS FORWARDED WHOLE. Unlike the console beside it, this is a
// client-credential read of the client's own material and every field was
// designed for this screen. `atom_type` IS present and IS engine vocabulary —
// the screen maps it through `@/lib/atom-labels`, which is where the nine names
// become the nine shipped category headings. `text` is `trust: "untrusted"`: the
// whole text, never a preview, escaped and never rendered as HTML or markdown.

import { clientToken } from "@/lib/client-session";
import {
  ATOM_TYPES,
  expiredLinkResponse,
  forwardProductError,
  isAtomType,
  listClientAtoms,
} from "@/lib/product";

export async function GET(request: Request) {
  const token = await clientToken();
  if (!token) return expiredLinkResponse();

  const atomType = new URL(request.url).searchParams.get("atom_type");
  if (atomType !== null && !isAtomType(atomType)) {
    return Response.json(
      { error: `atom_type must be one of: ${ATOM_TYPES.join(", ")}` },
      { status: 422 },
    );
  }

  try {
    return Response.json(await listClientAtoms(token, atomType));
  } catch (e) {
    return forwardProductError(e);
  }
}
