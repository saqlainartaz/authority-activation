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
import type { OnboardingConfirm } from "@/lib/product";
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

  const allowed = new Set([
    "audience",
    "never_say",
    "voice_constraints",
    "tone",
    "tldr",
    "insight",
    "pain_point",
    "objection",
    "proof_point",
    "quote",
    "terminology",
  ]);
  const unknown = Object.keys(raw).filter((key) => !allowed.has(key));
  if (unknown.length) {
    return Response.json(
      { detail: `Unknown onboarding field(s): ${unknown.join(", ")}.` },
      { status: 422 },
    );
  }

  // THE ALLOWLIST: five keys, built one at a time. `OnboardingConfirmRequest`
  // sets `extra="forbid"`, so spreading the browser's body would let a caller
  // name `actor` and take a 422 — or worse, name it correctly and get away with
  // it if the model ever widened.
  //
  // ONLY THE KEYS THE BROWSER ACTUALLY SENT ARE FORWARDED, and the absence is
  // load-bearing: every list defaults to `[]` on the Python side, so filling a
  // missing key with `[]` here would silently CLEAR a guardrail the client had
  // already confirmed. The API's own 422 (03-15 F-V1: a re-confirmation that
  // omits a previously-answered list is refused, naming the field) is the
  // enforcement, and it can only fire if the key stays absent. The single cast
  // below is what lets a partial body through to that refusal.
  const forwarded: Partial<OnboardingConfirm> = {};
  if ("audience" in raw) forwarded.audience = raw.audience as string[];
  if ("never_say" in raw) forwarded.never_say = raw.never_say as string[];
  if ("voice_constraints" in raw) {
    forwarded.voice_constraints = raw.voice_constraints as string[];
  }
  if ("tone" in raw) forwarded.tone = raw.tone as string[];
  if ("tldr" in raw) forwarded.tldr = raw.tldr as string[];
  if ("insight" in raw) forwarded.insight = raw.insight as string[];
  if ("pain_point" in raw) forwarded.pain_point = raw.pain_point as string[];
  if ("objection" in raw) forwarded.objection = raw.objection as string[];
  if ("proof_point" in raw) forwarded.proof_point = raw.proof_point as string[];
  if ("quote" in raw) forwarded.quote = raw.quote as string[];
  if ("terminology" in raw) forwarded.terminology = raw.terminology as string[];

  try {
    return Response.json(await putOnboarding(token, forwarded as OnboardingConfirm));
  } catch (e) {
    return forwardProductError(e);
  }
}
