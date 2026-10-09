// The operator System health page's shapes and pure display rules (Cycle 5 P3.3;
// spec §10.1, A31-A33, A39). Client-safe: no credential, no React, no fetch. The
// shapes mirror the backend's `GET /v2/ops/health` (`src/content_engine/ke/api/ops.py`;
// docs/API_CONTRACT.md, "GET /v2/ops/health").
//
// The page must be honest (spec §10.1): missing or stale telemetry never shows as
// green or as zero. So:
// - a section that is not `ok`, or whose data is missing, reads "Unavailable — <class>",
//   never an empty list or a 0 count;
// - a null figure reads "Not available", never US$0.00;
// - a `replaced` worker is history, collapsed and never counted as an alarm;
// - a client's spend row says why it cannot run paid work from `reason`, never from
//   `available` alone (Ruling 50): `available` is the meter's own verdict and can read
//   true while the deployment's daily limit refuses work (A39);
// - a failed refresh keeps the last good data and marks it stale, never blanks it.

import { utcDay, utcStamp, utcWhen } from "@/lib/utc-reset";

// ---- the backend's shape (lib/ops-health.ts) -----------------------------------

import type { DocumentCounts, NeedsPersonRow, OpsHealth, SectionBase, SpendRow, WaitingRow, WorkerRow } from "@/lib/ops-health";

export type Tone = "ok" | "warn" | "bad" | "neutral";

export const NOT_AVAILABLE = "Not available";
export const NOT_RECORDED = "Not recorded";

// ---- times --------------------------------------------------------------------

/** An instant through the shared UTC formatter (`utc-reset.ts`): "6 Oct 2026, 00:00 UTC". */
export function formatAt(iso: string | null | undefined): string {
  return utcStamp(iso) ?? NOT_RECORDED;
}

/** "Observed 7 Oct 2026, 09:00 UTC". */
export function observedLabel(observedAt: string | null | undefined): string {
  const at = utcStamp(observedAt);
  return at ? `Observed ${at}` : "Observation time not available";
}

/** A failed refresh over data already on screen. */
export function staleLabel(observedAt: string | null | undefined): string {
  return `Couldn't refresh · showing data from ${utcStamp(observedAt) ?? "an earlier read"}`;
}

