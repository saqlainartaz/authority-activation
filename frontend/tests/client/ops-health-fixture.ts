import type { OpsHealth, SpendRow } from "@/lib/ops-health";

// A synthetic `GET /v2/ops/health` reply for the System health tests (Cycle 5 P3.3).
// Its shape follows docs/API_CONTRACT.md ("GET /v2/ops/health"). Synthetic ids only.

export const CLIENT_A = "11111111-aaaa-4aaa-8aaa-111111111111";
export const CLIENT_B = "22222222-bbbb-4bbb-8bbb-222222222222";
/** A client the console's list does not have. */
export const CLIENT_X = "99999999-cccc-4ccc-8ccc-999999999999";
export const CLIENTS = [
  { id: CLIENT_A, name: "Juniper Studio" },
  { id: CLIENT_B, name: "Cedar Works" },
];

/** A C2 extraction held for a person: in Waiting and in Needs a person, one issue. */
export const DOC_HELD = "d0c0e1d0-0000-4000-8000-000000000001";
export const ISSUE_HELD = "155e0001-0000-5000-8000-000000000001";
export const OBSERVED_AT = "2026-10-07T09:00:00+00:00";

function spend(meter: string, client: string | null, extra: Partial<SpendRow> = {}): SpendRow {
  const month = meter === "writing_monthly";
  return {
    scope: client ? "client" : "deployment",
    ...(client ? { client_id: client } : {}),
    meter,
    period: month ? "month" : "day",
    period_start: month ? "2026-10-01" : "2026-10-07",
    resets_at: month ? "2026-11-01T00:00:00+00:00" : "2026-10-08T00:00:00+00:00",
    currency: "USD",
    limit_usd: 15,
    known_usd: 3.2,
    reserved_usd: 0.5,
    uncertain_usd: 0,
    exposure_usd: 3.7,
    remaining_usd: 11.3,
    uncertain_calls: 0,
    reconciliation_required: false,
    held_for_day_limit: false,
    available: true,
    reason: null,
    ...extra,
  };
}

