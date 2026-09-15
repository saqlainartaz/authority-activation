const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
const MONTHS_SHORT = MONTHS.map((m) => m.slice(0, 3));
const DAYS_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function parseISO(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

export function toISO(date: Date) {
  return date.toISOString().slice(0, 10);
}

/** "13 Aug" */
export function shortDate(iso: string) {
  const d = parseISO(iso);
  return `${d.getUTCDate()} ${MONTHS_SHORT[d.getUTCMonth()]}`;
}

/** "Thu 13 Aug, 9:00" */
export function longDate(iso: string, time?: string) {
  const d = parseISO(iso);
  const day = DAYS_SHORT[(d.getUTCDay() + 6) % 7];
  return `${day} ${d.getUTCDate()} ${MONTHS_SHORT[d.getUTCMonth()]}${
    time ? `, ${time}` : ""
  }`;
}

export function monthLabel(iso: string) {
  const d = parseISO(iso);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** Shifts to the first of a month `delta` months away. */
export function addMonths(iso: string, delta: number) {
  const d = parseISO(iso);
  return toISO(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + delta, 1)));
}

/**
 * A whole month as Monday-first weeks, padded with the neighbouring days so
 * every row is complete.
 */
export function monthGrid(iso: string): string[][] {
  const d = parseISO(iso);
  const first = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
  const start = new Date(first);
  start.setUTCDate(first.getUTCDate() - ((first.getUTCDay() + 6) % 7));

  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0));
  const span = Math.ceil(
    (last.getTime() - start.getTime()) / (1000 * 60 * 60 * 24) + 1,
  );
  const weeks = Math.ceil(span / 7);

  return Array.from({ length: weeks }, (_, week) =>
    Array.from({ length: 7 }, (_, day) => {
      const cell = new Date(start);
      cell.setUTCDate(start.getUTCDate() + week * 7 + day);
      return toISO(cell);
    }),
  );
}

export const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function todayISO(now = new Date()) {
  return now.toISOString().slice(0, 10);
}
