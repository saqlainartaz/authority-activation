// PASSWORD LOGIN. `POST /api/login` -> backend `POST /v1/auth/login`.
//
// The SECOND door into the client-facing app, beside the magic-link exchange in
// `api/client-login/route.ts` (A6/A13 — that route is unchanged and still owns
// the onboarding-token cutover). Both doors write the SAME cookie slot
// (`CLIENT_TOKEN_COOKIE`); the backend hands out an onboarding token from one
// and a session token from the other, and `GET /v1/me` accepts either by
// dispatching on the token's own `s.` prefix. Nothing in this file, and nothing
// downstream of the cookie, ever needs to tell the two apart.
//
// THIS HANDLER NEVER REDIRECTS (R9). The login screen is a client component
// that POSTs here, so the only job of a 200 is to set the cookie and say so —
// the browser then navigates itself. A route-level redirect would be invisible
// to `fetch`'s caller and the screen would have no way to know when to move.
//
// ONE GENERIC REFUSAL, NO CAUSE ENUMERATION (Copy rule 2, D7A-13, mirrors
// `client-login`'s own `refused()`). Every failure this route can produce — a
// malformed body, a cross-origin submission, wrong credentials, an
// unreachable backend, a 200 with no usable token — answers with the SAME
// status and the SAME body. "No such account" and "wrong password" are the
// same answer here for the same reason they are the same answer on the
// backend (`src/product/auth.py`): a more specific message is an oracle
// telling an unauthenticated caller which email addresses have accounts.
// CHOICE, STATED (F2): this refusal is a 401, not a 403, even for the
// cross-origin case — one status for the whole route reads as ONE shape
// rather than "401 for bad creds, 403 for CSRF", which would itself leak
// which check failed.
//
// REVIEW FIX (2026-08-22, F1): this route used to read the two engine
// credential env vars directly and call `fetch` itself, which
// `scripts/assert-internal-bff-boundary.mjs --bff` exists to catch and did.
// It now calls `loginWithPassword` in `@/lib/product.ts`, the same
// service-credential core every other proxy in this file's family uses —
// this route no longer names either credential var anywhere in its own text.

import { NextResponse } from "next/server";
import { cookies } from "next/headers";

import { CLIENT_TOKEN_COOKIE } from "@/lib/client-session";
import { cookieMaxAgeSeconds } from "@/lib/cookie-maxage";
import { loginWithPassword, ProductHttpError } from "@/lib/product";

/** On the 200, on the refusal — same posture as `client-login`'s `SAFE_HEADERS`. */
const SAFE_HEADERS = {
  "Referrer-Policy": "no-referrer",
  "Cache-Control": "no-store",
} as const;

/** The ONE refusal for a REAL "no" from the backend. No detail, no credential,
 *  no cause distinction — Copy rule 2, unchanged by the fix below. */
function refused(): NextResponse {
  return NextResponse.json({ ok: false }, { status: 401, headers: SAFE_HEADERS });
}

/** FIX WAVE (2026-08-22, F3). Before this fix, EVERY cause below collapsed
 * into `refused()` — a real 401 from the backend, an unconfigured environment
 * (`refuseUnconfigured`'s plain `Error`), and an unreachable backend
 * (`fetch`'s own `TypeError`) all rendered the SAME "Email or password didn't
 * match" on a screen that was never shown a wrong password. That is a false
 * accusation of a healthy user, and it collapsed a question with an honest
 * answer ("we couldn't reach the server") into one that must stay ambiguous
 * ("was it this email or this password"). `src/proxy.ts`'s own
 * `resolveOnboarding` already draws exactly this line, by status rather than
 * by error type — this route now draws it the same way.
 *
 * This does NOT leak an oracle: a 503 says nothing about whether an account
 * exists, only that the backend could not be asked. Every one of this
 * route's other refusal shapes is unchanged — this adds a FOURTH shape
 * alongside the 401, it does not narrow the 401. */
function unreachable(): NextResponse {
  return NextResponse.json(
    { ok: false, reason: "unreachable" },
    { status: 503, headers: SAFE_HEADERS },
  );
}

/** The caller's IP, best-effort, for the backend's own login-attempt bookkeeping.
 *
 * Reads the platform's forwarded-for header and takes the first hop (the
 * client's own address; anything after it was appended by an intermediate
 * proxy). Returns `null` — and the caller OMITS the header entirely — when
 * absent or empty, rather than sending an empty string as if it meant
 * something.
 *
 * HONEST LIMITS, STATED RATHER THAN HIDDEN: a client-supplied `X-Forwarded-For`
 * is not verified here, and behind Vercel/Render a hop can be spoofed or
 * absent. Real IP integrity — trusting only a platform-attached value — belongs
 * to the milestone-boundary security review (see this repo's CLAUDE.md, "Hard
 * M1 non-goals" / D-05). The backend already treats an unusable value as
 * absent, so this function's job is only to forward what looks like an
 * address, never to authenticate it.
 */
function clientAddress(request: Request): string | null {
  const header = request.headers.get("x-forwarded-for");
  if (!header) return null;
  const first = header.split(",")[0]?.trim();
  return first && first.length > 0 ? first : null;
}

