// /api/client/campaigns — TWO VERBS WITH TWO DIFFERENT CREDENTIAL FAMILIES, the
// same split `content-items/route.ts` carries and for the same reason:
//
//   * `GET`  is CLIENT-CREDENTIAL. `GET /v1/campaigns` derives the tenant from
//     the token and excludes the hidden system-provisioned campaign by id.
//   * `POST` is SERVICE-PROXIED — `campaigns.py` is `require_service_token`, so
//     the create needs the service key with the tenant resolved server-side
//     (D7A-09, D7A-12). `period_id` and `client_name` are filled by
//     `lib/compose-provisioning.ts`; `override` is never sent.
//
// `default_period_label` IS STRIPPED FROM THE GET RESPONSE. It names the hidden
// default campaign's period (`"Default (system-provisioned)"`), which is an
// accepted disclosure ON THE WIRE BETWEEN TWO SERVERS (T-07A-02-07) and has no
// business in a browser: it is an internal provisioning detail, and a client
// screen that could read it could also render it. `lib/compose-provisioning.ts`
// reads it from the same envelope SERVER-SIDE, which is the whole reason it is
// published rather than duplicated as a literal.
//
// `client_id` IS STRIPPED TOO, and that is a decision rather than an oversight.
// The envelope publishes it so THIS SERVER can aim the four service-credential
// proxies (`resolveClientId`), and it is re-derived from the token on every
// request. A browser has no path that takes a tenant id — every `/api/client/*`
// route carries no tenant segment by construction (D7A-14) — so publishing it
// would put an identifier in a browser that nothing there can use, and it would
// be the one `client_id` property this tree constructs.
//
// `active_cap` IS CARRIED THROUGH DELIBERATELY. The cap is enforced in the
// backend (D7A-10) and a screen disabled on a hardcoded `3` either blocks a legal
// create or offers one the backend refuses. Read the number off the wire.

import { clientToken } from "@/lib/client-session";
import { createClientCampaign, PERIOD_CONFLICT_CODE } from "@/lib/compose-provisioning";
import {
  expiredLinkResponse,
  forwardProductError,
  listClientCampaigns,
  ProductHttpError,
  readJsonObject,
} from "@/lib/product";

/** `YYYY-MM-DD`, the only shape a `date` column accepts through JSON. */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** THE ONE 409 THIS SURFACE MAY SPEAK, and why it replaces the server's.
 *
 * `create_campaign` raises exactly one 409 — the play-eligibility gate — and its
 * text is written for an operator: it names the MISSING ATOM TYPES and tells the
 * reader to *"resend with `override`: true"*. IC-10.2 keeps atom-type jargon off
 * the client surface and Copy rule 3 keeps the override affordance off it, so
 * forwarding that sentence verbatim would put both in a browser (T-07A-04-06).
 * `createPeriodAsService`'s `uq_periods_client_level_start` 409 is the other one
 * reachable through here, and it names a period level and a date — a concept the
 * client never chose. Both collapse to this.
 *
 * NOT REACHABLE FROM A CURRENT SCREEN: the create form reads
 * `/api/client/console` and offers only plays with `eligible: true`. This is the
 * stale-screen answer, and "refresh" is the honest remedy because the console's
 * verdicts are computed per request and stored nowhere (D-11), so a refresh
 * genuinely re-reads them.
 *
 * The cap's 422 and the play catalogue's 422 are NOT touched — both are written
 * for a client and both name numbers or slugs the client needs.
 */
const CAMPAIGN_CONFLICT_SENTENCE =
  "We couldn't start that campaign. Refresh the page and try again — if it keeps happening, ask us.";

/** Is this 409 the one `compose-provisioning` authored for a client to read? */
function isPeriodConflict(detail: unknown): boolean {
  return (
    Boolean(detail) &&
    typeof detail === "object" &&
    (detail as { code?: unknown }).code === PERIOD_CONFLICT_CODE
  );
}

export async function GET() {
  const token = await clientToken();
  if (!token) return expiredLinkResponse();
  try {
    const envelope = await listClientCampaigns(token);
    // Built key by key rather than spread-minus-one, so adding a field to the
    // wire model does not silently publish it to the browser.
    return Response.json({
      campaigns: envelope.campaigns,
      active_count: envelope.active_count,
      active_cap: envelope.active_cap,
      generated_at: envelope.generated_at,
    });
  } catch (e) {
    return forwardProductError(e);
  }
}

export async function POST(request: Request) {
  const token = await clientToken();
  if (!token) return expiredLinkResponse();
  const raw = await readJsonObject(request);

  // ALLOWLIST: play_id, starts_on, ends_on, idempotency_key. The caller key is
  // actually chooses (D7A-09). `period_id` and `client_name` are filled
  // server-side; `override` is NEVER constructed anywhere in this tree, so D-12's
  // 409 — whose text tells the reader to "resend with `override`: true" — is
  // unreachable from a client surface by construction rather than by a screen
  // choosing not to offer it (D7A-09.3, T-07A-04-03).
  //
  // THE TWO DATES ARE VALIDATED HERE AND THE PLAY IS NOT, and the asymmetry is
  // deliberate. An unknown `play_id` earns a 422 from the catalogue that names
  // every valid slug, which is strictly better than anything this layer could
  // say. The dates, by contrast, are needed BEFORE the create — they decide which
  // period the campaign hangs from — so a malformed one would otherwise surface
  // as a refusal naming `period_id`, a field the client never sent.
  if (typeof raw.starts_on !== "string" || !ISO_DATE.test(raw.starts_on)) {
    return Response.json({ error: "starts_on must be a date (YYYY-MM-DD)" }, { status: 422 });
  }
  if (typeof raw.ends_on !== "string" || !ISO_DATE.test(raw.ends_on)) {
    return Response.json({ error: "ends_on must be a date (YYYY-MM-DD)" }, { status: 422 });
  }
  if (typeof raw.idempotency_key !== "string") {
    return Response.json({ error: "idempotency_key must be a string" }, { status: 422 });
  }

  try {
    const campaign = await createClientCampaign(token, {
      play_id: raw.play_id,
      starts_on: raw.starts_on,
      ends_on: raw.ends_on,
      idempotency_key: raw.idempotency_key,
    });
    // 201, matching `create_campaign`'s own status. `persona_snapshot` carries the
    // client's own onboarding answers and is an operator-facing point-in-time
    // record, so it does not cross; `play_override_*` describes an escalation this
    // surface cannot perform and would be the only mention of it in the browser.
    return Response.json(
      {
        campaign_id: campaign.id,
        period_id: campaign.period_id,
        play_id: campaign.play_id,
        objective: campaign.objective,
        starts_on: campaign.starts_on,
        ends_on: campaign.ends_on,
        created_at: campaign.created_at,
        trust: campaign.trust,
      },
      { status: 201 },
    );
  } catch (e) {
    if (e instanceof ProductHttpError && e.status === 409 && !isPeriodConflict(e.detail)) {
      return Response.json({ error: CAMPAIGN_CONFLICT_SENTENCE }, { status: 409 });
    }
    return forwardProductError(e);
  }
}
