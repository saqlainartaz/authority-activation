import { cookies } from "next/headers";

import { CLIENT_TOKEN_COOKIE } from "@/lib/client-session";
import { logoutSession } from "@/lib/product";

/** Ends the browser's client session.
 *
 * FIX WAVE (2026-08-22, F2): this used to ONLY clear the cookie — it never
 * told the backend the session was over, so a signed-out browser's token
 * stayed valid server-side for up to the 90-day absolute ceiling
 * (`cookie-maxage.ts`). Now it also calls `POST /v1/auth/logout`, which
 * revokes the presented session, BEFORE the cookie is cleared.
 *
 * BEST-EFFORT, ON PURPOSE, AND ORDERED THAT WAY: clearing the browser's
 * cookie must never depend on the backend being reachable — a client who
 * clicks "sign out" during an outage still has to end up signed out of THIS
 * browser, even if the server-side session outlives them a little longer.
 * Any throw from `logoutSession` is swallowed, including the 401 a LEGACY
 * ONBOARDING TOKEN produces here: that token carries no session row for this
 * route to revoke (see `logoutSession`'s own doc comment), and that is an
 * expected shape during the password-login cutover, not a failure to report.
 */
export async function POST(): Promise<Response> {
  const jar = await cookies();
  const token = jar.get(CLIENT_TOKEN_COOKIE)?.value;
  if (token) {
    try {
      await logoutSession(token);
    } catch {
      // Swallow — see the doc comment above. Nothing to log: this is not an
      // unexpected condition, and the raw token must never reach a log line
      // (the same rule `issueOnboardingTokenAsService` states explicitly).
    }
  }
  jar.delete(CLIENT_TOKEN_COOKIE);

  return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}