/** "under 1 min", "45 min", "2 h 5 min", "3 d 4 h". Null (or unreadable) is "Not recorded". */
export function durationWords(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds) || seconds < 0) return NOT_RECORDED;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 1) return "under 1 min";
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ${minutes % 60} min`;
  return `${Math.floor(hours / 24)} d ${hours % 24} h`;
}

/** Seconds from `since` to `until`, or null when either cannot be read. */
export function secondsBetween(since: string | null | undefined, until: string | null | undefined): number | null {
  if (!since || !until) return null;
  const from = new Date(since).getTime();
  const to = new Date(until).getTime();
  if (Number.isNaN(from) || Number.isNaN(to)) return null;
  return Math.max(0, (to - from) / 1000);
}

// ---- names --------------------------------------------------------------------

/** The first eight characters of an id, for display only. */
export function shortId(id: string | null | undefined): string {
  return id ? id.slice(0, 8) : "unknown";
}

export type ClientDirectory = ReadonlyArray<{ id: string; name: string }>;

/** The API carries ids only; names come from the console's client list. A client
 *  missing from it is shown by its short id. */
export function clientLabel(clients: ClientDirectory, clientId: string | null | undefined): { name: string; known: boolean } {
  const found = clientId ? clients.find((client) => client.id === clientId) : undefined;
  return found ? { name: found.name, known: true } : { name: `Client ${shortId(clientId)}`, known: false };
}

function humanize(code: string | null | undefined): string {
  if (!code) return NOT_RECORDED;
  const words = code.replace(/_/g, " ").trim();
  return words ? words[0].toUpperCase() + words.slice(1) : NOT_RECORDED;
}

const ITEM_WORDS: Record<string, string> = {
  document: "Document",
  extraction: "Document evidence",
  mapping: "Knowledge mapping unit",
  queue_item: "Review item",
  pending_question: "Question",
  // P6.8 (0106): onboarding packets, unapplied answers and stuck source switches.
  onboarding_packet: "Onboarding packet",
  question_answer: "Client answer",
  // A "Use this source" switch or a Delete file request (0106, 0109): the reason says which.
  source_lifecycle_request: "Source request",
};

/** "Document 1a2b3c4d": the item kind in words and the short id of what it concerns. */
export function itemLabel(row: { item_kind: string; item_id: string; document_id: string | null }): string {
  return `${ITEM_WORDS[row.item_kind] ?? humanize(row.item_kind)} ${shortId(row.document_id ?? row.item_id)}`;
}

const STAGE_WORDS: Record<string, string> = {
  extraction: "Evidence extraction",
  mapping: "Knowledge mapping",
};

export function stageLabel(stage: string | null | undefined): string {
  return stage ? STAGE_WORDS[stage] ?? humanize(stage) : NOT_RECORDED;
}

// ---- unavailable sections -------------------------------------------------------

/** "Unavailable — <class>" when the section is not `ok` or its data is missing;
 *  null when the section can be shown. Never 0, never an empty list. */
export function sectionUnavailable(
  section: (SectionBase & Record<string, unknown>) | null | undefined,
  dataKey: string = "rows",
): string | null {
  if (!section) return "Unavailable — missing_section";
  if (section.status !== "ok") return `Unavailable — ${section.error || "unknown"}`;
  if (section[dataKey] === null || section[dataKey] === undefined) return "Unavailable — missing_data";
  return null;
}

// ---- workers --------------------------------------------------------------------

const LIVENESS: Record<string, { label: string; tone: Tone }> = {
  running: { label: "Running", tone: "ok" },
  idle: { label: "Idle", tone: "ok" },
  not_responding: { label: "Not responding", tone: "bad" },
  replaced: { label: "Replaced by a newer worker", tone: "neutral" },
  telemetry_unavailable: { label: "Telemetry unavailable", tone: "warn" },
  no_live_worker: { label: "No live worker", tone: "warn" },
};

/** A worker's status in words. An unknown class is a warning, never green. */
export function livenessView(liveness: string): { label: string; tone: Tone } {
  return LIVENESS[liveness] ?? { label: humanize(liveness), tone: "warn" };
}

/** Statuses that need no attention. `replaced` is what a deploy leaves behind: history,
 *  never an alarm. Every other status, an unknown one included, needs attention. */
const HEALTHY = new Set(["running", "idle"]);
const needsAttention = (liveness: string) => liveness !== "replaced" && !HEALTHY.has(liveness);

export type WorkerLine = {
  key: string;
  title: string;
  status: { label: string; tone: Tone };
  lanes: string;
  heartbeat: string;
  work: string;
  /** A lane with no live worker: shown as a warning. */
  laneWarning: boolean;
};

export type WorkersView = {
  rows: WorkerLine[];
  replaced: WorkerLine[];
  /** Rows that need attention; `replaced` never counts. */
  alarms: number;
};

function workLine(row: WorkerRow, clients: ClientDirectory): string {
  if (!row.current_job_kind && !row.current_item_id) return "No current work";
  const parts = [humanize(row.current_job_kind)];
  if (row.current_client_id) parts.push(clientLabel(clients, row.current_client_id).name);
  if (row.current_item_id) parts.push(`${ITEM_WORDS[row.current_item_kind ?? ""] ?? humanize(row.current_item_kind)} ${shortId(row.current_item_id)}`);
  const progress = row.task_progress_known && row.task_progress_at
    ? `last progress ${formatAt(row.task_progress_at)}`
    : "Progress unknown";
  return `${parts.join(" · ")} · ${progress}`;
}

export function workersView(rows: WorkerRow[], clients: ClientDirectory = []): WorkersView {
  const lines = rows.map((row, index): WorkerLine & { liveness: string } => {
    const lane = row.worker_id === null;
    return {
      key: row.worker_id ?? `lane-${row.lanes.join(",")}-${index}`,
      title: lane ? `Lane ${row.lanes.join(", ") || "unknown"}` : `Worker ${shortId(row.worker_id)}`,
      status: livenessView(row.liveness),
      lanes: row.lanes.length ? row.lanes.join(", ") : "No lanes recorded",
      heartbeat: row.last_seen ? formatAt(row.last_seen) : "No heartbeat recorded",
      work: lane ? "No live worker serves this lane" : workLine(row, clients),
      laneWarning: lane,
      liveness: row.liveness,
    };
  });
  const strip = ({ liveness: _liveness, ...line }: WorkerLine & { liveness: string }): WorkerLine => line;
  return {
    rows: lines.filter((line) => line.liveness !== "replaced").map(strip),
    replaced: lines.filter((line) => line.liveness === "replaced").map(strip),
    alarms: lines.filter((line) => needsAttention(line.liveness)).length,
  };
}

export function replacedSummary(count: number): string {
  return `Replaced by a newer worker (${count})`;
}

// ---- documents (24 h) -------------------------------------------------------------

export const DOCUMENT_COUNTS: ReadonlyArray<{ key: keyof DocumentCounts; label: string }> = [
  { key: "finished", label: "Finished" },
  { key: "still_processing", label: "Still processing" },
  { key: "failed", label: "Failed" },
  { key: "deleted", label: "Deleted or replaced" },
];

export function windowLabel(window: { start: string; end: string } | null | undefined): string {
  if (!window) return "Window not available";
  return `Added between ${formatAt(window.start)} and ${formatAt(window.end)} (rolling 24 hours)`;
}

// ---- waiting over one hour -------------------------------------------------------

/** How each wait is told apart (spec §10.1: human waits, daily spending limit pauses
 *  and scheduled retries are distinguished). */
/** `repair` (P3.5, Ruling 57): the engine is re-extracting a document after a roster change.
 *  Told apart from a stall: a roster change can queue several at once. */
export type WaitKind = "person" | "limit" | "retry" | "repair" | "stalled" | "unknown";

const WAIT_REASONS: Record<string, { label: string; kind: WaitKind; tone: Tone }> = {
  person: { label: "Waiting for a person", kind: "person", tone: "warn" },
  budget_day_limit: { label: "Paused for the client's daily spending limit", kind: "limit", tone: "neutral" },
  deployment_limit: { label: "Paused for the deployment's daily limit", kind: "limit", tone: "neutral" },
  retry_scheduled: { label: "Retry scheduled", kind: "retry", tone: "neutral" },
  repair_reextraction: { label: "Updating after a roster change", kind: "repair", tone: "neutral" },
  no_progress: { label: "No recorded progress", kind: "stalled", tone: "bad" },
  progress_unknown: { label: "Progress unknown", kind: "unknown", tone: "warn" },
};

export function waitReason(reason: string): { label: string; kind: WaitKind; tone: Tone } {
  return WAIT_REASONS[reason] ?? { label: humanize(reason), kind: "unknown", tone: "warn" };
}

export type WaitingLine = {
  key: string;
  issueId: string;
  documentId: string | null;
  clientId: string;
  client: string;
  item: string;
  stage: string;
  waitedSince: string;
  lastProgress: string;
  reason: { label: string; kind: WaitKind; tone: Tone };
  /** When the engine tries again by itself, or null. */
  continues: string | null;
};

export function waitingLine(row: WaitingRow, observedAt: string, clients: ClientDirectory = []): WaitingLine {
  const reason = waitReason(row.reason_class);
  const known = row.progress_known && Boolean(row.waiting_since);
  const elapsed = durationWords(secondsBetween(row.waiting_since, observedAt));
  const next = utcWhen(row.next_eligible_at, new Date(observedAt));
  return {
    key: row.issue_id,
    issueId: row.issue_id,
    documentId: row.document_id,
    clientId: row.client_id,
    client: clientLabel(clients, row.client_id).name,
    item: itemLabel(row),
    stage: stageLabel(row.stage),
    waitedSince: known ? `${formatAt(row.waiting_since)} (${elapsed})` : "Not recorded (over one hour)",
    lastProgress: known ? formatAt(row.waiting_since) : "Progress unknown",
    reason,
    continues: next ? `Continues ${next}${row.awaiting_supervisor ? " (provisional)" : ""}` : null,
  };
}

// ---- needs a person ----------------------------------------------------------------

const FUNCTION_WORDS: Record<string, string> = {
  client: "Client",
  operator: "Operator",
  support: "Technical support",
};

const ACTION_WORDS: Record<string, string> = {
  split_the_file: "Split the file",
  confirm_triage: "Confirm the triage",
  confirm_event_date: "Confirm the event date",
  confirm_split: "Confirm the split",
  confirm_speakers: "Confirm the speakers",
  review_duplicate: "Review the suspected duplicate",
  confirm_person: "Confirm the person",
  resolve_person_conflict: "Resolve the person conflict",
  authorize_spend: "Authorize the spend",
  approve_rerun: "Approve the rerun",
  approve_vision_reading: "Approve the vision reading",
  review_unreadable_input: "Review the unreadable input",
  investigate_failure: "Investigate the failure",
  investigate_capacity: "Investigate the capacity wait",
  // P3.5 (Ruling 56): a repair that paused for good runs again only when an operator re-runs
  // it: `scripts/ke_repair_stale_releases.py --client <id>` (docs/API_CONTRACT.md).
  rerun_repair: "Re-run the roster repair (ke_repair_stale_releases.py)",
  investigate_provider: "Investigate the provider",
  review_unsupported_format: "Review the unsupported format",
  answer_question: "Answer the question",
  add_readable_copy: "Add a readable copy",
  reconcile_spend: "Reconcile unknown costs",
  set_limits: "Set the client's limits",
  review_daily_limit: "Review the daily spending limit",
  review_deployment_limit: "Review the deployment's daily limit",
  review_item: "Review the item",
  // P6.8 (0106; Rulings 75, 76).
  retry_onboarding_packet: "Onboarding packet failed — retry",
  apply_client_answer: "Apply the client's answer (it could not be saved)",
  review_source_switch: "Review the source switch",
  // Whole-branch review A-I1 (0109): the row's Retry delete queues the purge again (Ruling 93).
  restart_source_delete: "File delete stopped — retry",
};

/** Reasons worded by hand; every other reason class is humanized. */
const REASON_WORDS: Record<string, string> = {
  source_switch_not_applied: "Source switch couldn't be applied",
  source_delete_not_finished: "File delete stopped before it finished",
  onboarding_packet_failed: "The onboarding questions could not be prepared",
  answer_not_applied: "Saved but not applied",
  answer_refused: "Refused when applied; the client was asked to answer again",
};

/** Actions whose detail is the client's Limits section; everything else is Sources. */
const LIMITS_ACTIONS = new Set([
  "authorize_spend", "reconcile_spend", "set_limits", "review_daily_limit", "review_deployment_limit",
]);

export type DetailSection = "sources" | "limits";

/** The one Needs-a-person action System health can take itself (Ruling 93): Retry delete. */
export const RETRY_DELETE_ACTION = "restart_source_delete";

/** True for a stuck Delete file row that names its source, the only row with a Retry delete button. */
export function retriesDelete(row: { action_class: string; document_id: string | null }): boolean {
  return row.action_class === RETRY_DELETE_ACTION && Boolean(row.document_id);
}

export type NeedsPersonLine = {
  key: string;
  issueId: string;
  documentId: string | null;
  clientId: string;
  client: string;
  item: string;
  /** Client, Operator or Technical support. Never a named person. */
  who: string;
  action: string;
  reason: string;
  age: string;
  detail: { section: DetailSection; label: string };
};

export function needsPersonLine(row: NeedsPersonRow, clients: ClientDirectory = []): NeedsPersonLine {
  const section: DetailSection = LIMITS_ACTIONS.has(row.action_class) ? "limits" : "sources";
  return {
    key: row.issue_id,
    issueId: row.issue_id,
    documentId: row.document_id,
    clientId: row.client_id,
    client: clientLabel(clients, row.client_id).name,
    item: itemLabel(row),
    who: FUNCTION_WORDS[row.function] ?? humanize(row.function),
    action: ACTION_WORDS[row.action_class] ?? humanize(row.action_class),
    reason: REASON_WORDS[row.reason_class] ?? humanize(row.reason_class),
    age: durationWords(row.age_seconds),
    detail: { section, label: section === "limits" ? "Open Limits" : "Open Sources" },
  };
}

// ---- one issue, one identity (spec §10.1; Ruling 50) -------------------------------

/** The key that relates a waiting row and a needs-person row: the document when there
 *  is one (Ruling 50), else the issue id the backend derived. */
export function issueKey(row: { document_id: string | null; issue_id: string }): string {
  return row.document_id ? `document:${row.document_id}` : `issue:${row.issue_id}`;
}

/** Keys seen in both sections, each with the one marker both rows show. */
export function linkedIssues(
  waiting: ReadonlyArray<{ document_id: string | null; issue_id: string }>,
  needs: ReadonlyArray<{ document_id: string | null; issue_id: string }>,
): Map<string, string> {
  const inNeeds = new Set(needs.map(issueKey));
  const sameId = new Set(needs.map((row) => row.issue_id));
  const markers = new Map<string, string>();
  for (const row of waiting) {
    const key = issueKey(row);
    if ((inNeeds.has(key) || sameId.has(row.issue_id)) && !markers.has(key)) {
      markers.set(key, `Same issue · ${shortId(row.document_id ?? row.issue_id)}`);
    }
  }
  return markers;
}

/** The marker a row shows, when the same issue is in the other section too. */
export function issueMarker(
  markers: Map<string, string>,
  row: { document_id: string | null; issue_id: string },
  waiting: ReadonlyArray<{ document_id: string | null; issue_id: string }> = [],
): string | null {
  const direct = markers.get(issueKey(row));
  if (direct) return direct;
  const twin = waiting.find((candidate) => candidate.issue_id === row.issue_id);
  return twin ? markers.get(issueKey(twin)) ?? null : null;
}

// ---- today's AI spend ---------------------------------------------------------------

const METER_WORDS: Record<string, string> = {
  documents_daily: "Documents (today)",
  writing_daily: "Writing (today)",
  writing_monthly: "Writing (this month)",
  deployment_daily: "Deployment-wide daily safeguard",
};

export function meterLabel(meter: string): string {
  return METER_WORDS[meter] ?? humanize(meter);
}

/** Money in its currency: "US$12.40"; an amount under one cent is "under US$0.01",
 *  never "US$0.00"; null is "Not available", never 0. */
export function formatMoney(amount: number | null | undefined, currency: string | null | undefined): string {
  if (amount === null || amount === undefined || !Number.isFinite(amount)) return NOT_AVAILABLE;
  const prefix = !currency || currency === "USD" ? "US$" : `${currency} `;
  if (amount > 0 && amount < 0.01) return `under ${prefix}0.01`;
  return `${prefix}${amount.toFixed(2)}`;
}

const SPEND_REASONS: Record<string, { label: string; tone: Tone }> = {
  writing_not_configured: { label: "Writing isn't configured for this deployment", tone: "bad" },
  policy_missing: { label: "No limit configured (not unlimited)", tone: "bad" },
  reconciliation_required: { label: "Unknown costs need reconciling", tone: "bad" },
  deployment_limit: { label: "Paused: the deployment's daily limit is reached (not this client's budget)", tone: "bad" },
  budget_exhausted: { label: "This client's budget is used up", tone: "bad" },
};

/** Whether this meter can take paid work now, and why not. `reason` decides (Ruling 50):
 *  a row reading `available: true` with a reason is refused for that reason. */
export function spendStatus(row: Pick<SpendRow, "available" | "reason"> & { scope?: SpendRow["scope"] }): { label: string; tone: Tone } {
  if (row.scope === "deployment" && row.reason === "deployment_limit") {
    return { label: "Daily limit reached: paid work is paused for every client", tone: "bad" };
  }
  if (row.reason) return SPEND_REASONS[row.reason] ?? { label: `Refused: ${humanize(row.reason)}`, tone: "bad" };
  if (row.available === true) return { label: "Can run paid work", tone: "ok" };
  return { label: "Not available", tone: "warn" };
}

/** Unknown costs on their own line: "at least" while reconciliation is required,
 *  because an outcome with no amount is counted but not priced. Null when none. */
export function uncertainLine(row: Pick<SpendRow, "uncertain_usd" | "uncertain_calls" | "reconciliation_required" | "currency">): string | null {
  const calls = row.uncertain_calls ?? 0;
  const amount = row.uncertain_usd;
  if (!row.reconciliation_required && calls === 0 && (amount === null || amount === 0)) return null;
  const callWords = `${calls} ${calls === 1 ? "call" : "calls"}`;
  if (amount === null || amount === undefined) return `Unknown costs: ${NOT_AVAILABLE} (${callWords})`;
  const money = formatMoney(amount, row.currency);
  return row.reconciliation_required
    ? `Unknown costs: at least ${money} (${callWords}, reconciliation required)`
    : `Unknown costs: ${money} (${callWords})`;
}

export type SpendLine = {
  key: string;
  meter: string;
  status: { label: string; tone: Tone };
  known: string;
  reserved: string;
  uncertain: string | null;
  limit: string;
  remaining: string;
  resets: string;
};

export function spendLine(row: SpendRow): SpendLine {
  return {
    key: `${row.client_id ?? "deployment"}:${row.meter}`,
    meter: meterLabel(row.meter),
    status: spendStatus(row),
    known: formatMoney(row.known_usd, row.currency),
    reserved: formatMoney(row.reserved_usd, row.currency),
    uncertain: uncertainLine(row),
    limit: formatMoney(row.limit_usd, row.currency),
    remaining: formatMoney(row.remaining_usd, row.currency),
    resets: `Resets ${formatAt(row.resets_at)}`,
  };
}

export type SpendClientGroup = { clientId: string; client: string; known: boolean; lines: SpendLine[] };

const METER_ORDER = ["documents_daily", "writing_daily", "writing_monthly"];

/** Client rows grouped per client, in the client list's name order, meters in a fixed order. */
export function spendGroups(rows: SpendRow[], clients: ClientDirectory = []): SpendClientGroup[] {
  const groups = new Map<string, SpendRow[]>();
  for (const row of rows) {
    const id = row.client_id ?? "";
    groups.set(id, [...(groups.get(id) ?? []), row]);
  }
  return [...groups].map(([clientId, meters]) => {
    const label = clientLabel(clients, clientId);
    return {
      clientId,
      client: label.name,
      known: label.known,
      lines: [...meters]
        .sort((left, right) => METER_ORDER.indexOf(left.meter) - METER_ORDER.indexOf(right.meter))
        .map(spendLine),
    };
  }).sort((left, right) => left.client.localeCompare(right.client));
}

/** "UTC accounting day 7 Oct 2026 · resets 8 Oct 2026, 00:00 UTC · USD". */
export function accountingLabel(spend: { accounting_day: string | null; resets_at: string | null; currency: string | null }): string {
  const day = spend.accounting_day ? utcDay(`${spend.accounting_day}T00:00:00Z`, { short: true, year: true }) : null;
  return `UTC accounting day ${day ?? NOT_AVAILABLE} · resets ${utcStamp(spend.resets_at) ?? NOT_AVAILABLE} · currency ${spend.currency ?? NOT_AVAILABLE}`;
}

// ---- what the page holds between reads ----------------------------------------------

export type HealthState = {
  /** The last good read; kept through failed refreshes. */
  data: OpsHealth | null;
  /** The latest refresh failed; `data` (if any) is from an earlier read. */
  stale: boolean;
  /** Why the latest read failed, or null. */
  error: string | null;
};

export const INITIAL_HEALTH: HealthState = { data: null, stale: false, error: null };

export type HealthEvent = { type: "loaded"; data: OpsHealth } | { type: "failed"; message: string };

/** A read's outcome. A failure never blanks or zeroes data already shown: it keeps the
 *  last good read and marks it stale. */
export function healthReducer(state: HealthState, event: HealthEvent): HealthState {
  if (event.type === "loaded") return { data: event.data, stale: false, error: null };
  return { data: state.data, stale: state.data !== null, error: event.message };
}
