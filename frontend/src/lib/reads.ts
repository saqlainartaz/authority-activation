// Page-level reads for Server Components.
//
// Dedup primitive: React `cache()` from
// `node_modules/next/dist/docs/01-app/01-getting-started/06-fetching-data.md`.
// That guide says React.cache is scoped to the CURRENT REQUEST ONLY, so calls
// sharing a token in one render share one upstream response and no response or
// tenant id is retained for another client. Do not replace this with a
// module-level map: that would make a cross-tenant cache possible.

import "server-only";

import { cache } from "react";

import {
  awaitingReview,
  calendar,
  clientConsole,
  getOnboarding,
  listClientCampaigns,
  listContentItems,
} from "@/lib/product";

/** The token is an argument, and therefore part of React.cache's per-request key. */
export const readCampaigns = cache(async (token: string) => listClientCampaigns(token));

/** Console is service-authenticated, so its tenant is derived from the cached client read. */
const readClientId = cache(async (token: string) => (await readCampaigns(token)).client_id);

export const readConsole = cache(async (token: string) => clientConsole(await readClientId(token)));

export const readCalendar = cache(async (token: string) => calendar(token));

export const readAwaitingReview = cache(async (token: string) => awaitingReview(token));

export const readOnboarding = cache(async (token: string) => getOnboarding(token));

export const readContentItems = cache(async (token: string) => listContentItems(token));
