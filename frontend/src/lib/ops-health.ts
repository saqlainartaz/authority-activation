// The operator System health read's response shape (Cycle 5 P3.3): the backend's
// `GET /v2/ops/health` (`src/content_engine/ke/api/ops.py`; docs/API_CONTRACT.md,
// "GET /v2/ops/health"). Types only: `lib/engine.ts` returns it and the System health
// page (`app/internal/system-health-display.ts`) displays it.

export type SectionStatus = "ok" | "unavailable";
export type SectionBase = { status: SectionStatus; error: string | null };

export type WorkerLiveness =
  | "running"
  | "idle"
  | "not_responding"
  | "replaced"
  | "telemetry_unavailable"
  | "no_live_worker";

export type WorkerRow = {
  /** Null for a lane row: a lane no live worker serves (Ruling 47). */
  worker_id: string | null;
  lanes: string[];
  last_seen: string | null;
  liveness: WorkerLiveness | string;
  current_job_id: string | null;
  current_job_kind: string | null;
  current_client_id: string | null;
  current_item_kind: string | null;
  current_item_id: string | null;
  task_progress_at: string | null;
  task_progress_known: boolean | null;
};

export type DocumentCounts = { finished: number; still_processing: number; failed: number; deleted: number };

export type WaitingReason =
  | "budget_day_limit"
  | "deployment_limit"
  | "person"
  | "retry_scheduled"
  | "no_progress"
  | "progress_unknown"
  /** Its current extraction work is an SE-1 repair after a roster change (P3.5, migration 0098). */
  | "repair_reextraction";

export type WaitingRow = {
  issue_id: string;
  client_id: string;
  item_kind: string;
  item_id: string;
  document_id: string | null;
  stage: string;
  /** The progress clock; null when no progress was ever recorded (`progress_unknown`). */
  waiting_since: string | null;
  reason_class: WaitingReason | string;
  progress_known: boolean;
  next_eligible_at: string | null;
  awaiting_supervisor: boolean;
};

export type NeedsPersonRow = {
  issue_id: string;
  client_id: string;
  item_kind: string;
  item_id: string;
  document_id: string | null;
  function: "client" | "operator" | "support" | string;
  action_class: string;
  reason_class: string;
  opened_at: string | null;
  age_seconds: number | null;
};

export type SpendReason =
  | "writing_not_configured"
  | "policy_missing"
  | "reconciliation_required"
  | "deployment_limit"
  | "budget_exhausted";

export type SpendRow = {
  scope: "client" | "deployment";
  client_id?: string | null;
  meter: "documents_daily" | "writing_daily" | "writing_monthly" | "deployment_daily" | string;
  period: "day" | "month" | string;
  period_start: string;
  resets_at: string | null;
  currency: string | null;
  limit_usd: number | null;
  known_usd: number | null;
  reserved_usd: number | null;
  uncertain_usd: number | null;
  exposure_usd: number | null;
  remaining_usd: number | null;
  uncertain_calls: number | null;
  reconciliation_required: boolean;
  held_for_day_limit: boolean;
  /** The meter's own verdict. Never the page's answer to "can this client run paid work now". */
  available: boolean;
  reason: SpendReason | string | null;
};

export type OpsHealth = {
  observed_at: string;
  sections: {
    workers: SectionBase & { rows: WorkerRow[] | null };
    documents_24h: SectionBase & {
      window: { start: string; end: string } | null;
      counts: DocumentCounts | null;
      rows: Array<DocumentCounts & { client_id: string }> | null;
    };
    waiting: SectionBase & { min_age_minutes: number; rows: WaitingRow[] | null };
    needs_person: SectionBase & { rows: NeedsPersonRow[] | null };
    spend: SectionBase & {
      accounting_day: string | null;
      resets_at: string | null;
      currency: string | null;
      rows: SpendRow[] | null;
      deployment: SpendRow | null;
    };
  };
};
