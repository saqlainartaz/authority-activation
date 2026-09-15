// GET /api/client/console -> GET /v1/clients/{client_id}/console  (SERVICE KEY)
//
// A SERVICE-CREDENTIAL PROXY, and the fifth-from-last handler a reader should
// tidy. `console.py`'s route is `require_service_token` and has no
// client-credential twin, so the Next server reads it with the service key and
// the tenant is RESOLVED FROM THE SESSION TOKEN — `resolveClientId(token)`, which
// asks the API what the presented token belongs to. It is never read from a
// cookie, a path or a query: the service key is attached by this server, so a
// caller who could edit the id would pair THEIR token with SOMEBODY ELSE'S tenant
// and get an authenticated cross-tenant read (T-07A-04-05).
//
// THE RESPONSE IS A STRICT SUBSET, AND LABELLING IS THE POINT OF THE FILE.
// The raw console answer is operator vocabulary plus a corpus census:
//
//   * `atom_counts` — forwarded after `atom-labels.ts` converts every internal
//     type into its reviewed client category. The grounding card needs these
//     counts, but IC-7.2 forbids the underlying engine vocabulary.
//   * `plays[].missing_atom_types` — forwarded in the same labelled form. The
//     campaign gap computation needs them, but an ineligible play must not put
//     internal type names on a client surface.
//   * `plays[].internal_name` — named "internal" by the API itself, and every one
//     of them contains the word "play", which PLAY-03 keeps out of client-facing
//     text. A client-facing label for a play id belongs to the campaigns screen.
//   * `voice_profile` — a build/approval badge for the `/internal` tool.
//   * `client_id` — the browser has no path that takes a tenant id.
//
// What survives is what D7A-09 needs and nothing else: which plays exist, whether
// each is available, and which one the client's own corpus selects.

import { clientToken } from "@/lib/client-session";
import { labelAtomCounts, labelMissingAtomTypes } from "@/lib/atom-labels";
import { resolveClientId } from "@/lib/client-session";
import {
  clientConsole,
  expiredLinkResponse,
  forwardProductError,
} from "@/lib/product";

export async function GET() {
  const token = await clientToken();
  if (!token) return expiredLinkResponse();
  try {
    const clientId = await resolveClientId(token);
    const console_ = await clientConsole(clientId);
    return Response.json({
      // Built key by key, per play, so widening `PlayVerdictOut` on the backend
      // cannot silently publish a new field to a browser.
      plays: console_.plays.map((play) => ({
        play_id: play.play_id,
        eligible: play.eligible,
        is_fallback: play.is_fallback,
        missing_atom_types: labelMissingAtomTypes(play.missing_atom_types),
      })),
      atom_counts: labelAtomCounts(console_.atom_counts),
      selected_play_id: console_.selected_play_id,
      generated_at: console_.generated_at,
    });
  } catch (e) {
    return forwardProductError(e);
  }
}