export function opsHealth(): OpsHealth {
  return {
    observed_at: OBSERVED_AT,
    sections: {
      workers: {
        status: "ok",
        error: null,
        rows: [
          {
            worker_id: "a0a0a0a0-0000-4000-8000-00000000000a", lanes: ["ingest", "knowledge"],
            last_seen: "2026-10-07T08:59:50+00:00", liveness: "running",
            current_job_id: "10b00000-0000-4000-8000-000000000001", current_job_kind: "extract",
            current_client_id: CLIENT_A, current_item_kind: "extraction", current_item_id: "d0c0e1d0-0000-4000-8000-000000000009",
            task_progress_at: "2026-10-07T08:58:00+00:00", task_progress_known: true,
          },
          {
            worker_id: "b0b0b0b0-0000-4000-8000-00000000000b", lanes: ["generate", "publish"],
            last_seen: "2026-10-07T08:59:55+00:00", liveness: "idle",
            current_job_id: null, current_job_kind: null, current_client_id: null, current_item_kind: null,
            current_item_id: null, task_progress_at: null, task_progress_known: null,
          },
          {
            worker_id: "c0c0c0c0-0000-4000-8000-00000000000c", lanes: ["ingest"],
            last_seen: "2026-10-06T20:00:00+00:00", liveness: "replaced",
            current_job_id: null, current_job_kind: null, current_client_id: null, current_item_kind: null,
            current_item_id: null, task_progress_at: null, task_progress_known: null,
          },
          {
            worker_id: "c1c1c1c1-0000-4000-8000-00000000000d", lanes: ["knowledge"],
            last_seen: "2026-10-06T20:01:00+00:00", liveness: "replaced",
            current_job_id: null, current_job_kind: null, current_client_id: null, current_item_kind: null,
            current_item_id: null, task_progress_at: null, task_progress_known: null,
          },
        ],
      },
      documents_24h: {
        status: "ok",
        error: null,
        window: { start: "2026-10-06T09:00:00+00:00", end: "2026-10-07T09:00:00+00:00" },
        counts: { finished: 5, still_processing: 2, failed: 1, deleted: 1 },
        rows: [
          { client_id: CLIENT_A, finished: 4, still_processing: 1, failed: 1, deleted: 0 },
          { client_id: CLIENT_B, finished: 1, still_processing: 1, failed: 0, deleted: 1 },
        ],
      },
      waiting: {
        status: "ok",
        error: null,
        min_age_minutes: 60,
        rows: [
          {
            issue_id: ISSUE_HELD, client_id: CLIENT_A, item_kind: "extraction", item_id: DOC_HELD, document_id: DOC_HELD,
            stage: "extraction", waiting_since: "2026-10-07T06:30:00+00:00", reason_class: "person",
            progress_known: true, next_eligible_at: null, awaiting_supervisor: false,
          },
          {
            issue_id: "155e0002-0000-5000-8000-000000000002", client_id: CLIENT_B, item_kind: "document",
            item_id: "d0c0e1d0-0000-4000-8000-000000000002", document_id: "d0c0e1d0-0000-4000-8000-000000000002",
            stage: "budget_paused", waiting_since: "2026-10-07T07:00:00+00:00", reason_class: "budget_day_limit",
            progress_known: true, next_eligible_at: "2026-10-08T00:00:00+00:00", awaiting_supervisor: false,
          },
          {
            issue_id: "155e0003-0000-5000-8000-000000000003", client_id: CLIENT_A, item_kind: "mapping",
            item_id: "a11a0000-0000-4000-8000-000000000003", document_id: "d0c0e1d0-0000-4000-8000-000000000003",
            stage: "mapping", waiting_since: "2026-10-07T07:40:00+00:00", reason_class: "retry_scheduled",
            progress_known: true, next_eligible_at: "2026-10-07T09:20:00+00:00", awaiting_supervisor: false,
          },
          {
            issue_id: "155e0004-0000-5000-8000-000000000004", client_id: CLIENT_X, item_kind: "document",
            item_id: "d0c0e1d0-0000-4000-8000-000000000004", document_id: "d0c0e1d0-0000-4000-8000-000000000004",
            stage: "parsing", waiting_since: null, reason_class: "progress_unknown",
            progress_known: false, next_eligible_at: null, awaiting_supervisor: false,
          },
          {
            issue_id: "155e0005-0000-5000-8000-000000000005", client_id: CLIENT_A, item_kind: "extraction",
            item_id: "d0c0e1d0-0000-4000-8000-000000000005", document_id: "d0c0e1d0-0000-4000-8000-000000000005",
            stage: "extraction", waiting_since: "2026-10-07T07:15:00+00:00", reason_class: "no_progress",
            progress_known: true, next_eligible_at: null, awaiting_supervisor: false,
          },
        ],
      },
      needs_person: {
        status: "ok",
        error: null,
        rows: [
          {
            issue_id: ISSUE_HELD, client_id: CLIENT_A, item_kind: "extraction", item_id: DOC_HELD, document_id: DOC_HELD,
            function: "operator", action_class: "authorize_spend", reason_class: "document_budget_paused",
            opened_at: "2026-10-07T06:30:00+00:00", age_seconds: 9000,
          },
          {
            issue_id: "155e0006-0000-5000-8000-000000000006", client_id: CLIENT_B, item_kind: "queue_item",
            item_id: "9ee00000-0000-4000-8000-000000000006", document_id: "d0c0e1d0-0000-4000-8000-000000000006",
            function: "client", action_class: "split_the_file", reason_class: "input_too_large",
            opened_at: "2026-10-07T08:00:00+00:00", age_seconds: 3600,
          },
          {
            issue_id: "155e0007-0000-5000-8000-000000000007", client_id: CLIENT_A, item_kind: "queue_item",
            item_id: "9ee00000-0000-4000-8000-000000000007", document_id: "d0c0e1d0-0000-4000-8000-000000000007",
            function: "support", action_class: "investigate_failure", reason_class: "stage_failed",
            opened_at: "2026-10-07T08:30:00+00:00", age_seconds: 1800,
          },
        ],
      },
      spend: {
        status: "ok",
        error: null,
        accounting_day: "2026-10-07",
        resets_at: "2026-10-08T00:00:00+00:00",
        currency: "USD",
        rows: [
          spend("documents_daily", CLIENT_A, {
            uncertain_usd: 0.002, exposure_usd: 3.702, uncertain_calls: 2, reconciliation_required: true,
            available: false, reason: "reconciliation_required",
          }),
          spend("writing_daily", CLIENT_A, { limit_usd: 10, known_usd: 4, reserved_usd: 0, exposure_usd: 4, remaining_usd: 6 }),
          spend("writing_monthly", CLIENT_A, { limit_usd: null, remaining_usd: null, available: false, reason: "policy_missing" }),
          spend("documents_daily", CLIENT_B),
          spend("writing_daily", CLIENT_B, { known_usd: 10, exposure_usd: 10, limit_usd: 10, remaining_usd: 0, available: false, reason: "budget_exhausted" }),
          spend("writing_monthly", CLIENT_B, { limit_usd: 50 }),
        ],
        deployment: spend("deployment_daily", null, { limit_usd: 200, known_usd: 40, reserved_usd: 1, exposure_usd: 41, remaining_usd: 159 }),
      },
    },
  };
}

/** A39: the deployment's daily limit refuses work. Every client row names it, even where
 *  the meter's own `available` is still true. */
export function deploymentBinding(): OpsHealth {
  const health = opsHealth();
  const spendSection = health.sections.spend;
  spendSection.deployment = { ...spendSection.deployment!, remaining_usd: 0, exposure_usd: 200, available: false, reason: "deployment_limit" };
  spendSection.rows = spendSection.rows!.map((row) => ({ ...row, reconciliation_required: false, limit_usd: row.limit_usd ?? 10, reason: "deployment_limit" }));
  return health;
}

/** One section unavailable, as the backend sends it: null data, a short error class. */
export function withUnavailable(name: keyof OpsHealth["sections"], error = "RaiseException"): OpsHealth {
  const health = opsHealth();
  const nulls: Record<string, Record<string, unknown>> = {
    workers: { rows: null },
    documents_24h: { window: null, counts: null, rows: null },
    waiting: { min_age_minutes: 60, rows: null },
    needs_person: { rows: null },
    spend: { accounting_day: null, resets_at: null, currency: null, rows: null, deployment: null },
  };
  (health.sections as Record<string, unknown>)[name] = { status: "unavailable", ...nulls[name], error };
  return health;
}
