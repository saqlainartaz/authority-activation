// The operator Limits card's shapes and pure display rules (Cycle 5 P2.5; spec
// §10.2). Client-safe: no credential, no React, no fetch. The shapes
// mirror the backend's `LimitsOut` and `LimitChangesPage`
// (`src/content_engine/ke/api/limits.py`; docs/API_CONTRACT.md, limits section).

import { utcStamp } from "./utc-reset";

export type LimitsMeter = {
  /** Null when nobody configured this budget. */
  limit_usd: number | null;
  spent_usd: number;
  /** False is the only "limit reached" signal (Ruling 11). */
  available: boolean;
  /** Clamped to [0, 1]; null when it cannot be computed (Ruling 33). */
  used_fraction: number | null;
};

export type ClientMeterName = "documents_daily" | "writing_daily" | "writing_monthly";

export type ClientLimits = {
  month: string;
  monthly_uploads: number | null;
  extra_uploads: number;
  uploads_used: number;
  uploads_remaining: number | null;
  daily_limit_usd: number;
  spent_today_usd: number;
  revision: number;
  writing_daily_limit_usd: number | null;
  writing_monthly_limit_usd: number | null;
  resets: { daily: string; monthly: string };
  meters: Partial<Record<ClientMeterName | "deployment_daily", LimitsMeter>>;
  replayed?: boolean;
  grant?: { id: string; created_at: string } | null;
};

export type LimitChange = {
  setting: string;
  old_value: string | null;
  new_value: string | null;
  reason: string;
  changed_by: string;
  created_at: string;
};

export type LimitChangesPage = { items: LimitChange[]; next: string | null };

/** The three client budgets the card shows, in order. The deployment meter is
 *  not per client and belongs to System health (P3). */
export const CLIENT_BUDGETS: ReadonlyArray<{ meter: ClientMeterName; label: string; period: "today" | "month" }> = [
  { meter: "documents_daily", label: "Documents (today)", period: "today" },
  { meter: "writing_daily", label: "Writing (today)", period: "today" },
  { meter: "writing_monthly", label: "Writing (this month)", period: "month" },
];

/** An instant as "6 Oct 2026, 00:00 UTC", whatever the browser's zone (the one
 *  shared formatter, `utc-reset.ts`). */
export function formatUtc(iso: string): string {
  return utcStamp(iso) ?? "Not recorded";
}

/** US dollars as "US$10.00"; a missing amount is "Not set", never US$0.00. */
export function formatUsd(amount: number | null | undefined): string {
  if (amount === null || amount === undefined || !Number.isFinite(amount)) return "Not set";
  return `US$${amount.toFixed(2)}`;
}

export type MeterView = {
  /** The bar's width as a fraction, or null when there is no bar to draw. */
  fraction: number | null;
  /** What the bar says: a percentage, "Not set" or "Not available". Never "0%" for a missing figure. */
  usage: string;
  /** "Limit reached" only when the backend says the meter is not available
   *  and it has a figure (Ruling 11); null otherwise. */
  status: string | null;
};

// ---- one reading of a meter, shared with the client's Usage (P2.6) -------------
// The operator card and the client's Settings -> Usage show the same meters. Both
// read a meter's state here, so the two cannot disagree about when a meter is
// reached, unavailable or nearly used up, nor spell those states differently.

export const LIMIT_REACHED = "Limit reached";
export const NOT_AVAILABLE = "Not available";
/** Spec 10A.3: at 80% the client is told the limit is approaching. */
export const NEAR_FRACTION = 0.8;

export type MeterState = "unavailable" | "reached" | "near" | "ok";

/** `available == false` is the only "reached" signal (Ruling 11): a fraction of
 *  1.0 that is still available admits one more reply and is "near". A missing
 *  fraction is "unavailable", never 0 and never full. */
export function meterState(meter: { used_fraction: number | null; available: boolean }): MeterState {
  if (meter.used_fraction === null || !Number.isFinite(meter.used_fraction)) return "unavailable";
  if (!meter.available) return "reached";
  return clampFraction(meter.used_fraction) >= NEAR_FRACTION ? "near" : "ok";
}

export function clampFraction(fraction: number): number {
  return Math.min(1, Math.max(0, fraction));
}

