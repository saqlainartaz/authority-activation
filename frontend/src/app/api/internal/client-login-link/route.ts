// THE LOGIN-LINK GENERATOR. Passcode-gated, operator-only, and the ONLY place in
// this frontend that ever sees a raw client credential.
//
// It now issues the BACKEND's onboarding token instead of `issueClientToken`'s
// home-grown HMAC. The retired scheme signed a `{clientId}.{expiry}` payload with
// `CLIENT_LOGIN_SECRET` and knew nothing about the API's own tokens, so a link it
// produced stayed valid after the operator revoked the real one — two credential
// systems, and the stale one is the one that gets trusted (D7A-12). There is one
// identity now and the API issues it.
//
// THREE KINDS OF LINK, ONE ROUTE (fix wave, 2026-08-22, F1-console). Before this
// fix the request body took only a `clientId` and every mint defaulted to
// `purpose="onboarding"` — the console had no way to ask the backend for an
// `invite` or a `reset` link, and `POST /v1/auth/set-password` refuses any token
// whose purpose is not `("invite", "reset")` by design. That made `/set-password`
// reachable only by hand-crafted curl: the operator console could mint a magic
// link but never the one credential that actually leads there. The caller now
// names which kind it wants; the URL built below is the one difference between
// the three — see `landingUrlFor` below.
//
// ─── THE LINK CARRIES ONE QUERY PARAMETER AND IT IS `token` ─────────────────
//
// NO `client_id`, and no second parameter of any kind. This is a privilege
// escalation, not a tidiness rule (T-07A-06-04): four service-credential proxies
// in this app take a `client_id` in their upstream path, and the Next server
// attaches the service key to those calls itself. A caller who could pair TENANT
// A'S TOKEN with TENANT B'S ID in a link would get an authenticated read — and
// write — against the wrong tenant. The tenant is re-derived from the token on
// every request instead (`lib/client-session.ts::resolveClientId`, and
// `docs/DECISIONS.md`, entry 3 of plan 07A-02), which makes it unforgeable by
// construction: it is whatever the API says the presented token belongs to.
//
// ─── WHY TWO UPSTREAM CALLS AND NOT ONE ─────────────────────────────────────
//
// A token belongs to a PERSON, not to a client — `onboarding_tokens.user_id` is
// NOT NULL behind a composite foreign key, and the issue route is
// `POST /v1/clients/{client_id}/users/{user_id}/onboarding-token`. The console
// sends only a `clientId` (it has a client picker and no person picker), so the
// person is resolved here: `GET /v1/clients/{id}/users` answers OLDEST FIRST, and
// the first row is the first person the operator prepared for this client. If
// nobody has been prepared, the request is REFUSED and the refusal names the
// missing step — a person has to exist before anybody can be handed a link
// (ONBRD-01's precondition, `users.py`'s own opening paragraph).
//
// NOTHING IS FABRICATED TO GET PAST THAT REFUSAL. Creating the person here would
// mean inventing an email address, and `uq_users_client_email` makes that invented
// value permanent for the tenant. An honest refusal naming the missing step beats
// a link issued to a person who does not exist.

import { checkInternalPasscode, unauthorized } from "@/lib/internal-auth";
import {
  forwardProductError,
  issueOnboardingTokenAsService,
  listClientUsers,
  type OnboardingTokenPurpose,
} from "@/lib/product";

/** Exactly the three literals `set-password` and this token family know about.
 * Anything else is refused with the route's own 422 shape (F1-console) —
 * never widened into a fourth "kind" the backend has no purpose for. */
const VALID_PURPOSES = new Set<OnboardingTokenPurpose>(["onboarding", "invite", "reset"]);

/** The one difference between the three kinds of link this route mints.
 *
 * `invite`/`reset` land on `/set-password?token=...` — the credential-setting
 * screen `api/set-password/route.ts` redeems. `onboarding` is UNCHANGED: the
 * existing magic-link exchange at `/api/client-login?token=...`, byte-identical
 * to what this route produced before this fix (rule d below).
 */
function landingUrlFor(origin: string, purpose: OnboardingTokenPurpose, token: string): string {
  const encoded = encodeURIComponent(token);
  if (purpose === "invite" || purpose === "reset") {
    return `${origin}/refined/invite?token=${encoded}`;
  }
  return `${origin}/api/client-login?token=${encoded}`;
}

export async function POST(request: Request) {
  if (!checkInternalPasscode(request)) return unauthorized();
  const body = await request.json();
  const { clientId } = body;
  if (!clientId || typeof clientId !== "string") {
    return Response.json({ error: "clientId required" }, { status: 422 });
  }

  // Defaults to "onboarding" so a request that names no purpose at all — every
  // caller before this fix, and any caller after it that doesn't care — gets
  // EXACTLY today's magic link (rule d). Anything present but not one of the
  // three literals is refused rather than silently coerced.
  const rawPurpose = body.purpose;
  const purpose: OnboardingTokenPurpose = rawPurpose === undefined ? "onboarding" : rawPurpose;
  if (!VALID_PURPOSES.has(purpose)) {
    return Response.json(
      { error: "purpose must be one of: onboarding, invite, reset" },
      { status: 422 },
    );
  }

  try {
    const users = await listClientUsers(clientId);
    if (users.length === 0) {
      // Operator vocabulary on an operator surface, and it names the fix. This is
      // NOT the client-facing 401 sentence: nobody's link has expired, the client
      // simply has no person to issue one to.
      return Response.json(
        {
          error:
            "This client has nobody to send a link to yet. Prepare a person for " +
            "them first (POST /v1/clients/{id}/users), then generate the link.",
        },
        { status: 409 },
      );
    }

    // The ONE place a raw credential exists in this frontend. It goes straight
    // into the URL below and nowhere else: not into a log, not into a variable
    // that outlives this function, not into an error message. See the annotation
    // on `issueOnboardingTokenAsService`.
    const { token } = await issueOnboardingTokenAsService(clientId, users[0].id, purpose);
    const origin = new URL(request.url).origin;
    return Response.json({ url: landingUrlFor(origin, purpose, token) });
  } catch (error) {
    // `forwardProductError` never forwards `ProductHttpError.message` — it carries
    // the upstream path and the raw response body, and on the issue call that body
    // is the response the raw token came in. Only FastAPI's own `detail` crosses.
    return forwardProductError(error);
  }
}
