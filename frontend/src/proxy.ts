// THE GATE. A7/A9 (auth phase, Task 11): no application screen is reachable
// before onboarding is confirmed — URL editing included — and every
// state-changing `/api/*` request must originate from this site.
//
// ─── WHY THIS FILE IS `proxy.ts`, NOT `middleware.ts` ──────────────────────
//
// This repo is pinned to Next 16.2.11 (`package.json`), and AGENTS.md says so
// plainly: "This is NOT the Next.js you know... read the relevant guide...
// heed deprecation notices." `node_modules/next/dist/docs/01-app/03-api-
// reference/03-file-conventions/proxy.md`, read before writing anything here,
// documents that the `middleware` file convention is DEPRECATED and renamed
// to `proxy` — a codemod (`npx @next/codemod@canary middleware-to-proxy .`)
// exists for exactly this rename. `middleware.ts` still resolves (Next kept
// both `MIDDLEWARE_FILENAME` and `PROXY_FILENAME` live in
// `next/dist/build/utils.js`), but writing brand-new code against the
// deprecated name on the day it lands is precisely what that instruction
// warns against, so this phase's gate is written as `proxy.ts` exporting
// `proxy`, not `middleware.ts` exporting `middleware`.
//
// ONE MORE THING THE SAME DOC CORRECTS: the task brief this file implements
// assumed "middleware runs on the edge and cannot import a server-only
// module." That is not true for THIS proxy on THIS version — the same page
// states plainly: "Proxy defaults to using the Node.js runtime. The
// `runtime` config option is not available in Proxy files" (and is not
// exported below for that reason; setting it throws). So a server-only
// import would likely work here. It is still not done — see the cookie
// constant's own comment below for why the boundary is kept anyway.
//
// ─── A9: ORIGIN CHECK ON STATE-CHANGING API REQUESTS ───────────────────────
//
// `/api/login` and `/api/set-password` already carry their own copy of this
// exact check (`isCrossOriginSubmission`, F2/Task 10) — this site-wide check
// is ADDITIVE, not a duplicate to delete later, for the same reason
// `next.config.ts`'s `Referrer-Policy` entry gives for carrying its own copy
// beside the exchange route's: a route-local check does not depend on this
// file being correctly wired, and this file does not depend on every future
// mutating route remembering to write its own. Those two routes chose a 401
// (one shape for their whole route, Copy rule 2); this file is a coarser,
// site-wide boundary unrelated to either route's own refusal vocabulary, and
// answers with a bare 403 instead — chosen, not defaulted to, and stated
// here once rather than re-derived at each call site.
//
// ─── A7: THE ONBOARDING GATE ───────────────────────────────────────────────
//
// One authoritative source, `GET /v1/me` (`src/lib/product.ts::getMe`) —
// never a client-supplied claim, never a hidden link. This file's whole job
// is to make sure that source, and not a rendered page's own good behaviour,
// is what decides whether a screen is reachable.

import { NextResponse, type NextRequest } from "next/server";

import { getMe, ProductHttpError } from "@/lib/product";

/** The httpOnly cookie holding the raw onboarding/session token.
 *
 * MUST STAY BYTE-IDENTICAL to `CLIENT_TOKEN_COOKIE` in
 * `src/lib/client-session.ts` — that is the one thing a future editor of
 * either file must check. It is inlined here, rather than imported, because
 * that module opens with `import "server-only"`: a boundary written for
 * server components and route handlers, a different part of the request
 * lifecycle than a proxy that runs ahead of routing entirely. This file
 * needs the cookie's NAME, not anything else that module owns (not
 * `resolveClientId`, not `NoClientSession`), so inlining the one literal
 * keeps this file's coupling to that module a COMMENT a reader can verify,
 * rather than an import a bundler could resolve either way regardless of
 * whether that was the intent.
 */
const CLIENT_TOKEN_COOKIE = "aa_client_token";

/** Paths that must ALWAYS render unauthenticated, with no identity read.
 *
 * "/" gets its own additional handling below (a signed-in visitor is bounced
 * off it) — this set is for paths that receive NO gate logic at all.
 * "/set-password" is the invite/reset landing (Task 10): it authenticates
 * its OWN token via its own POST route and must never be redirected to "/"
 * for lacking the session cookie this file gates on — a fresh invite has no
 * such cookie yet.
 */
