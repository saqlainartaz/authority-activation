// POST /api/client/content-items/[id]/schedule -> POST /v1/content-items/{id}/schedule
//
// THE FIRST DATE, which is a different action from moving one. Approve stopped
// allocating a slot in Pass 1 (spec 2026-08-20, decision D2), so `Approved.slot`
// is ordinarily null and this route is how a client's own date enters the system.
//
// THE BROWSER SENDS A WALL-CLOCK, NOT AN INSTANT, and that asymmetry with the
// reschedule route beside this one is deliberate. There, the browser holds the
// slot's own `slot_zone` and can build an aware instant honestly. Here there is
// no slot yet, so the only zone that can be right is the client's configured one
// — and that is server-side data. A browser-built instant would be built against
// the BROWSER's zone, while the backend stamps `slot_zone` from
// `clients.timezone`; a client scheduling 09:00 from another country would then
// watch their calendar render a different time.
//
// The refusals are forwarded verbatim: the 409 names which slot status is in the
// way and what to do instead, and the 422 names the instant that has already
// passed. A friendlier sentence written here would drop both.

import { clientToken } from "@/lib/client-session";
import { clientTimezone } from "@/lib/client-timezone";
import { EngineHttpError, forwardEngineError } from "@/lib/engine";
import {
  expiredLinkResponse,
  forwardProductError,
  readJsonObject,
  scheduleContentItem,
} from "@/lib/product";
import { instantInZone } from "@/lib/zoned-instant";

type Params = { params: Promise<{ id: string }> };

const DATE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Does `date` name a day that exists? `Date.UTC` rolls over rather than
 * refusing — `2026-02-31` becomes 3 March — so a shape-valid impossible date
 * would otherwise schedule a real day the client never picked. UTC and not the
 * client's zone on purpose: whether 31 February exists is a calendar question,
 * and no zone changes the answer. */
function isRealDate(date: string): boolean {
  const [year, month, day] = date.split("-").map(Number);
  const instant = new Date(Date.UTC(year, month - 1, day));
  return (
    instant.getUTCFullYear() === year &&
    instant.getUTCMonth() === month - 1 &&
    instant.getUTCDate() === day
  );
}

export async function POST(request: Request, { params }: Params) {
  const token = await clientToken();
  if (!token) return expiredLinkResponse();
  const { id } = await params;
  const raw = await readJsonObject(request);

  // ALLOWLIST: date, time, idempotency_key. There is deliberately no `slot_at`
  // and no `timezone` key — see the header.
  const date = typeof raw.date === "string" ? raw.date : "";
  const time = typeof raw.time === "string" ? raw.time : "";
  const idempotencyKey =
    typeof raw.idempotency_key === "string" ? raw.idempotency_key : undefined;

  // Do not mint a fallback key here: a handler retry must keep the browser's
  // action identity, and the product API owns the length bounds.
  if (idempotencyKey === undefined) {
    return Response.json({ error: "A valid idempotency key is required." }, { status: 422 });
  }
  if (!DATE.test(date) || !TIME.test(time) || !isRealDate(date)) {
    return Response.json({ error: "Pick a date and a time." }, { status: 422 });
  }

  try {
    // THE TIME GETS NO EXISTENCE CHECK, AND THAT IS THE POINT. A round-trip
    // check on the built instant would refuse a legitimate `02:30` pick on a
    // spring-forward night — that wall-clock does not exist in the client's
    // zone, but `instantInZone`'s two-iteration convergence already resolves
    // it to a real instant nearby. Trading a rare wrong-date bug for a
    // wrong-refusal on every DST boundary is not a fix; do not "tighten" this
    // check into existence.
    const slotAt = instantInZone(date, time, await clientTimezone(token));
    // 201, matching the route's own status, so a caller never has to guess
    // whether a first schedule and a reschedule answered the same way.
    return Response.json(
      await scheduleContentItem(token, id, { idempotency_key: idempotencyKey, slot_at: slotAt }),
      { status: 201 },
    );
  } catch (error) {
    return error instanceof EngineHttpError
      ? forwardEngineError(error)
      : forwardProductError(error);
  }
}
