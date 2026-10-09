/**
 * Cycle 5, P1.6 (spec 10A.3-10A.4): which writing limit refused a reply, and the
 * sentence that says so.
 *
 * The turn-budget `reserve` answers a budget refusal with a 429 whose `detail`
 * is unchanged and whose `limit` names the meter, its period, how full it is,
 * when it resets (UTC) and why. At 100% the chat must say which limit was
 * reached and when it resets, never "try again shortly".
 *
 * Not under `src/agent/`, and without a server-only import, on purpose: the
 * composer and Usage (P2.6) show the same sentence beside the affected action,
 * so there is ONE helper for both and no second copy of the wording to drift.
 *
 * The monthly upload refusal (`429 monthly_upload_limit`) has the same shape
 * since P2.2: `meter: "uploads_monthly"`, with `used_fraction` beside its
 * `used` and `allowed`, so every `limit` body is read here.
 */

import { utcDay, utcTime } from "./utc-reset";

export type LimitMeter = "writing_daily" | "writing_monthly" | "deployment_daily" | "uploads_monthly";
export type LimitReason = "budget_exhausted" | "policy_missing" | "reconciliation_required" | "monthly_upload_limit";

export type LimitRefusal = {
  meter: LimitMeter;
  period: "day" | "month";
  /** Clamped to [0, 1] by the backend; a refusal reads as full. */
  used_fraction: number;
  /** ISO 8601, UTC. */
  resets_at: string;
  reason: LimitReason;
};

const METERS: readonly string[] = ["writing_daily", "writing_monthly", "deployment_daily", "uploads_monthly"];
const REASONS: readonly string[] = [
  "budget_exhausted", "policy_missing", "reconciliation_required", "monthly_upload_limit",
];
const PERIODS: readonly string[] = ["day", "month"];

/** The day a limit resets, in UTC: "1 November" (the one shared formatter). */
function resetDay(resetsAt: string): string {
  return utcDay(resetsAt) ?? "";
}

/** The sentence a refused reply shows. Names the limit and when it resets. */
export function limitRefusalCopy(limit: LimitRefusal): string {
  if (limit.reason === "policy_missing") {
    return "Writing isn't set up for this account yet. Please contact support.";
  }
  switch (limit.meter) {
    case "writing_daily":
      return "Today's writing limit is reached. It resets at 00:00 UTC.";
    case "writing_monthly":
      return `This month's writing limit is reached. It resets on ${resetDay(limit.resets_at)} at 00:00 UTC.`;
    case "deployment_daily":
      return "Writing is paused for everyone until 00:00 UTC.";
    case "uploads_monthly":
      return `This month's upload limit is reached. It resets on ${resetDay(limit.resets_at)} at 00:00 UTC.`;
  }
}

/** A `limit` this helper can speak for, or null. Anything else -- an unknown
 *  meter, a missing or unreadable reset -- falls back to the caller's own copy
 *  rather than a sentence that might name the wrong limit. */
export function parseLimitRefusal(value: unknown): LimitRefusal | null {
  if (typeof value !== "object" || value === null) return null;
  const limit = value as Record<string, unknown>;
  if (typeof limit.meter !== "string" || !METERS.includes(limit.meter)) return null;
  if (typeof limit.reason !== "string" || !REASONS.includes(limit.reason)) return null;
  if (typeof limit.period !== "string" || !PERIODS.includes(limit.period)) return null;
  if (typeof limit.used_fraction !== "number" || !Number.isFinite(limit.used_fraction)) return null;
  if (typeof limit.resets_at !== "string" || Number.isNaN(Date.parse(limit.resets_at))) return null;
  return {
    meter: limit.meter as LimitMeter,
    period: limit.period as LimitRefusal["period"],
    used_fraction: limit.used_fraction,
    resets_at: limit.resets_at,
    reason: limit.reason as LimitReason,
  };
}

/** The `limit` of a thrown 429 (`lib/product.ts`'s `ProductHttpError` keeps the
 *  whole body), or null. Read by shape rather than `instanceof`, so a module
 *  loaded twice cannot hide it. */
export function limitFromError(error: unknown): LimitRefusal | null {
  if (typeof error !== "object" || error === null) return null;
  const { status, body } = error as { status?: unknown; body?: unknown };
  if (status !== 429 || typeof body !== "object" || body === null) return null;
  return parseLimitRefusal((body as { limit?: unknown }).limit);
}

/** A turn or campaign bucket's refusal (P1 milestone review, Minor 8): a budget
 *  refusal with no meter and no reset to name, so a neutral sentence rather
 *  than "try again shortly", which would send the client straight back into it.
 *  It does not say "nothing was saved": the client's message is recorded before
 *  the reservation is asked for. */
export const CAMPAIGN_BUDGET_COPY = "This campaign's writing budget is used up.";

