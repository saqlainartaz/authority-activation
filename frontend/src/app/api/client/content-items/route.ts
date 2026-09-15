// /api/client/content-items — TWO VERBS WITH TWO DIFFERENT CREDENTIAL FAMILIES.
// Do not read this file as uniform:
//
//   * `GET`  is CLIENT-CREDENTIAL. `GET /v1/content-items` derives the tenant
//     from the onboarding token and takes no `client_id` anywhere (D7A-14).
//   * `POST` is SERVICE-PROXIED. There is deliberately no `POST /v1/content-items`
//     in this API: the only route that brings a content item into existence keeps
//     the campaign in its path (`PLAN-04`), so the create goes through
//     `lib/compose-provisioning.ts`, which resolves the tenant server-side from
//     the same token and ensures a campaign first.
//
// The split is stated at the top because the obvious later edit — "tidy these
// two into one helper" — would attach one credential to both and produce a 401
// on whichever verb lost the one it needed.

import { clientToken } from "@/lib/client-session";
import { createItemInCampaign, createStandaloneItem } from "@/lib/compose-provisioning";
import {
  expiredLinkResponse,
  forwardProductError,
  listContentItems,
  readJsonObject,
} from "@/lib/product";

export async function GET() {
  const token = await clientToken();
  if (!token) return expiredLinkResponse();
  try {
    // The library read. Every item this client has, whatever state it is in —
    // `awaiting-review` serves drafts only and `/v1/calendar` serves scheduled
    // slots only, so without this route posted, rejected and edited items are
    // invisible and the library is two filtered lists (D7A-14.2).
    return Response.json(await listContentItems(token));
  } catch (e) {
    return forwardProductError(e);
  }
}

export async function POST(request: Request) {
  const token = await clientToken();
  if (!token) return expiredLinkResponse();
  const raw = await readJsonObject(request);

  // ALLOWLIST: asset_kind, campaign_id, idempotency_key. A non-string value is DROPPED rather than
  // coerced, so the API's own default applies to `asset_kind` and the API's own
  // 422 names anything else it dislikes.
  //
  // `campaign_id` WAS ADDED BY PLAN 07A-08 AND THE ORIGINAL PARAGRAPH HERE SAID IT
  // COULD NOT BE. It read: a browser naming a campaign could aim a write at any
  // campaign id it could guess, and there is no field for it on `ContentItemCreate`
  // because the id lives in the path. The second half is still true and is why the
  // create is service-proxied. The first half is answered rather than accepted:
  // `createItemInCampaign` VERIFIES the id against `GET /v1/campaigns` FOR THIS
  // TOKEN before it is used, so a guessed id — another tenant's, an invented one,
  // or the hidden default that list excludes — meets a 422 and reaches no write.
  //
  // WHY IT WAS ADDED AT ALL: IC-10.6 puts an optional campaign step at the end of
  // compose, and without this key that step is a control that discards the client's
  // choice. A picker whose value never reaches the wire is the class of fabricated
  // affordance this phase exists to delete, so the alternative to widening the
  // allowlist by one CHECKED key was shipping a lie.
  //
  // ABSENT MEANS THE HIDDEN DEFAULT, and there is deliberately no value meaning
  // "no campaign": `PLAN-04` forbids a campaign-free content item, so the two paths
  // below are the only two that exist.
  const assetKind = typeof raw.asset_kind === "string" ? raw.asset_kind : undefined;
  const campaign = typeof raw.campaign_id === "string" ? raw.campaign_id : undefined;
  const idempotencyKey =
    typeof raw.idempotency_key === "string" ? raw.idempotency_key : undefined;

  // Do not mint a fallback here. A handler retry must retain the browser's action
  // identity, and the product API is the authority for the key's length bounds.
  if (idempotencyKey === undefined) {
    return Response.json({ error: "A valid idempotency key is required." }, { status: 422 });
  }

  try {
    const { contentItemId, campaignId } =
      campaign === undefined
        ? await createStandaloneItem(token, idempotencyKey, assetKind)
        : await createItemInCampaign(token, campaign, idempotencyKey, assetKind);
    // 201, matching `create_content_item`'s own status. The response names the
    // campaign it landed in so a screen never has to guess whether PLAN-04 held.
    return Response.json(
      { content_item_id: contentItemId, campaign_id: campaignId },
      { status: 201 },
    );
  } catch (e) {
    return forwardProductError(e);
  }
}
