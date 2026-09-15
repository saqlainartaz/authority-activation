import "server-only";

import { clientTimezone } from "@/lib/client-timezone";
import { scheduleContentItem } from "@/lib/product";
import { instantInZone } from "@/lib/zoned-instant";

import { derivedKey, type ToolContext } from "@/agent/lib/backend";

/**
 * Schedule an approved content item. Calls the existing content-item schedule
 * endpoint. Wired in §9 step 4.
 *
 * `schedule` IS a tool and `publish` is not (spec §10, correcting brief §8):
 * nothing publishes, so a misread date is a wrong reminder rather than a wrong
 * post. `approve` and `finish` stay out — a draft lands in drafts and a human
 * takes it from there (operator decision, 2026-08-24).
 *
 * REUSES `scheduleContentItem` FROM `lib/product.ts`, NOT `engineJson`.
 * `POST /v1/content-items/{id}/schedule` is a client-credential route (same
 * reasoning as `get-variant-sources.ts` / `propose-durable-fact.ts`): the
 * token comes from `context.token`, threaded down from the route's own
 * `requireClientToken()` call (`backend.ts`'s `ToolContext.token` doc) —
 * reaching for the service-only `engineJson` here would be a second auth
 * path onto a route that already has one, and is the exact defect
 * `prepare_generation`/`submit_draft` shipped with (final whole-branch
 * review, C1).
 *
 * FIX, Task 8 fix round item 6 (from the PREVIOUS task's review — it lands
 * here because this task holds the seam). The earlier version passed the
 * model-facing `when` straight through as `slot_at`, on the reasoning that
 * an aware instant is Python's own requirement anyway. That reasoning was
 * wrong in the one way that matters: the model-facing SCHEMA only promised
 * "ISO-8601", which a naive datetime (`"2026-08-20T09:00:00"`, no offset)
 * satisfies — and Python's `AwareDatetime` 422s on exactly that, with
 * `instructions.md` giving the model no counter-instruction and no way to
 * self-correct, so the loop would burn attempts without ever converging.
 *
 * §3's principle is the fix, not a prompt: a timezone offset is something
 * that must be TRUE, not claimed, so it does not belong in a field the model
 * fills in. This now MIRRORS THE BROWSER BFF ROUTE'S OWN SHAPE
 * (`api/client/content-items/[id]/schedule/route.ts:81`) instead of Python's
 * wire shape directly: look up `clientTimezone(token)` — server state, the
 * SAME column the backend itself stamps `slot_zone` from — and build the
 * aware instant via `instantInZone`, exactly as that route does. The
 * model-facing schema's `when` description changes accordingly (see
 * `tool-schemas.ts`): a LOCAL date and time, with no offset, because the
 * zone is no longer the model's problem to report.
 *
 * See `backend.ts` for the general three-shape note this is one leg of.
 */
const LOCAL_DATE_TIME = /^(\d{4}-\d{2}-\d{2})T((?:[01]\d|2[0-3]):[0-5]\d)$/;

/** Same check `api/client/content-items/[id]/schedule/route.ts::isRealDate`
 *  makes, duplicated rather than imported — that one is a route-local
 *  helper, not a shared export, and the check is six lines. `Date.UTC` rolls
 *  a shape-valid impossible date (`2026-02-31`) over to a real one rather
 *  than refusing, which would silently schedule a day the client never
 *  named. UTC, not the target zone: whether 31 February exists is a
 *  calendar question no zone changes the answer to. */
function isRealDate(date: string): boolean {
  const [year, month, day] = date.split("-").map(Number);
  const instant = new Date(Date.UTC(year, month - 1, day));
  return (
    instant.getUTCFullYear() === year && instant.getUTCMonth() === month - 1 && instant.getUTCDate() === day
  );
}

export async function schedule(
  args: { contentItemId: string; when: string },
  context: ToolContext,
  attempt = 1,
): Promise<{ scheduledFor: string }> {
  const match = LOCAL_DATE_TIME.exec(args.when);
  if (!match || !isRealDate(match[1])) {
    // A plain Error, not an HTTP error class — the executor's catch-all
    // treats that distinction as "safe to surface" vs. "may carry upstream
    // detail", and this is validation feedback about the MODEL's OWN input,
    // exactly the kind meant to reach it so it can self-correct.
    throw new Error(
      `when must be a local date and time with no timezone offset, like "2026-08-20T09:00" — got ${JSON.stringify(args.when)}`,
    );
  }
  const [, date, time] = match;
  const zone = await clientTimezone(context.token);
  const slotAt = instantInZone(date, time, zone);
  const result = await scheduleContentItem(context.token, args.contentItemId, {
    idempotency_key: derivedKey(context.turnId, "schedule", attempt),
    slot_at: slotAt,
  });
  return { scheduledFor: result.slot.slot_at };
}
