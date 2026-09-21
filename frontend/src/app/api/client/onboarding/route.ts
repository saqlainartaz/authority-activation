// GET/PUT /api/client/onboarding -> GET/PUT /v1/onboarding
//
// THE BROWSER'S ONLY DOOR TO THE ONBOARDING SURFACE. Both credentials are
// attached server-side by `lib/product.ts` (D7A-12): a valid onboarding token
// with no `X-API-Key` is a 401, so a browser-direct design would have to ship
// the service key to a browser.
//
// NO `actor` IS ACCEPTED FROM THE BROWSER, and the consequence is recorded
// rather than papered over. `OnboardingConfirmRequest.actor` defaults to
// `operator:shared-passcode`, so a client confirming their own details lands in
// the audit trail attributed to an operator. That is wrong, and the fix is a
// BACKEND one-liner — stamp the actor from `identity.user_id` inside the route,
// the way `product/api/generation.py` already does with `CLIENT_ACTOR_PREFIX`.
// It is NOT fixed by inventing an actor string here: an actor value lands in an
// append-only ledger nobody may rewrite, and a caller who can name the actor
// can attribute their own write to somebody else (T-07A-04-04).

import { clientToken } from "@/lib/client-session";
import { buildCompatibleConfirm, mergeOnboardingResponses } from "@/lib/onboarding-profile";
import type { OnboardingPrefill, OnboardingQuestionResponse } from "@/lib/product";
import {
  expiredLinkResponse,
  forwardProductError,
  getOnboarding,
  putOnboarding,
  readJsonObject,
} from "@/lib/product";

export async function GET() {
  const token = await clientToken();
  if (!token) return expiredLinkResponse();
  try {
    return Response.json(await getOnboarding(token));
  } catch (e) {
    return forwardProductError(e);
  }
}

export async function PUT(request: Request) {
  const token = await clientToken();
  if (!token) return expiredLinkResponse();
  const raw = await readJsonObject(request);

  const allowed = new Set(["responses", "merge"]);
  const unknown = Object.keys(raw).filter((key) => !allowed.has(key));
  if (unknown.length) {
    return Response.json(
      { detail: `Unknown onboarding field(s): ${unknown.join(", ")}.` },
      { status: 422 },
    );
  }

  if (!Array.isArray(raw.responses)) {
    return Response.json({ detail: "responses must be a list." }, { status: 422 });
  }
  if (raw.merge !== undefined && typeof raw.merge !== "boolean") {
    return Response.json({ detail: "merge must be a boolean." }, { status: 422 });
  }

  let prefill: OnboardingPrefill;
  try {
    prefill = await getOnboarding(token);
  } catch (e) {
    return forwardProductError(e);
  }

  let forwarded;
  try {
    // A Business DNA section save sets `merge`; the server then combines only
    // those validated edits with the authoritative current questionnaire.
    // Full onboarding confirmation replaces the questionnaire as before. Both
    // paths carry forward legacy-only lists, so neither can erase guardrails or
    // knowledge the new packets do not own. The adapter reconstructs exact
    // fields and never spreads browser data, keeping actor and tenant identity
    // outside this boundary.
    const responses = raw.merge === true
      ? mergeOnboardingResponses(prefill, raw.responses as OnboardingQuestionResponse[])
      : raw.responses as OnboardingQuestionResponse[];
    forwarded = buildCompatibleConfirm(prefill, responses);
  } catch (e) {
    return Response.json(
      { detail: e instanceof Error ? e.message : "Invalid onboarding responses." },
      { status: 422 },
    );
  }

  try {
    return Response.json(await putOnboarding(token, forwarded));
  } catch (e) {
    return forwardProductError(e);
  }
}
