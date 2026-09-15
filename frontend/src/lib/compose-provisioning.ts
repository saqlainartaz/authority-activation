// Server-only provisioning for the compose flow: the sequence that keeps
// `PLAN-04` true when a client says "just write one post".
//
// PLAN-04 IS THE CONSTRAINT THIS FILE EXISTS FOR. A content item cannot exist
// without a campaign — enforced by a composite NOT NULL foreign key AND by the
// absence of any URL that creates a campaign-free one. There is deliberately no
// `POST /v1/content-items`; the only route that brings an item into existence
// keeps the campaign in its path. So a standalone post needs a campaign, a
// campaign needs a period, and D7A-11 says both are provisioned SERVER-SIDE,
// hidden from the client's own list, with the play taken from `console` rather
// than from a constant.
//
// THE SENTINEL IS NEVER HARDCODED HERE. `default_period_label` arrives on the
// `GET /v1/campaigns` envelope — the same call that yields `client_id`, so one
// request answers both "who is this token" and "what does the hidden period call
// itself". `src/product/defaults.py` owns the spelling and publishes it for
// exactly this reason (an accepted disclosure, T-07A-02-07); a literal in this
// file would be a second spelling of a value the backend defines.
//
// `override` IS NEVER SENT. `CampaignCreate.override` defaults to `false`;
// nothing here sets it, threads it or accepts it. D-12's 409 is written for an
// operator — *"…or resend with `override: true`"* — and both halves of that
// sentence are operator instructions, so it is unreachable from a client surface
// BY CONSTRUCTION rather than by a screen choosing not to offer it (D7A-09).

import "server-only";

import type { PeriodCreate, ServiceCampaign } from "./product";
import {
  clientConsole,
  createCampaignAsService,
  createContentItemAsService,
  createPeriodAsService,
  getOnboarding,
  listCampaignsAsService,
  listClientCampaigns,
  listPeriodsAsService,
  ProductHttpError,
  type Period,
} from "./product";

// **UNREACHABLE FROM A BROWSER SINCE PHASE 8, AND NOT DELETED HERE (2026-08-22,
// Plan D-lite).** Nothing in this tree POSTs `/api/client/content-items`:
// `useStartPost` routes to `/compose`, and the item is created by the FIRST CHAT
// TURN, server-side — `product/api/generation.py::_chat_content_item` writes a
// standalone row with `campaign_id=None` and `objective` set to the task, so the
// hidden period-and-campaign provisioning below satisfies a NOT NULL that
// migration 0015 removed. That includes the cap-422 gap documented further down,
// which therefore cannot fire from any live path.
//
// Left in place because deleting it is Pass 2 / Plan C (spec
// docs/superpowers/specs/2026-08-20-campaign-removal-and-softening-design.md),
// which removes the campaigns table, the routes and the orphaned `/campaigns`
// page together. `createClientCampaign` below is a DIFFERENT matter: the
// campaigns screen still calls it through `/api/client/campaigns`, so it is live
// until that page goes.

/** `YYYY-MM-DD` for a UTC date, matching the `date` columns on the Python side. */
function isoDate(year: number, monthIndex: number, day: number): string {
  const month = String(monthIndex + 1).padStart(2, "0");
  return `${year}-${month}-${String(day).padStart(2, "0")}`;
}

/** The calendar year the hidden default period covers.
 *
 * UTC, and that matters: `create_campaign` takes its `today` from
 * `datetime.now(UTC).date()` for the cap and the containment check, so a local
 * clock here could disagree about which year it is either side of midnight and
 * provision a period that does not contain "today" on the server.
 */
function currentUtcYear(): number {
  return new Date().getUTCFullYear();
}

/** Does `period` fully contain `[startsOn, endsOn]`?
 *
 * String comparison, and it is exact rather than lucky: both sides are
 * `YYYY-MM-DD`, which is lexicographically ordered the same way it is
 * chronologically ordered. `new Date(...)` would introduce a timezone question
 * that these values do not have.
 */
function contains(period: Period, startsOn: string, endsOn: string): boolean {
  return period.starts_on <= startsOn && period.ends_on >= endsOn;
}

// ---------------------------------------------------------------------------
// D7A-11: the hidden default campaign
// ---------------------------------------------------------------------------

