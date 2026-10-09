// One UTC date and time formatter for every reset, resume and audit time the app
// prints (Cycle 5 P2.7, carrying P2.6 review M5). Client-safe and pure: no
// credential, no React, no fetch. Every value is read in UTC and labelled "UTC",
// whatever the browser's own zone, so the same instant reads the same on every
// screen: the composer's limit sentences (`limit-refusal.ts`), Settings -> Usage
// (`refined/usage-display.ts`), the operator's Limits card (`limits.ts`), the
// Knowledge screen's statuses (`knowledge-status.ts`) and its upload errors
// (`upload-errors.ts`).

const LONG_MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
] as const;
const SHORT_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

const two = (value: number) => String(value).padStart(2, "0");

/** The instant, or null when it cannot be read. */
function instant(value: string | Date | null | undefined): Date | null {
  if (value === null || value === undefined) return null;
  const at = value instanceof Date ? value : new Date(value);
  return Number.isNaN(at.getTime()) ? null : at;
}

/** "00:00 UTC". */
export function utcTime(value: string | Date | null | undefined): string | null {
  const at = instant(value);
  return at ? `${two(at.getUTCHours())}:${two(at.getUTCMinutes())} UTC` : null;
}

/** The UTC calendar day: "1 November" (client copy), "1 Nov" with `short`, and
 *  the year appended with `year` ("6 Oct 2026", the operator's audit style). */
export function utcDay(
  value: string | Date | null | undefined,
  options: { short?: boolean; year?: boolean } = {},
): string | null {
  const at = instant(value);
  if (!at) return null;
  const month = (options.short ? SHORT_MONTHS : LONG_MONTHS)[at.getUTCMonth()];
  return `${at.getUTCDate()} ${month}${options.year ? ` ${at.getUTCFullYear()}` : ""}`;
}

/** An audit instant for the operator: "6 Oct 2026, 00:00 UTC". */
export function utcStamp(value: string | Date | null | undefined): string | null {
  const day = utcDay(value, { short: true, year: true });
  return day ? `${day}, ${utcTime(value)}` : null;
}

/** A limit's reset for the client: "00:00 UTC" for a daily one (always the next
 *  UTC midnight), "1 November, 00:00 UTC" for a monthly one. */
export function utcReset(value: string | Date | null | undefined, period: "day" | "month"): string | null {
  const time = utcTime(value);
  if (!time) return null;
  return period === "month" ? `${utcDay(value)}, ${time}` : time;
}

/** When something continues: "14:05 UTC" on the same UTC day as `now`, and
 *  "00:01 UTC on 7 October" on any other day. Null when there is no readable
 *  instant, so a caller can never print a time it was not given. */
export function utcWhen(value: string | Date | null | undefined, now: Date = new Date()): string | null {
  const at = instant(value);
  if (!at) return null;
  const sameDay = at.getUTCFullYear() === now.getUTCFullYear()
    && at.getUTCMonth() === now.getUTCMonth()
    && at.getUTCDate() === now.getUTCDate();
  return sameDay ? utcTime(at) : `${utcTime(at)} on ${utcDay(at)}`;
}