/** "42% used", from a fraction clamped to [0, 1]. */
export function percentUsed(fraction: number): string {
  return `${Math.round(clampFraction(fraction) * 100)}% used`;
}

/** How one budget's use is shown. `available` alone decides "Limit reached": a
 *  fraction of exactly 1.0 that is still available admits one more reply. */
export function meterView(meter: LimitsMeter | undefined): MeterView {
  if (!meter || meter.limit_usd === null) {
    return { fraction: null, usage: "Not set", status: "Refused until a limit is set" };
  }
  const state = meterState(meter);
  if (state === "unavailable" || meter.used_fraction === null) {
    return { fraction: null, usage: NOT_AVAILABLE, status: meter.available ? null : "Refused by the deployment's settings" };
  }
  const fraction = clampFraction(meter.used_fraction);
  return {
    fraction,
    usage: percentUsed(fraction),
    status: state === "reached" ? LIMIT_REACHED : null,
  };
}

export type UploadsView = { base: string; extra: string; used: string; remaining: string };

export function uploadsView(limits: Pick<ClientLimits, "monthly_uploads" | "extra_uploads" | "uploads_used" | "uploads_remaining">): UploadsView {
  return {
    base: limits.monthly_uploads === null ? "Unlimited" : String(limits.monthly_uploads),
    extra: String(limits.extra_uploads),
    used: String(limits.uploads_used),
    remaining: limits.uploads_remaining === null ? "Unlimited" : String(limits.uploads_remaining),
  };
}

// ---- the edit form ------------------------------------------------------------

export type LimitsForm = {
  unlimitedUploads: boolean;
  monthlyUploads: string;
  documentsDaily: string;
  writingDaily: string;
  writingMonthly: string;
};

export function formFromLimits(limits: ClientLimits): LimitsForm {
  const amount = (value: number | null) => (value === null ? "" : String(value));
  return {
    unlimitedUploads: limits.monthly_uploads === null,
    monthlyUploads: limits.monthly_uploads === null ? "" : String(limits.monthly_uploads),
    documentsDaily: amount(limits.daily_limit_usd),
    writingDaily: amount(limits.writing_daily_limit_usd),
    writingMonthly: amount(limits.writing_monthly_limit_usd),
  };
}

/** After a stale edit (409 `stale_limits`) the limits are read again: the values
 *  the operator typed are kept, and every value they did not touch takes the
 *  current one, so saving again never silently reverts someone else's change. */
export function mergeForm(current: LimitsForm, typed: LimitsForm, touched: ReadonlySet<keyof LimitsForm>): LimitsForm {
  const merged = { ...current };
  for (const field of touched) (merged as Record<string, unknown>)[field] = typed[field];
  return merged;
}

export type LimitsChange = {
  monthly_uploads?: number | null;
  daily_limit_usd?: number;
  writing_daily_usd?: number;
  writing_monthly_usd?: number;
};

const MAX_USD = 10_000;

/** Only the settings the operator actually changed, against the limits they
 *  were editing; or the first problem with what they typed. */
export function changedLimits(limits: ClientLimits, form: LimitsForm): { change: LimitsChange; error: string | null } {
  const change: LimitsChange = {};
  if (form.unlimitedUploads) {
    if (limits.monthly_uploads !== null) change.monthly_uploads = null;
  } else {
    const text = form.monthlyUploads.trim();
    const uploads = Number(text);
    if (!text || !Number.isInteger(uploads) || uploads < 0) {
      return { change: {}, error: "Enter the monthly upload allowance as a whole number of 0 or more, or choose Unlimited." };
    }
    if (uploads !== limits.monthly_uploads) change.monthly_uploads = uploads;
  }
  const budgets: Array<[keyof LimitsChange, string, number | null, string]> = [
    ["daily_limit_usd", form.documentsDaily, limits.daily_limit_usd, "Documents daily"],
    ["writing_daily_usd", form.writingDaily, limits.writing_daily_limit_usd, "Writing daily"],
    ["writing_monthly_usd", form.writingMonthly, limits.writing_monthly_limit_usd, "Writing monthly"],
  ];
  for (const [field, typed, current, label] of budgets) {
    const text = typed.trim();
    if (!text && current === null) continue; // still not configured: nothing to change
    const amount = Number(text);
    if (!text || !Number.isFinite(amount) || amount <= 0 || amount > MAX_USD) {
      return { change: {}, error: `Enter the ${label} budget as an amount above US$0 and at most US$10,000.` };
    }
    if (Math.round(amount * 1_000_000) !== (current === null ? null : Math.round(current * 1_000_000))) {
      (change as Record<string, number>)[field] = amount;
    }
  }
  return { change, error: null };
}

