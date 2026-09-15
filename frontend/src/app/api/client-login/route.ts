// THE MAGIC-LINK EXCHANGE. The one door into the client-facing app.
//
// `GET /api/client-login?token=<raw backend onboarding token>` — the token is the
// BACKEND's onboarding credential (`POST /v1/clients/{id}/users/{user}/onboarding-token`),
// not the retired HMAC scheme this route used to verify. `lib/client-token.ts` was
// a SECOND, independent 30-day HMAC token system that knew nothing about the
// backend's token, and two token systems is how a stale one gets trusted (D7A-12).
// There is now exactly one identity, and it is the one the API itself issues.
//
// ─── THE ORDERING IS THE MITIGATION, NOT TIDINESS (T-03-05-08) ──────────────
//
// This route runs in the numbered order below and the order is load-bearing.
// Somebody editing this file later must be able to see that, so it is written
// down rather than left to be inferred from the line positions:
//
//   1. READ the raw token out of the query string.
//   2. CONSUME it — `getOnboarding(token)` — while no `Location` exists anywhere
//      in this function. A 200 proves the credential AND yields `confirmed_at`:
//      one call, both answers, and no second round trip that could succeed for a
//      token the first one had already rejected.
//   3. SET the session cookie, still before any `Location`.
//   4. ONLY THEN produce the redirect, on the SAME response as the cookie.
//
// THE DOCUMENTED FAILURE MODE THIS ORDER PREVENTS: a landing page that REDIRECTS
// BEFORE CONSUMING THE TOKEN hands the credential to the redirect target's
// referer logs. The token is a raw 30-day bearer credential sitting in a query
// string, so every referer header, proxy log and shared screenshot on its path is
// a copy of it. Phase 3 shipped the token and could not close that leak, because
// the URL belongs to this frontend. Reversing steps 2-4 reopens it while leaving
// every test, type check and lint in this repo green.
//
// ─── `Referrer-Policy: no-referrer` ON EVERY RESPONSE THIS ROUTE CAN PRODUCE ──
//
// The redirect, the 401, and any other exit. `next.config.ts` carries the same
// header for `/(.*)` — that entry is the belt and this is the braces, and the
// duplication is deliberate: a route-level header survives a future edit to the
// config, and a config entry survives a future refactor of this file. Neither
// half is sufficient alone; the config comment makes the same argument from its
// side.
//
// ─── ONE REFUSAL, NO RETRY ──────────────────────────────────────────────────
//
// Every refusal — no token in the URL, a malformed token, an unknown token, a
// revoked token, an unreachable backend — answers with the SAME destination.
// That is not laziness: `src/product/auth.py`'s `REFUSAL_DETAIL` makes all four
// of the API's own client-credential refusals identical for the same reason,
// and its comment names it — a more helpful message is an ORACLE telling an
// unauthenticated caller which client ids exist and which links have been
// turned off. Branching this message on the cause would rebuild that oracle
// one layer up. There is also no "Try again" affordance anywhere on this path,
// because retrying cannot change the answer (Copy rule 2, D7A-13).
//
// CORRECTED, auth phase (2026-08-22, R5): this used to be "one 401, one JSON
// sentence" — the paragraph above described that shape and is left in place
// because the invariant (one shape for all causes) is unchanged; only the
// shape itself moved from a 401 JSON body to a 303 redirect to `/?error=link`.
// See `refused()`'s own doc comment for why.

import { NextResponse } from "next/server";
import { cookies } from "next/headers";

import { CLIENT_TOKEN_COOKIE } from "@/lib/client-session";
import { getOnboarding } from "@/lib/product";

/** On the redirect, on the refusal, on everything. See the header block. */
const SAFE_HEADERS = {
  "Referrer-Policy": "no-referrer",
  "Cache-Control": "no-store",
} as const;

/** The ONE refusal. One status, one destination, no retry control, no detail.
 *
 * CHANGED, auth phase (2026-08-22, R5): this used to answer with raw
 * `{"error": ...}` JSON — the worst surface in the app, because it left that
 * body sitting in the address bar rather than inside any rendered page. It now
 * redirects to `/?error=link`, still ONE shape for all four causes (no token in
 * the URL, a malformed token, an unknown token, a revoked token — Copy rule 2,
 * D7A-13 unchanged): `page.tsx` reads the literal `"link"` and nothing else,
 * and turns it into `login.linkDead` inside `LoginScreen`'s own error slot,
 * styled the same way a failed password attempt is. The redirect carries no
 * token and no server sentence of its own — the literal is validated against
 * exactly one value before it ever reaches a prop, so this route cannot be used
 * to inject arbitrary text onto `/`.
 */
