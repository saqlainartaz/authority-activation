// Shared cookie-`maxAge` derivation for the two credential-issuing BFF routes
// (`api/login/route.ts`, `api/set-password/route.ts`). Factored out of
// `api/login/route.ts` at Task 10 (2026-08-22) — the invite/reset landing
// mints the SAME shape of session (`LoginResult`, `token` + `expires_at`) that
// password login does, so its cookie needs the SAME sizing rule rather than a
// second, independently-typed copy of the same arithmetic. `api/login/route.ts`
// introduced this at F3; nothing about the rule itself changed in the move.
//
// READS NOTHING FROM THE ENVIRONMENT, CALLS NO CREDENTIAL. This module never
// needs to appear in `scripts/assert-internal-bff-boundary.mjs --bff`'s "only
// server-only product/engine helpers read engine credentials" allowlist —
// unlike `lib/product.ts` and `lib/engine.ts`, it never reads either engine
// credential variable and opens with no `"server-only"` import, because
// there is no credential here to protect. (That assertion is a plain text
// scan, not an AST check — this comment deliberately avoids spelling either
// variable's name, the same gotcha `api/login/route.ts`'s own F1 fix
// documents.)

const THIRTY_DAYS_SECONDS = 60 * 60 * 24 * 30;
const NINETY_DAYS_SECONDS = 60 * 60 * 24 * 90;

/** The cookie's `maxAge`, DERIVED FROM THE CREDENTIAL'S OWN `expires_at`.
 *
 * The backend session is sliding-30-day-inactivity with a 90-day absolute
 * ceiling; a cookie hardcoded to 30 days would log a daily-active user out on
 * day 30 with a session the server still honours (`expires_at` reflects the
 * 90-day ceiling, not the 30-day inactivity window, so an active user's
 * `expires_at` keeps moving out even though a fixed 30-day cookie would not
 * have). This clamps only the HIGH end, to 90 days — `Math.min(secondsRemaining,
 * NINETY_DAYS_SECONDS)` below — and falls back to the old 30-day constant only
 * when `expires_at` is missing or unparseable; it never returns a value larger
 * than the credential's own ceiling.
 *
 * CORRECTED (fix wave, 2026-08-22, M2-hygiene): this doc used to say the
 * function "clamps to `[0, 90 days]`" — false. There is no low-end clamp
 * anywhere in this function; `secondsRemaining` can and does come back
 * negative for an already-expired credential, and this function returns that
 * negative value UNCHANGED. A result `<= 0` means the credential is already
 * expired by the time this response is built; every caller refuses rather
 * than setting a cookie that would immediately misstate its own freshness —
 * that floor check is the CALLER'S OWN decision (each route's `maxAge <= 0`
 * guard), not something this function enforces itself, so a future caller of
 * this function from elsewhere should not assume the returned value is
 * always usable as-is without repeating that check.
 *
 * THE MAGIC-LINK COOKIE (`api/client-login/route.ts`) STAYS OUTSIDE THIS
 * FUNCTION, DELIBERATELY. It keeps its own hardcoded 30-day `maxAge` — an
 * onboarding token carries no `expires_at` to derive anything tighter from,
 * and 30 days was always an upper-bound convenience rather than a real expiry
 * for that credential family. Do not "fix" that route to call this one; the
 * credential it carries is not the same shape as `LoginResult`.
 */
export function cookieMaxAgeSeconds(expiresAt: unknown): number {
  if (typeof expiresAt !== "string") return THIRTY_DAYS_SECONDS;
  const expiryMs = Date.parse(expiresAt);
  if (Number.isNaN(expiryMs)) return THIRTY_DAYS_SECONDS;
  const secondsRemaining = Math.floor((expiryMs - Date.now()) / 1000);
  return Math.min(secondsRemaining, NINETY_DAYS_SECONDS);
}