/** The client's hidden default campaign, provisioned if it is not there yet.
 *
 * Four steps, and each one reads before it writes so a second call is a no-op:
 *
 *   1. `GET /v1/campaigns` — the tenant AND the sentinel label, one call.
 *   2. the period bearing that label, or create it: `level="year"`, this
 *      calendar year. YEARLY AND NOT MONTHLY on purpose — a monthly default
 *      mints a new hidden period, and therefore a new hidden campaign, every
 *      month: twelve rows a year per client for the exclusion filter to keep
 *      missing (`src/product/defaults.py` carries the full argument).
 *   3. a campaign on that period, or create one — play from
 *      `console.selected_play_id`, never a constant. The fallback play's
 *      `required_atom_types` is empty BY CONSTRUCTION, so that call can never
 *      fail to answer.
 *   4. return the ids.
 *
 * KNOWN GAP, AND IT IS A BACKEND FIX RATHER THAN SOMETHING TO WORK AROUND HERE.
 * `create_campaign`'s cap check is `active_count >= MAX_ACTIVE_CAMPAIGNS`, and
 * `_visible_active_campaign_count` excludes sentinel-period campaigns from the
 * COUNT but the check itself is not exempt for the row being written. So a client
 * who already has three active campaigns of their own and has never used the
 * standalone flow gets the cap's 422 when step 3 runs — a message about campaigns
 * they DID create, refusing one they cannot see. The one-line fix is in
 * `campaigns.py`: skip the cap when the resolved period's label is
 * `SYSTEM_PERIOD_LABEL`, which is already loaded at that point in the handler.
 * Not papered over here: swallowing that 422 and reusing one of the client's own
 * campaigns would silently file a standalone post under a campaign they chose.
 */
export async function ensureDefaultCampaign(token: string): Promise<{
  clientId: string;
  campaignId: string;
}> {
  const envelope = await listClientCampaigns(token);
  const clientId = envelope.client_id;
  const sentinel = envelope.default_period_label;

  const year = currentUtcYear();
  const startsOn = isoDate(year, 0, 1);
  const endsOn = isoDate(year, 11, 31);

  const periods = await listPeriodsAsService(clientId);
  let period = periods.find((p) => p.label === sentinel && contains(p, startsOn, endsOn));
  if (!period) {
    const body: PeriodCreate = {
      level: "year",
      starts_on: startsOn,
      ends_on: endsOn,
      label: sentinel,
    };
    period = await createPeriodAsService(clientId, body);
  }

  const campaigns = await listCampaignsAsService(clientId);
  const existing = campaigns.find((c) => c.period_id === period.id);
  if (existing) return { clientId, campaignId: existing.id };

  const console_ = await clientConsole(clientId);
  const created = await createCampaignAsService(clientId, {
    period_id: period.id,
    play_id: console_.selected_play_id,
    client_name: await clientDisplayName(token),
    starts_on: period.starts_on,
    ends_on: period.ends_on,
    idempotency_key: `default-campaign-${year}`,
  });
  return { clientId, campaignId: created.id };
}

/** A standalone post's content item, with the campaign guaranteed first.
 *
 * `assetKind` is OPTIONAL rather than the required `string` the plan's
 * `<interfaces>` typed, and the difference is deliberate: `ContentItemCreate`
 * defaults it to `"linkedin_post"` on the Python side, so an omitted key applies
 * the API's own default while a default invented here would be a second spelling
 * of it — the same rule this plan follows for the sentinel label. `undefined`
 * disappears in `JSON.stringify`, so the key genuinely does not reach the wire.
 */
export async function createStandaloneItem(
  token: string,
  idempotencyKey: string,
  assetKind?: string,
): Promise<{ contentItemId: string; campaignId: string | null }> {
  const { clientId, campaignId } = await ensureDefaultCampaign(token);
  const item = await createContentItemAsService(clientId, campaignId, {
    asset_kind: assetKind,
    idempotency_key: idempotencyKey,
  });
  return { contentItemId: item.id, campaignId: item.campaign_id };
}