/** The PUT body for an edit, made against the BASELINE the form was built from:
 *  its values decide what changed and its revision is `expected_revision`. Never
 *  the newest limits another card brought back (an extra-uploads reply carries the
 *  current revision): that would diff a stale form against someone else's newer
 *  values and send them back as "changes" under the newer revision, silently
 *  reverting them (spec §10.2). With the baseline, such a save is `stale_limits`. */
export function limitsEditBody(
  baseline: ClientLimits,
  form: LimitsForm,
  reason: string,
): { body: Record<string, unknown> | null; error: string | null } {
  const { change, error } = changedLimits(baseline, form);
  if (error) return { body: null, error };
  if (Object.keys(change).length === 0) return { body: null, error: "Nothing has changed. Edit a value before saving." };
  if (!reason.trim()) return { body: null, error: "Give a reason for the change." };
  return { body: { ...change, reason: reason.trim(), expected_revision: baseline.revision }, error: null };
}

// ---- history --------------------------------------------------------------------

const SETTING_LABELS: Record<string, string> = {
  monthly_uploads: "Monthly upload allowance",
  extra_uploads: "Extra uploads",
  daily_limit_usd: "Documents daily budget",
  writing_daily_usd: "Writing daily budget",
  writing_monthly_usd: "Writing monthly budget",
};

const MONEY_SETTINGS = new Set(["daily_limit_usd", "writing_daily_usd", "writing_monthly_usd"]);

export function settingLabel(setting: string): string {
  return SETTING_LABELS[setting] ?? setting;
}

/** One recorded value in the history, as the operator reads it. */
export function historyValue(setting: string, value: string | null): string {
  if (value === null) return setting === "monthly_uploads" ? "Unlimited" : "—";
  if (MONEY_SETTINGS.has(setting)) {
    const amount = Number(value);
    return Number.isFinite(amount) ? formatUsd(amount) : value;
  }
  return value;
}

/** The server's principal, shown as the spec names it (§2). Never a typed name. */
export function principalLabel(changedBy: string): string {
  return changedBy === "operator:shared-passcode" ? "Operator (shared access)" : changedBy;
}

// ---- outcomes -----------------------------------------------------------------

export const STALE_LIMITS_MESSAGE =
  "These limits were changed by someone else. Review the current values and save again.";

/** Said after 409 `intent_key_reused` on extra uploads, once the limits and history
 *  are read again: an earlier attempt of this action landed. */
export const EARLIER_ATTEMPT_SAVED_MESSAGE = "Your earlier attempt was saved. Here are the current values.";

export const RELOAD_FAILED_MESSAGE =
  "The current values could not be loaded, so what is shown may be out of date. Reload the page before saving.";

/** The plain sentence for a refused limits request, by the backend's code. */
export function limitsRefusalMessage(code: string | null, fallback: string): string {
  switch (code) {
    case "stale_limits":
      return STALE_LIMITS_MESSAGE;
    case "intent_key_reused":
      return EARLIER_ATTEMPT_SAVED_MESSAGE;
    case "writing_limit_below_one_reply":
      return "A writing limit must cover at least one reply. Enter a higher amount.";
    case "daily_limit_required":
      return "The Documents daily budget cannot be removed. Enter an amount.";
    case "writing_limit_required":
      return "A writing budget cannot be removed once set. Enter an amount.";
    case "invalid_cursor":
      return "Older changes could not be loaded. Reload the history and try again.";
    case "limits_not_provisioned":
      return "This client's limits are not set up yet.";
    case "nothing_to_change":
      return "Nothing has changed. Edit a value before saving.";
    case "intent_key_required":
      return "Something went wrong in the console: the request had no valid action key, so nothing was changed. Reload the page and try again.";
    default:
      return fallback;
  }
}

/** No definitive answer. The values and history are read again, so the operator
 *  sees whether it was saved before trying again. */
export const RETRY_MESSAGE =
  "We did not hear back, so this may or may not have been saved. Check the values and the history before trying again.";