function refused(origin: string): NextResponse {
  return NextResponse.redirect(new URL("/refined/signin?error=link", origin), {
    status: 303,
    headers: SAFE_HEADERS,
  });
}

export async function GET(request: Request): Promise<NextResponse> {
  const origin = new URL(request.url).origin;

  // ── 1. READ ────────────────────────────────────────────────────────────────
  const token = new URL(request.url).searchParams.get("token") ?? "";
  if (!token) return refused(origin);

  // ── 2. CONSUME — the exchange IS the validation ─────────────────────────────
  // No `Location` exists at this point and none is computed below on this branch.
  // The thrown error is DISCARDED rather than inspected: `ProductHttpError.message`
  // carries the upstream path and the raw response body, and the token is in that
  // path's own request. Nothing derived from it may reach a log or a response.
  let confirmedAt: string | null;
  try {
    confirmedAt = (await getOnboarding(token)).confirmed_at;
  } catch {
    return refused(origin);
  }

  // ── 3. SET THE SESSION COOKIE — still before any `Location` ────────────────
  // The option set is the one this route already shipped, with ONE addition.
  // `httpOnly` keeps it unreadable from script (T-07A-06-03); `sameSite: "lax"`
  // lets the top-level navigation from the emailed link carry it; the 30-day
  // `maxAge` matches the backend token's own TTL, so the cookie does not outlive
  // the credential inside it. `secure` is NEW — the shipped route set no `secure`
  // flag at all — and it is conditional because the demo runs over plain HTTP on
  // localhost, where an unconditional `secure` would silently drop the cookie and
  // present as "the magic link does nothing".
  //
  // WHY THIS `maxAge` STAYS A FLAT 30 DAYS WHILE `api/login/route.ts`'S OWN
  // COOKIE DOES NOT (F3, 2026-08-22): an onboarding token carries no
  // `expires_at` to derive a tighter figure from — this credential family
  // simply has no expiry clock, so 30 days here was always an upper-bound
  // convenience, never a real TTL read off the token. The password-login
  // route's session token DOES carry one, and that route's cookie is sized
  // from it (`cookieMaxAgeSeconds`, moved to `@/lib/cookie-maxage.ts` at
  // Task 10 so `api/set-password/route.ts` could share the same rule for the
  // same reason — corrected here by dated addition rather than edited in
  // place, since the ORIGINAL claim, "that route's cookie is sized from it",
  // is still true; only the function's home file changed). The two doors'
  // cookies differing in `maxAge` only is still deliberate — do not "fix"
  // them back into matching.
  const jar = await cookies();
  jar.set(CLIENT_TOKEN_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
    secure: process.env.NODE_ENV === "production",
  });

  // ── 4. REDIRECT, TOKEN-FREE, ON THE SAME RESPONSE ──────────────────────────
  // `confirmed_at === null` means the client has not confirmed their guardrails,
  // so onboarding is the honest first screen; otherwise the app's own home. NO
  // INTERSTITIAL: this lineage deleted Welcome, and an extra hop is exactly the
  // redirect risk above (D7A-13).
  //
  // THE ONE LINE THAT IS NOT A VERBATIM PORT, AND WHY. The 7a lineage sent a
  // confirmed client to `/dashboard`; THIS design has no such route. Its signed-in
  // home is `/home` (`src/app/(app)/home/page.tsx`) and its onboarding is
  // `/onboarding` — which does exist here and keeps its name. A verbatim `/dashboard`
  // would 404 the client on the one hop the whole magic link exists to make, so the
  // destination is adapted and the ORDERING above — the actual mitigation — is not
  // touched. Everything else in this file is byte-identical to `frontend/`'s copy.
  //
  // The destination is built from a path and `request.url`'s origin ONLY, so it
  // cannot inherit this request's query string: the credential does not survive
  // into the address bar, the history entry, or a shared screenshot
  // (T-07A-06-01). `NextResponse.redirect` is used rather than `redirect()` from
  // `next/navigation` because that one THROWS and hands response construction to
  // the framework, leaving nowhere to attach the header this route must carry;
  // this returns an object whose `Location`, `Set-Cookie` and `Referrer-Policy`
  // are all on the one response.
  const destination = new URL(
    confirmedAt === null ? "/refined/onboarding" : "/refined/home",
    origin,
  );
  return NextResponse.redirect(destination, { status: 303, headers: SAFE_HEADERS });
}
