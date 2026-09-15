// Wall-clock <-> aware instant, in a named IANA zone. ONE implementation.
//
// NEITHER "use client" NOR "server-only", and that is the point: the reschedule
// picker runs this in the browser (it knows the slot's own `slot_zone`) and the
// create route runs it on the server (only the server may resolve the client's
// configured zone — a browser-supplied zone is a browser-supplied instant, and
// the backend stamps `slot_zone` from `clients.timezone` regardless, so a
// browser guess would show the client a time their calendar then contradicts).
//
// Extracted from `components/app/SchedulePicker.tsx` unchanged, so a reschedule
// keeps behaving exactly as it did.

/** The parts of `instant` as `zone` renders them: year, month, day, hour, minute. */
export function partsInZone(instant: Date, zone: string): Record<string, string> {
  const values = new Intl.DateTimeFormat("en-CA", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instant);
  return Object.fromEntries(
    values.filter(({ type }) => type !== "literal").map(({ type, value }) => [type, value]),
  );
}

/** `instant` as the `YYYY-MM-DD` / `HH:MM` a date and time input hold, in `zone`. */
export function wallClockInZone(instant: Date, zone: string): { date: string; time: string } {
  const part = partsInZone(instant, zone);
  return { date: `${part.year}-${part.month}-${part.day}`, time: `${part.hour}:${part.minute}` };
}

/** Today's date in `zone`, as `YYYY-MM-DD`. The picker's presets are computed
 * from this once the client's zone has resolved, so "tomorrow" means tomorrow
 * where the client is, not where the browser happens to be sitting.
 */
export function todayInZone(zone: string): string {
  return wallClockInZone(new Date(), zone).date;
}

/** `date` shifted by whole days. Calendar arithmetic, no zone involved — a
 * date-only value has no timezone question to answer.
 */
export function addCalendarDays(date: string, days: number): string {
  const [year, month, day] = date.split("-").map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`;
}

/** The next `weekday` (0 = Sunday … 6 = Saturday) STRICTLY AFTER `date`. If
 * `date` is itself that weekday, this returns a week later — the preset means
 * "the next occasion", never "today, if today happens to qualify".
 */
export function nextWeekday(date: string, weekday: number): string {
  const [year, month, day] = date.split("-").map(Number);
  const current = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  const delta = ((weekday - current + 7) % 7) || 7;
  return addCalendarDays(date, delta);
}

/** `YYYY-MM-DD` + `HH:MM` in `zone` -> the aware ISO instant that renders as it.
 *
 * TWO ITERATIONS, NOT ONE, AND NOT A LIBRARY. The offset a zone applies depends
 * on the instant, and the instant is what we are solving for; one correction
 * lands inside a DST transition on the wrong side of it. Two converge for every
 * real zone rule. `Intl` is the only source of zone data here, so there is no
 * dependency to licence-check.
 */
export function instantInZone(date: string, time: string, zone: string): string {
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  const target = Date.UTC(year, month - 1, day, hour, minute);
  let candidate = new Date(target);
  for (let index = 0; index < 2; index += 1) {
    const part = partsInZone(candidate, zone);
    const displayed = Date.UTC(
      Number(part.year),
      Number(part.month) - 1,
      Number(part.day),
      Number(part.hour),
      Number(part.minute),
    );
    candidate = new Date(candidate.getTime() + (target - displayed));
  }
  return candidate.toISOString();
}

/** The date-verbosity `formatSlotInstant` renders with — `"full"` for a page
 * that has room to spell out a weekday and a month (`Approved.tsx`), `"medium"`
 * for a card that doesn't (the library). The time portion is always `"short"`;
 * only the date side varies.
 */
export type SlotDateStyle = "full" | "medium";

/** `instant`, formatted for display in `zone` — the SLOT's own zone, always,
 * never the browser's: the browser has no say in when a client's post goes
 * out, only in how the client's own configured zone is displayed back to them.
 *
 * Extracted from `Approved.tsx`'s inline `Intl.DateTimeFormat` call so a slot
 * is formatted in exactly one place: `Approved.tsx` (style `"full"`) and the
 * library card (style `"medium"`) both call this instead of each declaring
 * its own instance.
 */
export function formatSlotInstant(instant: Date, zone: string, style: SlotDateStyle): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: style, timeStyle: "short", timeZone: zone }).format(instant);
}
