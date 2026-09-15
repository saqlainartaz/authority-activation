// THE `/internal` OPERATOR PERSONA-SWITCH. ONE COOKIE NAME, AND NOTHING ELSE.
//
// WHAT THIS MODULE IS NOT: an identity. It used to be one — a SECOND, independent
// HMAC 30-day token scheme signed with `CLIENT_LOGIN_SECRET` (falling back to
// `INTERNAL_PASSCODE`) that knew nothing whatever about the backend's onboarding
// token. Two token systems is how a stale one gets trusted (D7A-12): a link this
// module signed stayed valid after an operator revoked the real credential,
// because revocation lives in `onboarding_tokens.revoked_at` and this scheme never
// looked there. There was no shared clock, no shared store and no shared
// revocation — only two 30-day windows that happened to be the same length.
//
// THE ONE IDENTITY IS THE BACKEND'S ONBOARDING TOKEN. It is issued by
// `POST /v1/clients/{client_id}/users/{user_id}/onboarding-token`, exchanged for an
// httpOnly cookie by `app/api/client-login/route.ts`, read by
// `lib/client-session.ts`, and revocable in one place. Nothing else authenticates
// a client, and nothing in this file does either.
//
// `issueClientToken` AND `verifyClientToken` ARE DELETED, NOT DEPRECATED, and the
// `SECRET` capture with them. After plan 07A-06 task 1 replaced their last two call
// sites, a grep over `frontend/src` found ZERO references to either name outside
// their own declarations — so what remained was a signing function and a verifying
// function with no caller, which is a credential scheme waiting to be trusted
// again. The next person needing "a quick way to log in as a client" would have
// found them, and they would have worked. `CLIENT_LOGIN_SECRET` is now read by
// nothing in this tree.
//
// WHAT SURVIVES, AND WHY IT IS A DIFFERENT THING. `/internal` lets one operator act
// across many clients, and the cookie below is how that console remembers which
// client the operator is looking at. That is a VIEW SELECTION on a
// passcode-gated operator surface, not a credential: the reads it scopes are made
// with `ENGINE_SERVICE_KEY`, which the operator already holds by virtue of being
// past the passcode. It authorises nothing that the passcode did not already
// authorise.
//
// THE NAME CHANGED SO THE TWO CAN NEVER BE CONFUSED. It was `active_client_id` —
// a name that reads like "who is logged in" and sat one line away from the client
// session in the same cookie jar. `internal_persona_client_id` says which surface
// owns it and what it holds. The client session is `aa_client_token`
// (`lib/client-session.ts`), and no code should ever read one expecting the other.

import "server-only";

/** Which client the `/internal` operator console is currently looking at.
 *
 * A VIEW SELECTION, NOT A CREDENTIAL — see the module header. Read by exactly two
 * surfaces after plan 07A-06: `ContextProfileCard` and `VoiceProfileCard`, both of
 * which query the ENGINE with the service key and neither of which is in this
 * phase's wired set.
 *
 * `app/(app)/layout.tsx` USED TO BE A THIRD READER AND IS DELIBERATELY NOT ONE NOW.
 * Its read was REMOVED rather than renamed: the `(app)` group is the client-facing
 * app, every screen under it now reads through the client credential, and a persona
 * name resolved from an operator's view selection would put a client's name on a
 * screen that has no session behind it — a fabricated identity, which is the exact
 * class of thing this phase deletes.
 *
 * Import this constant; never retype the string. Two spellings of a cookie name is
 * a cookie that is set and never read.
 */
export const INTERNAL_PERSONA_COOKIE = "internal_persona_client_id";