/** THIS ROUTE'S OWN LOGIN-CSRF DEFENCE (F2, pulled forward from Task 11).
 *
 * `Request.json()` accepts a cross-origin `text/plain`-declared body just as
 * happily as a same-origin `application/json` one — a `<form>` on an
 * attacker's page can POST here with the victim's browser attaching THEIR
 * cookies for any OTHER site, but a cross-origin form cannot forge THIS site's
 * session cookie into existence; the actual risk is the reverse of a normal
 * CSRF write: an attacker who knows a victim's throwaway credentials could
 * submit them from a page the victim is tricked into visiting, silently
 * signing the victim's browser into the ATTACKER'S account (a "login CSRF").
 * Checking `Origin` here stops that: a real cross-origin request carries an
 * `Origin` header the browser sets and scripts cannot override, so a mismatch
 * is refused before any credential is read.
 *
 * `Origin` ABSENT is ALLOWED, not refused. A same-origin `fetch` from this
 * app's own client code sends `Origin` in most browsers but is not
 * *guaranteed* to (older/`no-cors` cases), and server-to-server calls or a
 * bare `curl` never send it at all — treating absence as a failure would
 * refuse legitimate same-origin traffic while a spoofed `Origin` is not
 * something this check ever had to defend against in the first place (a
 * forged header still requires a browser willing to attach the victim's
 * cookies, which is exactly the case a MATCHING origin already covers).
 *
 * BELT AND BRACES, NOT A DUPLICATE TO REMOVE LATER: Task 11's middleware will
 * add a SITE-WIDE Origin check ahead of every mutating route. This one stays
 * even after that lands — a route-local check does not depend on the
 * middleware file being correctly wired for this specific path, the same
 * argument `next.config.ts`'s `Referrer-Policy` header makes for carrying its
 * own copy beside the exchange route's.
 */
function isCrossOriginSubmission(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    return new URL(origin).host !== new URL(request.url).host;
  } catch {
    // An Origin header that doesn't even parse as a URL cannot be confirmed
    // same-origin — refuse rather than guess.
    return true;
  }
}

// REVIEW FIX (2026-08-22, Task 10): `cookieMaxAgeSeconds` (F3) used to live
// here as this route's own private function. It moved to `@/lib/cookie-
// maxage.ts` when the invite/reset landing (`api/set-password/route.ts`)
// needed the exact same `expires_at`-derived sizing for the exact same
// `LoginResult` shape it mints — the alternative was a second, independently
// typed copy of the same arithmetic in a second file, which is exactly the
// kind of drift this repo's tests-and-arithmetic conventions exist to catch.
// The rule itself (clamp to `[0, 90 days]`, fall back to 30 days on a missing
// or unparseable `expires_at`, floor `<= 0` is the caller's own refusal to
// make) is UNCHANGED by the move — see that module's own doc comment. The
// magic-link route (`api/client-login/route.ts`) still keeps its own
// hardcoded 30-day `maxAge` and does not call this function, for the reason
// that module's doc comment gives.

export async function POST(request: Request): Promise<NextResponse> {
  if (isCrossOriginSubmission(request)) return refused();

  const body = await request.json().catch(() => null);
  const email = typeof body?.email === "string" ? body.email : null;
  const password = typeof body?.password === "string" ? body.password : null;
  if (!email || !password) return refused();

  let result: { token: string; expires_at: string };
  try {
    result = await loginWithPassword(email, password, clientAddress(request));
  } catch (error) {
    // F3: split by CAUSE, not folded into one refusal any more. A real 401
    // from the backend is the ONLY case that becomes the credential refusal
    // — its own message is still never read here, on purpose: forwarding it
    // would be a second, more detailed answer to a question Copy rule 2 says
    // has exactly one. Everything else (an unconfigured environment's plain
    // `Error`, an unreachable backend's `TypeError` from `fetch`, or any
    // non-401 `ProductHttpError`) means the backend never actually weighed in
    // on this password, and telling the user "wrong password" would be false.
    if (error instanceof ProductHttpError && error.status === 401) return refused();
    return unreachable();
  }

  // F4: an unchecked cast on the JSON body would let a malformed 200 (no
  // `token` field) fall through as `undefined` and still answer `{ok:true}`.
  if (typeof result.token !== "string" || result.token.length === 0) return refused();

  const maxAge = cookieMaxAgeSeconds(result.expires_at);
  if (maxAge <= 0) return refused();

  // The token NEVER reaches the response body — it goes into the cookie only.
  const jar = await cookies();
  // SAME cookie slot, SAME shape of options `client-login` sets on a
  // magic-link exchange (A5/A9): httpOnly, sameSite lax, path /, secure in
  // production — `maxAge` is the one attribute that now differs between the
  // two routes, and it differs on purpose (see `cookieMaxAgeSeconds` above).
  jar.set(CLIENT_TOKEN_COOKIE, result.token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge,
    secure: process.env.NODE_ENV === "production",
  });

  return NextResponse.json({ ok: true }, { status: 200, headers: SAFE_HEADERS });
}
