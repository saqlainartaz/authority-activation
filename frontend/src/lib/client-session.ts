// Server-only session helper for the CLIENT-facing app: the credential this
// browser holds, and the tenant that credential belongs to.
// The token must NEVER reach the browser as readable state: it lives in an
// httpOnly cookie, and this file is importable only from server components,
// route handlers and server actions.
//
// One cookie, one credential. The token IS the identity (D7A-12) — there is no
// second token scheme beside it. `lib/client-token.ts`'s HMAC scheme is retired
// as identity and survives only for the `/internal` operator persona-switch;
// two token systems is how a stale one gets trusted.
//
// AUTH PHASE ADDITION (2026-08-22): the SAME cookie slot now carries EITHER an
// onboarding token (from the magic-link exchange, `api/client-login`) OR a
// session token (from password login, `api/login`). Nothing in this file, or
// in any of `resolveClientId`'s callers, parses which one it is — the backend
// dispatches on the token's own `s.` prefix (`GET /v1/me` accepts both), so
// this module stays exactly as ignorant of the distinction as it was before.

import "server-only";

import { cookies } from "next/headers";

import { getMe } from "./product";

/** The httpOnly cookie holding the raw onboarding token.
 *
 * Set by the landing exchange (plan 07A-05), never by client JavaScript. The
 * value is the raw `{client_id}.{secret}` token — the `client_id` prefix is a
 * ROUTING HINT ONLY and must not be parsed as identity: the API resolves the
 * tenant by a sha256 lookup performed under the tenant that prefix names, so a
 * token whose prefix was swapped for another client's id resolves to nothing.
 * Splitting on the dot here would reintroduce exactly the trust in a
 * caller-supplied id that design removes. Use `resolveClientId` instead.
 */
export const CLIENT_TOKEN_COOKIE = "aa_client_token";

/** No usable session on this request. Distinct from a 401 from the API.
 *
 * Thrown when the cookie is absent — which is the ordinary state of a browser
 * that has not opened its magic link yet, not an error. Callers render the
 * expired-link surface; they do NOT retry, because there is nothing to retry
 * (Copy rule 2).
 */
export class NoClientSession extends Error {
  constructor(message = "No client session: the onboarding-token cookie is absent.") {
    super(message);
    this.name = "NoClientSession";
  }
}

/** The token, or `null`. The graceful-null convention `(app)/layout.tsx` uses. */
export async function clientToken(): Promise<string | null> {
  const jar = await cookies();
  const value = jar.get(CLIENT_TOKEN_COOKIE)?.value;
  // An empty cookie is treated as absent rather than sent as a credential: an
  // empty `X-Onboarding-Token` is a 401 anyway, and the same fail-closed shape
  // as `internal-auth.ts`'s `if (!expected) return false` keeps the two gates
  // reading alike.
  return value && value.length > 0 ? value : null;
}

/** The token, or throw. For surfaces that have nothing to render without one. */
export async function requireClientToken(): Promise<string> {
  const token = await clientToken();
  if (!token) throw new NoClientSession();
  return token;
}

/** The tenant, RE-DERIVED FROM THE TOKEN on every request.
 *
 * `GET /v1/me` publishes `client_id`, server-authored from the token the
 * request carried — either an onboarding token or a session token, the API
 * dispatches on the prefix and this file never needs to. That is the only
 * honest source of the id on this surface, and it is read fresh every time
 * rather than stored.
 *
 * SWAPPED FROM `GET /v1/campaigns` TO `GET /v1/me`, auth phase (2026-08-22,
 * A5). The campaigns envelope was never about identity — it worked only
 * because every session at the time held an onboarding token.
 *
 * CORRECTED (fix wave, 2026-08-22, M2-hygiene): the paragraph above used to
 * claim a password session's token "carries no campaigns envelope at all" —
 * false. `GET /v1/campaigns` dual-accepts either token shape, and
 * `lib/product.ts::listClientCampaigns` still has five live call sites
 * (`api/client/campaigns/route.ts`, `api/client/profile/route.ts`,
 * `lib/compose-provisioning.ts` ×3, via `lib/reads.ts::readCampaigns`) that
 * work fine against a password session today. The REASON this function
 * swapped to `/v1/me` was never that the campaigns route couldn't answer —
 * it's that `/v1/me` is the surface BUILT to answer "who is this," and
 * reaching for a resource-listing endpoint to derive identity was borrowing
 * a side effect of one token shape rather than asking the right question for
 * both. The swap itself is unchanged and still correct; only the stated
 * reason for it was wrong. This function's exported name, signature and
 * behavior-on-failure are unchanged: every one of its four callers still
 * calls it exactly as before and still sees whatever `ProductHttpError` a bad
 * token throws, unhandled here.
 *
 * WHY IT IS NEVER A COOKIE AND NEVER A URL. Four service-credential proxies
 * need a `client_id` in their path (`console`, the campaign create, the periods
 * pair, `held`/`release`). If the Next server took that id from a cookie or a
 * query string, a caller who edited either could pair TENANT A'S TOKEN WITH
 * TENANT B'S ID — the service key is attached by this server on both calls, so
 * the request would be authenticated and would read the wrong tenant. That
 * pairing is the privilege escalation `docs/DECISIONS.md` records as the
 * rejected alternative to publishing the id (T-07A-02-01), not a style
 * preference. Re-deriving makes the id unforgeable by construction: it is
 * whatever the API says the presented token belongs to.
 *
 * NO REQUEST-LEVEL MEMOISATION IN THIS PHASE, and the reason is measured rather
 * than assumed. Only the four proxies above need the id, one call each, and the
 * demo corpus is small, so the cost is one extra small read on the handful of
 * requests that make a service-key call — client-credential routes need no id
 * at all and pay nothing. THE TRIPWIRE: a single page that needs three of the
 * four. At that point wrap this in React's `cache()` (it is per-request, which
 * is the correct scope — a cross-request cache would be a stored tenant id
 * again, i.e. the thing this function exists to avoid).
 */
export async function resolveClientId(token: string): Promise<string> {
  const me = await getMe(token);
  return me.client_id;
}