/** The sentence for a refused reservation that is a BUDGET refusal, or null for
 *  any other failure (the caller keeps its own copy for those). A 429 with a
 *  readable `limit` names the limit and its reset; a 429 `budget_exhausted`
 *  without one is a turn or campaign bucket's refusal. */
export function budgetRefusalCopy(error: unknown): string | null {
  const limit = limitFromError(error);
  if (limit !== null) return limitRefusalCopy(limit);
  if (typeof error !== "object" || error === null) return null;
  const { status, body } = error as { status?: unknown; body?: unknown };
  if (status !== 429 || typeof body !== "object" || body === null) return null;
  const detail = (body as { detail?: unknown }).detail;
  const code = typeof detail === "object" && detail !== null ? (detail as { code?: unknown }).code : undefined;
  return code === "budget_exhausted" ? CAMPAIGN_BUDGET_COPY : null;
}

/** A refused reservation that is the deployment's CONFIGURATION refusing every
 *  reply (the reserve's `503 {"code": "unavailable"}`: no per-turn worst case, or one
 *  that does not cover a model call; Ruling 32). It does not clear by itself, so it
 *  never says "try again shortly" (P2 milestone review M6). */
export const WRITING_NOT_AVAILABLE_COPY =
  "Writing isn't available for this account right now. Please contact support.";

/** Any other refused or failed start. It does not say "nothing was saved": the
 *  client's message is recorded before the reservation is asked for (P2.6 review M2). */
export const NOT_STARTED_COPY = "I can't start this one right now. Nothing was sent — try again shortly.";

function isConfigurationRefusal(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const { status, body } = error as { status?: unknown; body?: unknown };
  if (status !== 503 || typeof body !== "object" || body === null) return false;
  const detail = (body as { detail?: unknown }).detail;
  return typeof detail === "object" && detail !== null && (detail as { code?: unknown }).code === "unavailable";
}

/** One turn id is one reservation and one run (Ruling 70): a reserve for an id
 *  whose reservation is still open is `409 turn_in_progress`. A reply under it is
 *  already running, so this one is not started, and nothing retries the same id. */
export const TURN_IN_PROGRESS_COPY = "A reply to this message is already being written.";
/** ... and for an id whose reservation has finished, `409 turn_settled`: that
 *  reply is done; nothing more runs under the id. */
export const TURN_SETTLED_COPY = "This message has already been answered.";

/** The sentence for a reserve refused because its id already has a
 *  reservation, or null for any other failure. */
export function turnConflictCopy(error: unknown): string | null {
  if (typeof error !== "object" || error === null) return null;
  const { status, body } = error as { status?: unknown; body?: unknown };
  if (status !== 409 || typeof body !== "object" || body === null) return null;
  const detail = (body as { detail?: unknown }).detail;
  const code = typeof detail === "object" && detail !== null ? (detail as { code?: unknown }).code : undefined;
  if (code === "turn_in_progress") return TURN_IN_PROGRESS_COPY;
  if (code === "turn_settled") return TURN_SETTLED_COPY;
  return null;
}

/** The sentence for any refused reservation: a budget refusal names its limit
 *  (`budgetRefusalCopy`), a reserve for an id that already has one says that
 *  reply is running or done (`turnConflictCopy`), a configuration refusal sends
 *  the client to support, and anything else is a plain "not started". */
export function reserveRefusalCopy(error: unknown): string {
  return budgetRefusalCopy(error)
    ?? turnConflictCopy(error)
    ?? (isConfigurationRefusal(error) ? WRITING_NOT_AVAILABLE_COPY : NOT_STARTED_COPY);
}

/** Whether a writing reset is the monthly one. The backend names the binding
 *  meter (Ruling 37), which decides it, the last day of a month included. An
 *  older backend names none; then the reset's own kind decides: the first of a
 *  month at 00:00 UTC is a month boundary. */
function isMonthReset(at: Date, meter: "writing_daily" | "writing_monthly" | null | undefined): boolean {
  if (meter) return meter === "writing_monthly";
  return at.getUTCDate() === 1 && at.getUTCHours() === 0 && at.getUTCMinutes() === 0;
}

/** The composer's notice at 80% of a writing budget (spec 10A.3; the stream's
 *  `usage.approaching`). Names the budget and when it resets, in UTC. */
export function approachingCopy(resetsAt: string, meter?: "writing_daily" | "writing_monthly" | null): string {
  const at = new Date(resetsAt);
  if (Number.isNaN(at.getTime())) return "You've used most of your writing budget.";
  const time = utcTime(at);
  return isMonthReset(at, meter)
    ? `You've used most of this month's writing budget. It resets on ${resetDay(resetsAt)} at ${time}.`
    : `You've used most of today's writing budget. It resets at ${time}.`;
}
