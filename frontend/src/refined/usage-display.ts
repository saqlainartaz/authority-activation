// Settings -> Usage, as pure display rules (Cycle 5 P2.6; spec 10A.4, A41, A47).
// No React and no fetch, so every rule is testable without rendering.
//
// - Fractions and reset times only; no dollar amount is ever shown to a client.
// - An unknown figure is "Not available", never 0 and never full.
// - `available == false` alone is "Limit reached" (Ruling 11); the meter state is
//   read by `meterState` in `@/lib/limits`, the one reading the operator's Limits
//   card uses too, so the two views cannot disagree about the same meter.
// - Under M1 nothing new is shown (A47).

import { LIMIT_REACHED, NOT_AVAILABLE, clampFraction, meterState, percentUsed, type MeterState } from '@/lib/limits';
import type { KeUsage, UploadsUsage, UsageMeter } from '@/lib/usage';
import { utcReset } from '@/lib/utc-reset';

export type UsageState =
  | { kind: 'loading' }
  | { kind: 'error' }
  | { kind: 'm1' }
  | { kind: 'ke'; usage: KeUsage };

export const USAGE_UNAVAILABLE = "Usage isn't available right now";
export const UPLOADS_NOT_SET_UP = "Uploads aren't set up for this account yet";
export const UNLIMITED_UPLOADS = 'Unlimited uploads';
export const NEARLY_USED_UP = 'Nearly used up';
/** D11 (Cycle 5 P8.3): a delete is not a refund. */
export const DELETE_KEEPS_UPLOAD = "Deleting a file doesn't give back an upload.";

/** A reset instant in UTC, labelled UTC whatever the browser's zone: "00:00 UTC"
 *  for a daily reset (always the next midnight), "1 November, 00:00 UTC" for a
 *  monthly one. Null when the instant cannot be read. The one shared formatter
 *  (`utc-reset.ts`): the month is spelled out as in the composer's sentences, so
 *  the same reset reads the same in both (P2.6 review M5). */
export function formatReset(iso: string | null, period: 'day' | 'month'): string | null {
  return utcReset(iso, period);
}

export type MeterRow = {
  label: string;
  state: MeterState;
  /** "42% used" or "Not available". Never "0%" for a missing figure. */
  usage: string;
  /** The bar's fill, clamped to [0, 1]; null when there is no figure, so no bar. */
  fraction: number | null;
  /** The line under the bar: the state and the reset, UTC labelled. */
  note: string | null;
};

export function meterRow(label: string, meter: UsageMeter, period: 'day' | 'month'): MeterRow {
  const state = meterState(meter);
  const reset = formatReset(meter.resets_at, period);
  if (state === 'unavailable' || meter.used_fraction === null) {
    return { label, state, usage: NOT_AVAILABLE, fraction: null, note: null };
  }
  const fraction = clampFraction(meter.used_fraction);
  const resets = reset ? `resets ${reset}` : null;
  const note = state === 'reached'
    ? [LIMIT_REACHED, resets].filter(Boolean).join(' · ')
    : state === 'near'
      ? [NEARLY_USED_UP, resets].filter(Boolean).join(' · ')
      : reset ? `Resets ${reset}` : null;
  return { label, state, usage: percentUsed(fraction), fraction, note };
}

export function meterRows(usage: KeUsage): MeterRow[] {
  return [
    meterRow('Writing today', usage.writing.today, 'day'),
    meterRow('Writing this month', usage.writing.month, 'month'),
    meterRow('Document processing today', usage.documents.today, 'day'),
  ];
}

export type UploadsRow = { summary: string; note: string | null; reached: boolean };

export function uploadsRow(uploads: UploadsUsage): UploadsRow {
  if (uploads.unlimited) {
    return { summary: UNLIMITED_UPLOADS, note: `${uploads.used} used this month`, reached: false };
  }
  if (uploads.base === null) return { summary: UPLOADS_NOT_SET_UP, note: null, reached: false };
  const allowed = uploads.base + (uploads.extra ?? 0);
  const left = uploads.remaining === null ? '' : ` · ${uploads.remaining} left`;
  const reset = formatReset(uploads.resets_at, 'month');
  const reached = uploads.remaining === 0;
  const note = reached
    ? [LIMIT_REACHED, reset ? `resets ${reset}` : null].filter(Boolean).join(' · ')
    : reset ? `Resets ${reset}` : null;
  return { summary: `${uploads.used} of ${allowed} uploads used this month${left}`, note, reached };
}

// ---- which view, before anything is fetched (A47) -------------------------------

/** What the Usage section does for the engine the app already knows: under the
 *  rehaul engine a live read; otherwise -- M1, or an engine not known (still
 *  loading, or its read failed) -- the old copy with no read at all, which promises
 *  nothing new, so the tab is never blank (P2 milestone review M5). */
export function usageSource(engine: 'ke' | 'm1' | null): 'm1' | 'fetch' {
  return engine === 'ke' ? 'fetch' : 'm1';
}

/** The Usage tab's subtitle in Settings: neutral under the rehaul engine, as it
 *  always was otherwise (the demo and M1 keep theirs). */
export function usageSubtitle(isDemo: boolean, engine: 'ke' | 'm1' | null): string {
  return !isDemo && engine === 'ke' ? 'Uploads and writing this month' : 'Generations left this month';
}

// ---- reading the BFF's answer ------------------------------------------------

const record = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
const count = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;
const instant = (value: unknown): string | null =>
  typeof value === 'string' && !Number.isNaN(Date.parse(value)) ? value : null;

/** A meter as sent, or an unavailable one: a malformed meter is never read as
 *  reached (that would need `available: false` WITH a figure) nor as 0. */
function readMeter(value: unknown): UsageMeter {
  const meter = record(value);
  const available = meter?.available;
  const fraction = count(meter?.used_fraction);
  return {
    used_fraction: typeof available === 'boolean' ? fraction : null,
    available: available === true,
    resets_at: instant(meter?.resets_at) ?? '',
  };
}

function readUploads(value: unknown): UploadsUsage {
  const uploads = record(value) ?? {};
  return {
    month: typeof uploads.month === 'string' ? uploads.month : '',
    base: count(uploads.base),
    extra: count(uploads.extra),
    used: count(uploads.used) ?? 0,
    remaining: count(uploads.remaining),
    unlimited: uploads.unlimited === true,
    resets_at: instant(uploads.resets_at) ?? '',
  };
}

/** The `GET /api/client/usage` body as a screen state. Anything that is neither
 *  engine is an error, never a guess. */
export function usageStateFrom(body: unknown): UsageState {
  const value = record(body);
  if (value?.engine === 'm1') return { kind: 'm1' };
  if (value?.engine !== 'ke') return { kind: 'error' };
  const writing = record(value.writing) ?? {};
  const documents = record(value.documents) ?? {};
  const uploads = readUploads(value.uploads);
  // `used` is a count the backend always sends; without it there is no honest line.
  if (count(record(value.uploads)?.used) === null) return { kind: 'error' };
  return {
    kind: 'ke',
    usage: {
      engine: 'ke',
      uploads,
      writing: { today: readMeter(writing.today), month: readMeter(writing.month) },
      documents: { today: readMeter(documents.today) },
    },
  };
}

/** Reads the usage once. A failed request (a 503 `usage_unavailable`, a lost
 *  connection, an expired session) is the error state, never zeros. */
export async function loadUsage(get: (path: string) => Promise<unknown>): Promise<UsageState> {
  try {
    return usageStateFrom(await get('/api/client/usage'));
  } catch {
    return { kind: 'error' };
  }
}