/** A post the client CHOSE a campaign for — IC-10.6's optional end-of-compose step.
 *
 * **WHY THE BROWSER MAY NAME A CAMPAIGN HERE AND MAY NOT NAME A TENANT.** The two
 * look alike and are not. A `client_id` from a browser is a tenant selector and is
 * categorically refused (D-07, T-07A-04-05): nothing verifies it, so a forged
 * cookie plus a guessed id is a cross-tenant write. A `campaign_id` is checked
 * against `GET /v1/campaigns` FOR THIS TOKEN before it is used, so the only ids
 * that survive are ones the API itself just said belong to the presented token.
 * An id from another tenant, an invented one, and the hidden default — which that
 * list excludes by id — all meet the same 422 and reach no write.
 *
 * THE CHECK IS A MEMBERSHIP TEST AND NOT A FORMAT TEST, deliberately. A uuid-shaped
 * string is not evidence of anything; the client's own list is.
 *
 * THERE IS STILL NO WAY TO CREATE A CAMPAIGN-FREE ITEM. `PLAN-04` holds either way:
 * this function requires a campaign and `createStandaloneItem` provisions the hidden
 * one. Declining to choose reaches the second; there is no third path and no value
 * meaning "none".
 */
export async function createItemInCampaign(
  token: string,
  campaignId: string,
  idempotencyKey: string,
  assetKind?: string,
): Promise<{ contentItemId: string; campaignId: string | null }> {
  const envelope = await listClientCampaigns(token);
  if (!envelope.campaigns.some((campaign) => campaign.campaign_id === campaignId)) {
    // 422 rather than 404: the id may well exist, and saying which of the two it is
    // would answer a question about another tenant's rows. `ProductHttpError` so it
    // travels back through the same `forwardProductError` arm as a real refusal and
    // lands on IC-14's "the server said no" class with no retry control.
    throw new ProductHttpError(
      "compose-provisioning: campaign_id is not one of this client's own campaigns",
      422,
      {
        message:
          "We couldn't file this post under that campaign. Refresh the page and pick it again.",
      },
    );
  }
  const item = await createContentItemAsService(envelope.client_id, campaignId, {
    asset_kind: assetKind,
    idempotency_key: idempotencyKey,
  });
  return { contentItemId: item.id, campaignId: item.campaign_id };
}

// ---------------------------------------------------------------------------
// D7A-09: the campaign the CLIENT creates
// ---------------------------------------------------------------------------

/** `client_name`, from the client's own record and never from the browser.
 *
 * It is substituted into `campaigns.objective` by `render_objective`, and
 * `campaigns.objective` is emitted into an assembled prompt as a delimited
 * `<objective>` block — so this is INSTRUCTION-ADJACENT TEXT. A browser-supplied
 * value would be untrusted input landing one delimiter away from the model's
 * instructions, which is the injection surface `docs/AI_CODING_RULES.md` names.
 * The onboarding prefill is server-authored from the client's own user row.
 */
async function clientDisplayName(token: string): Promise<string> {
  const prefill = await getOnboarding(token);
  return prefill.user.display_name;
}

/** Tags the ONE 409 this module authors, so a handler can tell it apart.
 *
 * `api/client/campaigns/route.ts` collapses every OTHER 409 into a neutral
 * sentence — the play-eligibility gate's names atom types and offers an override,
 * and the period unique-constraint's names a level and a date. This one is
 * already written for a client to read, so it is forwarded rather than replaced.
 * A code rather than a string match: matching on prose is how a message edit
 * silently turns a client-safe refusal into a jargon leak.
 */
export const PERIOD_CONFLICT_CODE = "period_conflict";

/** Widest to narrowest, the order the level candidates are tried in. */
const LEVELS: Array<NonNullable<PeriodCreate["level"]>> = ["year", "quarter", "month"];

/** The most honest `level` label for a span, before collisions are considered. */
function honestLevel(startsOn: string, endsOn: string): NonNullable<PeriodCreate["level"]> {
  const days =
    (Date.parse(`${endsOn}T00:00:00Z`) - Date.parse(`${startsOn}T00:00:00Z`)) / 86_400_000 + 1;
  if (days <= 31) return "month";
  if (days <= 92) return "quarter";
  return "year";
}

/** `YYYY-01-01` — the start D7A-11 reserves for the hidden default's period. */
function isJanuaryFirst(startsOn: string): boolean {
  return startsOn.endsWith("-01-01");
}

