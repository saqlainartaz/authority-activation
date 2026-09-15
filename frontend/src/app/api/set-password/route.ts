// SET PASSWORD. `POST /api/set-password` -> backend `POST /v1/auth/set-password`.
//
// THE INVITE/RESET LANDING (F2, Task 10, auth phase, 2026-08-22). A brand-new
// user's invite link, and an operator-issued password-reset link, both carry
// the SAME shape of raw onboarding-shaped token in a `?token=` query string —
// this route is the one place either kind is redeemed for a password.
// `/set-password/page.tsx` is the ONLY caller: it reads the token out of the
// URL and posts it here in the BODY, never as a query string on this route,
// so it never lands in this handler's own access log the way a GET's query
// string would.
//
// ON SUCCESS THIS WRITES THE SAME COOKIE SLOT `api/login/route.ts` and
// `api/client-login/route.ts` already write (`CLIENT_TOKEN_COOKIE`) — the
// backend mints a REAL SESSION here too (A11: the invite flow ends LOGGED
// IN), so there is nothing about the cookie itself that is specific to this
// route.
//
// THREE DISTINCT FAILURE SHAPES, NOT ONE — UNLIKE `api/login`'s SINGLE
// GENERIC REFUSAL, AND THAT ASYMMETRY IS DELIBERATE. Copy rule 2's "one
// sentence, no cause enumeration" is a rule about an UNAUTHENTICATED
// CALLER'S ambiguity — hiding whether "no such account" or "wrong password"
// is true, because either answer is an oracle about who has an account. Two
// of this route's three failures aren't that kind of question at all:
//
//   * 409 — the caller's own invite/reset link points at an email that
//     ALREADY has login credentials (a DIFFERENT user's). This is an
//     operator-fixable data conflict (P1), and the caller benefits from
//     knowing it rather than being told nothing.
//   * 422 — the password they just typed is outside the backend's 12..200
//     character bound. They can fix this by typing a different password;
//     folding it into a generic refusal would make the field's own rule
//     undiscoverable except by guessing.
//   * 401 — an invalid, revoked, wrong-purpose, or (for a reset link only —
//     invite links never expire) expired token. THIS is the "no such
//     account"-shaped question: telling a caller which of those four is true
//     would be an oracle about a credential they do not otherwise control,
//     so it collapses to the same generic refusal every other credential
//     failure in this app does.
//
// ORIGIN CHECK FIRST, THE SAME LOGIN-CSRF DEFENCE `api/login/route.ts` CARRIES
// (F2) — see that route's own `isCrossOriginSubmission` doc comment for the
// full reasoning behind allowing an absent `Origin` and refusing a mismatched
// one. Duplicated here rather than imported, for the same reason `SAFE_HEADERS`
// and `refused()` are each route's own copy rather than a shared one in this
// file family: a route-local gate does not depend on a shared module being
// wired correctly for this specific path.

import { NextResponse } from "next/server";
import { cookies } from "next/headers";

import { CLIENT_TOKEN_COOKIE } from "@/lib/client-session";
import { cookieMaxAgeSeconds } from "@/lib/cookie-maxage";
import { ProductHttpError, setPassword } from "@/lib/product";

const SAFE_HEADERS = {
  "Referrer-Policy": "no-referrer",
  "Cache-Control": "no-store",
} as const;

/** The ONE 401 shape: an invalid, revoked, wrong-purpose, or expired token —
 *  the one failure this route treats the way `api/login` treats all of them. */
function refused(): NextResponse {
  return NextResponse.json({ ok: false }, { status: 401, headers: SAFE_HEADERS });
}

/** The 409 shape: this email already has credentials. Operator-fixable (P1) —
 *  `/set-password/page.tsx` turns this into a distinct, actionable sentence. */
function conflict(): NextResponse {
  return NextResponse.json(
    { ok: false, reason: "conflict" },
    { status: 409, headers: SAFE_HEADERS },
  );
}

/** The 422 shape: the submitted password is outside the backend's 12..200
 *  character bound. Distinct from `refused()` for the reason given above. */
function tooShort(): NextResponse {
  return NextResponse.json(
    { ok: false, reason: "too_short" },
    { status: 422, headers: SAFE_HEADERS },
  );
}

/** FIX WAVE (2026-08-22, F3) — the same split `api/login/route.ts` gained,
 * applied here because this route had the identical shape: before this fix,
 * an unconfigured environment or an unreachable backend fell all the way
 * through to `refused()`, the SAME 401 a genuinely dead/wrong-purpose/revoked
 * token gets. That told a caller holding a perfectly good invite link that
 * their link was dead. A 503 here says nothing about whether the token is
 * good — only that the backend could not be asked — so this leaks no oracle
 * either. */
function unreachable(): NextResponse {
  return NextResponse.json(
    { ok: false, reason: "unreachable" },
    { status: 503, headers: SAFE_HEADERS },
  );
}

/** THIS ROUTE'S OWN LOGIN-CSRF DEFENCE — mirrors `api/login/route.ts`'s
 * `isCrossOriginSubmission` exactly. An absent `Origin` is allowed (a
 * same-origin `fetch` is not guaranteed to send one, and this app's own
 * server-to-server/`curl` callers never do); a present, mismatched one is
 * refused before any credential is read. See that route's own doc comment
 * for the full reasoning — it is not repeated here beyond this summary. */
function isCrossOriginSubmission(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    return new URL(origin).host !== new URL(request.url).host;
  } catch {
    return true;
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  if (isCrossOriginSubmission(request)) return refused();

  const body = await request.json().catch(() => null);
  const token = typeof body?.token === "string" ? body.token : null;
  const password = typeof body?.password === "string" ? body.password : null;
  if (!token || !password) return refused();

  let result: { token: string; expires_at: string };
  try {
    result = await setPassword(token, password);
  } catch (error) {
    // `ProductHttpError` carries the backend's real status; the three shapes
    // this route already distinguished (409, 422, 401) are unchanged. F3:
    // everything else — an unconfigured environment's plain `Error`, an
    // unreachable backend's `TypeError`, or any OTHER `ProductHttpError`
    // status this route doesn't otherwise name — used to fall through to the
    // same 401 a truly dead token gets. It no longer does: the backend never
    // actually looked at this token, so telling the caller their LINK was
    // the problem would be false.
    if (error instanceof ProductHttpError) {
      if (error.status === 409) return conflict();
      if (error.status === 422) return tooShort();
      if (error.status === 401) return refused();
    }
    return unreachable();
  }

  // Same unchecked-cast guard `api/login/route.ts` added at F4: a malformed
  // 200 with no usable `token` field must not fall through as `{ok:true}`.
  if (typeof result.token !== "string" || result.token.length === 0) return refused();

  const maxAge = cookieMaxAgeSeconds(result.expires_at);
  if (maxAge <= 0) return refused();

  // The token NEVER reaches the response body — same rule as `api/login`,
  // and never logged anywhere in this handler either.
  const jar = await cookies();
  jar.set(CLIENT_TOKEN_COOKIE, result.token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge,
    secure: process.env.NODE_ENV === "production",
  });

  return NextResponse.json({ ok: true }, { status: 200, headers: SAFE_HEADERS });
}