const ALWAYS_PUBLIC_PATHS = new Set<string>([
  "/refined/signin",
  "/refined/invite",
]);

/** FIX WAVE (2026-08-22, F5): `ALWAYS_PUBLIC_PATHS` is an exact-match `Set`,
 * and `/set-password/` (a TRAILING SLASH — exactly what an invite link's own
 * `<a href>` or a browser's address-bar normalisation can produce) did not
 * match it. That sent a brand-new invite through the gate below as an
 * ordinary app path with no cookie yet, which redirected to "/" and silently
 * discarded the token in the query string — a stranded invite, not a refusal
 * with a next step. Applied ONCE, before every path comparison in this file
 * (not only the public-path test), so `/onboarding/`'s own already-tolerant
 * comparison further down and this one agree on the same normalised
 * `pathname` rather than each carrying its own slash rule.
 */
function withoutTrailingSlash(pathname: string): string {
  return pathname !== "/" && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
}

function isApiPath(pathname: string): boolean {
  return pathname === "/api" || pathname.startsWith("/api/");
}

/** `/internal` is a SEPARATE operator persona (passcode header via
 * `src/lib/internal-auth.ts`, not this cookie) and is never gated here. Its
 * own API surface (`/api/internal/*`) is already covered by `isApiPath`
 * above — every API handler, internal or client, authenticates itself — so
 * this only needs to name the PAGE tree.
 */
function isInternalPagePath(pathname: string): boolean {
  return pathname === "/internal" || pathname.startsWith("/internal/");
}

/** A9's check. Mirrors `api/login/route.ts::isCrossOriginSubmission`
 * exactly — same allow-on-absence reasoning (a same-origin `fetch` is not
 * guaranteed to send `Origin`, and server-to-server/`curl` callers never
 * do), same fail-closed-on-malformed reasoning. Duplicated rather than
 * imported: that function lives in a route file, not a shared module, and
 * this file's own copy must not depend on that one's location either.
 */
function isCrossOriginWrite(request: NextRequest): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    return new URL(origin).host !== request.nextUrl.host;
  } catch {
    return true;
  }
}

type MeOutcome =
  | { kind: "ok"; onboardingComplete: boolean }
  | { kind: "unauthenticated" }
  | { kind: "unreachable" };

/** The one call this whole gate turns on. `getMe` already sets
 * `cache: "no-store"` internally (`clientFetch` in `src/lib/product.ts`), so
 * this file does not need to ask for that again.
 *
 * TWO FAILURE SHAPES, DELIBERATELY KEPT APART (RULING): the token is only
 * ever declared dead on a **401** — that is the backend saying "this
 * credential is bad," and only that answer is trusted enough to clear the
 * cookie carrying it. Every OTHER non-2xx (`ProductHttpError` with any
 * other status — a 500/502/503/504 included) is treated the SAME as a raw
 * network `TypeError` or `product.ts`'s own "not configured" throw: the
 * backend answering with a server error is not the backend vouching for the
 * token, it is the backend having a bad minute, and `clientFetch` (`src/lib/
 * product.ts`) throws a `ProductHttpError` on EVERY non-2xx alike — a 503 is
 * exactly as much a `ProductHttpError` as a 401 is, so the STATUS, not the
 * error's TYPE, is what this function must branch on. Getting this wrong
 * once already meant "a caller that conflated the two would log a user out
 * of a perfectly good session because the backend had a bad minute" — and a
 * type-only branch here (any `ProductHttpError` => dead) was exactly that
 * caller: a 500 during a deploy blip would have looked identical to a
 * revoked token and cleared a fine cookie. Fixed by reading `.status`
 * instead of only the error's class.
 */
async function resolveOnboarding(token: string): Promise<MeOutcome> {
  try {
    const me = await getMe(token);
    return { kind: "ok", onboardingComplete: me.onboarding_complete };
  } catch (error) {
    if (error instanceof ProductHttpError && error.status === 401) {
      return { kind: "unauthenticated" };
    }
    // Any other `ProductHttpError` (404, 500, 503, ...) and any non-
    // `ProductHttpError` throw (network failure, unconfigured environment)
    // land here together: "cannot verify," not "verified bad." The
    // fail-closed REDIRECT is identical either way (see the call sites
    // below) — only the cookie's fate differs, and only `unauthenticated`
    // touches it.
    return { kind: "unreachable" };
  }
}