/** The period a client-created campaign hangs from: found, or created.
 *
 * **THE DECISION THIS FILE HAD TO MAKE, AND THE FAILURE MODE IT AVOIDS.** A
 * campaign needs a `period_id` and the client's real inputs are a play and dates
 * (D7A-09) — no period. The obvious shortcut is to reuse the system default
 * period, and it is WRONG: every client-created campaign would then hang off the
 * hidden one, and `client_campaigns.py`'s exclusion filter
 * (`Period.label != SYSTEM_PERIOD_LABEL`) would hide the client's OWN campaigns
 * from their own list. They would create a campaign, get a 201, and see nothing.
 * So this function reuses only NON-sentinel periods and creates a labelled one
 * when none contains the dates.
 *
 * **WHY THE LEVEL IS CHOSEN RATHER THAN FIXED.** `uq_periods_client_level_start`
 * is per `(client_id, level, starts_on)`, and D7A-11's default period occupies
 * `(year, YYYY-01-01)`. A client campaign starting 1 January and running longer
 * than a quarter would honestly be labelled `level="year"` — and would collide
 * with that reserved key, 409ing a legal create (or, if "resolved" by reuse,
 * reintroducing the hiding failure above). So the honest level is tried first,
 * then the remaining ones, skipping any key already taken and always skipping the
 * key D7A-11 reserves. The `label` carries the truth in every case; `level` is a
 * descriptor with no validation against the span anywhere in the API, and its one
 * hard job here is to keep the unique key free.
 */
async function resolveClientPeriod(
  clientId: string,
  sentinel: string,
  displayName: string,
  startsOn: string,
  endsOn: string,
): Promise<Period> {
  const periods = await listPeriodsAsService(clientId);

  const reusable = periods.find(
    (p) => p.label !== sentinel && contains(p, startsOn, endsOn),
  );
  if (reusable) return reusable;

  const taken = new Set(periods.map((p) => `${p.level}|${p.starts_on}`));
  const honest = honestLevel(startsOn, endsOn);
  const candidates = [honest, ...LEVELS.filter((l) => l !== honest)].filter(
    (level) =>
      !taken.has(`${level}|${startsOn}`) && !(level === "year" && isJanuaryFirst(startsOn)),
  );

  if (candidates.length === 0) {
    // Reachable only when this client already has a period at every level
    // starting on this exact date, none of which contains the requested range.
    // Thrown as a `ProductHttpError` so it reaches the browser through the same
    // `forwardProductError` arm as a real refusal, with a status IC-14 can read.
    throw new ProductHttpError(
      "compose-provisioning: no free period key for the requested dates",
      409,
      {
        code: PERIOD_CONFLICT_CODE,
        message:
          "We couldn't set up a date range for those dates — pick different ones, or ask us and we'll sort it.",
      },
    );
  }

  const body: PeriodCreate = {
    level: candidates[0],
    starts_on: startsOn,
    ends_on: endsOn,
    label: `${displayName} — ${startsOn} to ${endsOn}`,
  };
  try {
    return await createPeriodAsService(clientId, body);
  } catch (error) {
    if (!(error instanceof ProductHttpError) || error.status !== 409) throw error;
    const afterRace = await listPeriodsAsService(clientId);
    const winner = afterRace.find((p) => p.label !== sentinel && contains(p, startsOn, endsOn));
    if (winner) return winner;
    throw error;
  }
}

/** Create a campaign the client asked for. Their play and dates; nothing else.
 *
 * `period_id` and `client_name` are filled server-side, `override` is never set,
 * and no other field is accepted. The cap's 422 and the play catalogue's 422 both
 * travel back to the caller unchanged — the cap message names the current count
 * and the day the next slot frees, and a friendlier replacement written here
 * would drop the numbers the client needs to act on.
 */
export async function createClientCampaign(
  token: string,
  requested: { play_id: unknown; starts_on: string; ends_on: string; idempotency_key: string },
): Promise<ServiceCampaign> {
  const envelope = await listClientCampaigns(token);
  const clientId = envelope.client_id;
  const displayName = await clientDisplayName(token);

  const period = await resolveClientPeriod(
    clientId,
    envelope.default_period_label,
    displayName,
    requested.starts_on,
    requested.ends_on,
  );

  return createCampaignAsService(clientId, {
    period_id: period.id,
    play_id: requested.play_id,
    client_name: displayName,
    starts_on: requested.starts_on,
    ends_on: requested.ends_on,
    idempotency_key: requested.idempotency_key,
  } as Parameters<typeof createCampaignAsService>[1]);
}
