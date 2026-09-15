import "server-only";

import type { ToolContext } from "@/agent/lib/backend";
import { getChatVariantSources } from "@/lib/product";

/**
 * Show the receipt LABELS behind a stored variant -- never the locator.
 *
 * FIXED 2026-08-26, §9 step 6 task 13. From step 6 task 2 (2026-08-25) to
 * this task, this tool threw on every call: it used to post the `show_sources`
 * command kind to `/commands`, and that kind was retired the same step this
 * tool itself was created, absorbed into the agent's own tool-calling loop
 * (`src/product/chat/commands.py`'s own docstring: "since step 4 they are
 * agent tools ... not commands a browser or a shortcut route can send"). No
 * replacement endpoint existed on the Python side for six tasks and a full
 * day, so the honest move (fix wave, 2026-08-26, review Important 1) was to
 * throw rather than return `{ sources: [] }`: a SUCCESSFUL empty result
 * reads to the model as "this draft has no sources", a false claim about the
 * one promise this product makes.
 *
 * The throw is gone because the gap it covered for is gone: `GET
 * /v1/chat/sessions/{id}/variants/{variant_id}/sources`
 * (`src/product/api/chat.py::read_variant_sources`) now exists, and this
 * calls it through `getChatVariantSources` (`@/lib/product`), the same
 * `clientJson`-backed pattern `prepare-generation.ts` and `submit-draft.ts`
 * use for the client-credential routes on this surface -- never
 * `engineJson`, which carries only the service key and would 401 here the
 * same way it did at the final whole-branch review's C1 fix.
 *
 * THE RETURN SHAPE HAS NOT CHANGED. It was always declared
 * `{ sources: { source_label: string }[] }` -- labels, no locator -- because
 * spec §4.4/PROV-01 forbids a receipt locator on any path the model reads
 * next, and the fix is a route that honours that constraint rather than one
 * that fights it. An empty `sources` array is a legitimate, working answer
 * -- a `variant_id` that names no variant, or one whose `status` is not
 * `verified` (`stored_variant_sources`' own two conditions; `variant_id`
 * selection is never consulted) -- and is exactly the honest thing the
 * pre-fix throw could not say.
 */
export async function getVariantSources(
  args: { variantId: string },
  context: ToolContext,
  _attempt = 1,
): Promise<{ sources: { source_label: string }[] }> {
  const result = await getChatVariantSources(context.token, context.sessionId, args.variantId);
  return { sources: result.sources };
}