/** The dead-cookie clear (RULING): only ever called on the "unauthenticated"
 * outcome above, never on "unreachable" — see `resolveOnboarding`'s own
 * comment for why. `maxAge: 0` and the SAME `path` the cookie was set with
 * (`api/client-login/route.ts`, `api/login/route.ts`, `api/set-password/
 * route.ts` all use `path: "/"`) — a mismatched path would leave the
 * browser's real cookie in place while this response merely claims to have
 * cleared it.
 */
function clearDeadCookie(response: NextResponse): NextResponse {
  response.cookies.set(CLIENT_TOKEN_COOKIE, "", { path: "/", maxAge: 0 });
  return response;
}

export async function proxy(request: NextRequest): Promise<NextResponse> {
  // F5: normalised once, here, ahead of every comparison below — see
  // `withoutTrailingSlash`'s own comment.
  const pathname = withoutTrailingSlash(request.nextUrl.pathname);

  // ── A9 ─────────────────────────────────────────────────────────────────
  if (isApiPath(pathname)) {
    if (
      request.method !== "GET" &&
      request.method !== "HEAD" &&
      isCrossOriginWrite(request)
    ) {
      return new NextResponse(null, { status: 403 });
    }
    // Every /api/* handler authenticates itself (client-credential routes
    // check the onboarding/session token; `/api/internal/*` checks the
    // passcode header) — this file's job on this whole subtree ends at the
    // Origin check above.
    return NextResponse.next();
  }

  // `/internal` — a different persona, a different credential. Never gated.
  if (isInternalPagePath(pathname)) return NextResponse.next();

  const token = request.cookies.get(CLIENT_TOKEN_COOKIE)?.value || null;

  // ── "/" — the login screen, or a bounce for someone already signed in ──
  if (pathname === "/" || pathname === "/refined/signin") {
    // The magic-link exchange must never be intercepted (T-07B-01-01): a
    // token in the query string is forwarded, unrendered, by `page.tsx`
    // itself to `/api/client-login`. Guarded on TRUTHINESS, not mere
    // presence (M2 fix): `page.tsx` itself does
    // `typeof raw === "string" ? raw : ""` and then `if (token)`, so a
    // `/?token=` with an EMPTY value is not actually a magic-link attempt on
    // that route either — treating an empty value as "present" here would
    // let a bare `?token=` mask a signed-in user's own bounce below,
    // stranding them on the login screen instead.
    if (request.nextUrl.searchParams.get("token")) return NextResponse.next();

    if (!token) return NextResponse.next(); // ordinary logged-out visitor

    const outcome = await resolveOnboarding(token);
    if (outcome.kind === "ok") {
      const destination = outcome.onboardingComplete ? "/refined/home" : "/refined/onboarding";
      return NextResponse.redirect(new URL(destination, request.url));
    }
    // NEVER redirect "/" to "/" — that is a loop, not a gate, and unlike
    // every other path below there is nowhere else public to send this
    // request. Render the login screen instead; only a confirmed-dead
    // token also clears the cookie (see `resolveOnboarding`'s comment) —
    // an unreachable backend leaves it alone, since the credential itself
    // was never blamed.
    const fallthrough = NextResponse.next();
    return outcome.kind === "unauthenticated" ? clearDeadCookie(fallthrough) : fallthrough;
  }

  if (ALWAYS_PUBLIC_PATHS.has(pathname)) return NextResponse.next();

  // ── A7 — every remaining page needs a confirmed identity ────────────────
  // This also covers `/confirm` (orphaned — nothing links to it) and
  // `/onboarding` itself, which needs the SAME read to know whether it
  // should even be showing (see the two branches below).
  if (!token) return NextResponse.redirect(new URL("/refined/signin", request.url));

  const outcome = await resolveOnboarding(token);
  if (outcome.kind === "unreachable") {
    // Fail closed: "cannot verify" is not "verified fine." No app screen
    // renders on the strength of a request that never got an answer — but
    // the cookie is not touched, because the credential itself is not what
    // failed.
    return NextResponse.redirect(new URL("/refined/signin", request.url));
  }
  if (outcome.kind === "unauthenticated") {
    return clearDeadCookie(NextResponse.redirect(new URL("/refined/signin", request.url)));
  }

  // M1 fix: `/onboarding/` (a trailing slash) is still "the onboarding page"
  // — an exact-only comparison let a completed client sit on `/onboarding/`
  // instead of being bounced to `/home`. The other direction was already
  // safe (an incomplete client on any OTHER spelling still gets redirected
  // to the canonical `/onboarding`, just via one extra hop), so only the
  // comparison itself needs widening, not the redirect target.
  //
  // The `|| pathname === "/onboarding/"` half is REDUNDANT since F5's fix
  // above (2026-08-22) — `pathname` is now trailing-slash-normalised before
  // this line ever runs, so that arm can no longer be true. Left in place
  // rather than deleted: it costs nothing, and this file's own history shows
  // exactly one slash-tolerance rule getting invented per bug rather than
  // shared, which is what F5 fixed at the SOURCE instead of adding a third.
  const isOnboardingPath = pathname === "/refined/onboarding";

  if (!outcome.onboardingComplete && !isOnboardingPath) {
    return NextResponse.redirect(new URL("/refined/onboarding", request.url));
  }
  if (outcome.onboardingComplete && isOnboardingPath) {
    return NextResponse.redirect(new URL("/refined/home", request.url));
  }
  return NextResponse.next();
}

// PERFORMANCE, STATED HONESTLY RATHER THAN OPTIMISTICALLY (fix-wave
// correction, I4): `<Link>`'s default prefetch originally made every gated
// page fan out into roughly 6-8 `GET /v1/me` calls before the user clicked
// anything. The approved connected-UI performance correction now sets
// `prefetch={false}` in `src/refined/navigation.tsx`, so refined sidebar and
// bottom-navigation destinations pay for the one page request the user chose,
// not speculative authenticated requests for every destination.
//
// THE SECOND HALF, NAMED RATHER THAN LEFT IMPLICIT: the no-cookie path is
// free (it returns above, before `resolveOnboarding`/`getMe` is ever
// called), but a request bearing ANY cookie shaped like this one — a
// browser's real session, a stale one, or a hand-crafted value an attacker
// is probing with — costs the engine exactly one `GET /v1/me` per request,
// with NO throttling and NO caching in front of it. At this milestone's
// scale that is accepted the same way `client-session.ts::resolveClientId`'s
// own per-request re-derivation is accepted (re-deriving from the token
// beats trusting anything cached), but it is a real, currently-open cost
// surface and not merely a style choice: rate-limiting or short-lived
// caching of this read belongs to the milestone-boundary security/scale
// review (see this repo's CLAUDE.md, "Hard M1 non-goals" / D-05), not to
// this file inventing its own ad hoc cache.
//
// MATCHER (fix-wave correction, I1/I2): the extension exclusion is ANCHORED
// to the end of the path (`\.[^/]+$`), not a bare `.*\..*` — the earlier,
// unanchored form matched a literal dot ANYWHERE in the remaining path, so
// `/api/client/atoms/<uuid>.x/decision` (a dot in a MIDDLE segment, not a
// trailing extension) was silently treated as a static asset and skipped
// the gate entirely, meaning A9's Origin check never ran for that whole
// URL class. The extension check ALSO carves out `rsc` by name
// (`(?!rsc$)`): Next appends an `.rsc` suffix to some navigation/prefetch
// requests, and that suffix is not a static asset — a page's `.rsc`
// variant is exactly the kind of request this gate must still run on, not
// an exemption for it. `_next` (both its `static` and `image` subtrees) and
// `favicon.ico` are excluded by name, unrelated to the extension rule.
//
// A SECOND, INDEPENDENT ENTRY, added rather than folded into the first: the
// page-shaped rule above still starts with a negative lookahead keyed off
// path segments, and `/api/*` is deliberately NOT one of its exclusions —
// but rather than lean on that single rule to carry both jobs (exclude
// assets AND guarantee API coverage), `/api/:path*` is listed a second time,
// explicitly, so A9's Origin check reaching every `/api/*` write does not
// depend on correctly reasoning through the first rule's negative lookahead
// at all. Matcher entries are ORed: a path matches if either entry matches.
//
// VERIFIED AGAINST THE BUILT REGEXP, not merely reasoned about — see the
// fix-wave section of `task-11-report.md` for the exact command and output.
export const config = {
  matcher: [
    "/((?!_next|favicon\\.ico|.*\\.(?!rsc$)[^/]+$).*)",
    "/api/:path*",
  ],
};
