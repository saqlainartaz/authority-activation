import { describe, expect, it } from "vitest";

import {
  accountingLabel,
  clientLabel,
  formatAt,
  formatMoney,
  healthReducer,
  INITIAL_HEALTH,
  issueKey,
  linkedIssues,
  needsPersonLine,
  observedLabel,
  replacedSummary,
  sectionUnavailable,
  spendGroups,
  spendLine,
  spendStatus,
  staleLabel,
  uncertainLine,
  waitingLine,
  waitReason,
  windowLabel,
  workersView,
} from "@/app/internal/system-health-display";
import { utcStamp } from "@/lib/utc-reset";
import {
  CLIENT_A, CLIENT_B, CLIENT_X, CLIENTS, DOC_HELD, OBSERVED_AT, deploymentBinding, opsHealth, withUnavailable,
} from "./ops-health-fixture";

// Cycle 5 P3.3: the System health page's pure display rules (spec §10.1, A31-A33, A39).

describe("unavailable sections", () => {
  it("reads 'Unavailable — <class>' for every section the backend could not read, never 0 or an empty list", () => {
    for (const name of ["workers", "documents_24h", "waiting", "needs_person", "spend"] as const) {
      const section = withUnavailable(name, "InsufficientPrivilege").sections[name];
      const text = sectionUnavailable(section, name === "documents_24h" ? "counts" : "rows");
      expect(text, name).toBe("Unavailable — InsufficientPrivilege");
      expect(text).not.toMatch(/\b0\b/);
    }
  });

  it("is null for an ok section, and unavailable for an ok section whose data is missing", () => {
    expect(sectionUnavailable(opsHealth().sections.waiting)).toBeNull();
    expect(sectionUnavailable({ status: "ok", error: null, rows: null })).toBe("Unavailable — missing_data");
    expect(sectionUnavailable(undefined)).toBe("Unavailable — missing_section");
    expect(sectionUnavailable({ status: "unavailable", error: null, rows: null })).toBe("Unavailable — unknown");
  });
});

describe("workers", () => {
  it("collapses replaced workers and never counts them as alarms", () => {
    const view = workersView(opsHealth().sections.workers.rows!, CLIENTS);
    expect(view.rows.map((row) => row.status.label)).toEqual(["Running", "Idle"]);
    expect(view.replaced).toHaveLength(2);
    expect(view.replaced.every((row) => row.status.tone === "neutral")).toBe(true);
    expect(view.replaced.every((row) => row.status.label !== "Not responding")).toBe(true);
    expect(view.alarms).toBe(0);
    expect(replacedSummary(view.replaced.length)).toBe("Replaced by a newer worker (2)");
  });

  it("counts not responding workers, lanes with no live worker and missing telemetry as alarms", () => {
    const rows = opsHealth().sections.workers.rows!;
    const view = workersView([
      ...rows,
      { ...rows[1], worker_id: "e0e0e0e0-0000-4000-8000-00000000000e", liveness: "not_responding" },
      { ...rows[1], worker_id: null, lanes: ["publish"], last_seen: null, liveness: "no_live_worker" },
      { ...rows[1], worker_id: null, lanes: ["generate"], last_seen: null, liveness: "telemetry_unavailable" },
      { ...rows[1], worker_id: "f0f0f0f0-0000-4000-8000-00000000000f", liveness: "something_new" },
    ], CLIENTS);
    expect(view.alarms).toBe(4);
    const lane = view.rows.find((row) => row.title === "Lane publish")!;
    expect(lane).toMatchObject({ laneWarning: true, status: { label: "No live worker", tone: "warn" }, heartbeat: "No heartbeat recorded" });
    expect(view.rows.find((row) => row.title === "Lane generate")!.status).toEqual({ label: "Telemetry unavailable", tone: "warn" });
    // An unknown class is a warning, never green.
    expect(view.rows.at(-1)!.status.tone).toBe("warn");
  });

  it("shows lanes, last heartbeat and current work with the client's name", () => {
    const [running, idle] = workersView(opsHealth().sections.workers.rows!, CLIENTS).rows;
    expect(running.lanes).toBe("ingest, knowledge");
    expect(running.heartbeat).toBe("7 Oct 2026, 08:59 UTC");
    expect(running.work).toBe("Extract · Juniper Studio · Document evidence d0c0e1d0 · last progress 7 Oct 2026, 08:58 UTC");
    expect(idle.work).toBe("No current work");
  });
});

describe("documents (24 h)", () => {
  it("labels the rolling window in UTC", () => {
    expect(windowLabel(opsHealth().sections.documents_24h.window))
      .toBe("Added between 6 Oct 2026, 09:00 UTC and 7 Oct 2026, 09:00 UTC (rolling 24 hours)");
    expect(windowLabel(null)).toBe("Window not available");
  });
});

describe("waiting over one hour", () => {
  it("names each reason class in plain words, and tells human waits, limit pauses and retries apart", () => {
    expect(waitReason("progress_unknown").label).toBe("Progress unknown");
    expect(waitReason("person")).toMatchObject({ label: "Waiting for a person", kind: "person" });
    expect(waitReason("budget_day_limit")).toMatchObject({ label: "Paused for the client's daily spending limit", kind: "limit" });
    expect(waitReason("deployment_limit")).toMatchObject({ label: "Paused for the deployment's daily limit", kind: "limit" });
    expect(waitReason("retry_scheduled")).toMatchObject({ label: "Retry scheduled", kind: "retry" });
    expect(waitReason("no_progress")).toMatchObject({ label: "No recorded progress", kind: "stalled" });
    const kinds = ["person", "budget_day_limit", "retry_scheduled"].map((reason) => waitReason(reason).kind);
    expect(new Set(kinds).size).toBe(3);
  });

  it("tells a repair after a roster change from a stall (P3.5, Ruling 57)", () => {
    const repair = waitReason("repair_reextraction");
    expect(repair).toMatchObject({ label: "Updating after a roster change", kind: "repair", tone: "neutral" });
    expect(repair.label).not.toBe(waitReason("no_progress").label);
    expect(repair.kind).not.toBe(waitReason("no_progress").kind);
    expect(repair.tone).not.toBe(waitReason("no_progress").tone);
  });

  it("shows progress_unknown as 'Progress unknown', never as a time or 0", () => {
    const row = opsHealth().sections.waiting.rows!.find((candidate) => candidate.reason_class === "progress_unknown")!;
    const line = waitingLine(row, OBSERVED_AT, CLIENTS);
    expect(line.lastProgress).toBe("Progress unknown");
    expect(line.reason.label).toBe("Progress unknown");
    expect(line.waitedSince).toBe("Not recorded (over one hour)");
    expect(line.client).toBe(`Client ${CLIENT_X.slice(0, 8)}`);
  });

  it("shows client, item, stage, waited since with the elapsed time, and when the engine continues", () => {
    const rows = opsHealth().sections.waiting.rows!;
    const held = waitingLine(rows[0], OBSERVED_AT, CLIENTS);
    expect(held).toMatchObject({
      client: "Juniper Studio", item: "Document evidence d0c0e1d0", stage: "Evidence extraction",
      waitedSince: "7 Oct 2026, 06:30 UTC (2 h 30 min)", lastProgress: "7 Oct 2026, 06:30 UTC", continues: null,
    });
    expect(waitingLine(rows[1], OBSERVED_AT, CLIENTS).continues).toBe("Continues 00:00 UTC on 8 October");
    expect(waitingLine(rows[2], OBSERVED_AT, CLIENTS).continues).toBe("Continues 09:20 UTC");
    expect(waitingLine({ ...rows[1], awaiting_supervisor: true }, OBSERVED_AT, CLIENTS).continues).toBe("Continues 00:00 UTC on 8 October (provisional)");
  });
});

describe("needs a person", () => {
  it("shows the function, action, reason, age and a link to Sources or Limits, never a named person", () => {
    const [held, split, support] = opsHealth().sections.needs_person.rows!.map((row) => needsPersonLine(row, CLIENTS));
    expect(held).toMatchObject({
      who: "Operator", action: "Authorize the spend", reason: "Document budget paused", age: "2 h 30 min",
      client: "Juniper Studio", item: "Document evidence d0c0e1d0", detail: { section: "limits", label: "Open Limits" },
    });
    expect(split).toMatchObject({ who: "Client", action: "Split the file", detail: { section: "sources" } });
    expect(support.who).toBe("Technical support");
    expect(needsPersonLine({ ...opsHealth().sections.needs_person.rows![2], age_seconds: null }, CLIENTS).age).toBe("Not recorded");
  });

  it("points a repair that paused for good at the script that re-runs it (P3.5, Ruling 56)", () => {
    const row = { ...opsHealth().sections.needs_person.rows![2], function: "operator", action_class: "rerun_repair",
      reason_class: "capacity_exhausted" };
    expect(needsPersonLine(row, CLIENTS)).toMatchObject({
      who: "Operator", action: "Re-run the roster repair (ke_repair_stale_releases.py)", reason: "Capacity exhausted",
      detail: { section: "sources" },
    });
  });
});

describe("one issue, one identity (Ruling 50)", () => {
  it("links a waiting document and its needs-person row by document_id, with one marker for both", () => {
    const health = opsHealth();
    const waiting = health.sections.waiting.rows!;
    const needs = health.sections.needs_person.rows!;
    const markers = linkedIssues(waiting, needs);
    expect([...markers.keys()]).toEqual([`document:${DOC_HELD}`]);
    expect(markers.get(issueKey(waiting[0]))).toBe(markers.get(issueKey(needs[0])));
    expect(markers.get(issueKey(needs[1]))).toBeUndefined();
  });

  it("links by document_id even when the issue ids differ (a waiting document and its review item)", () => {
    const health = opsHealth();
    const waiting = [{ ...health.sections.waiting.rows![0], item_kind: "document", issue_id: "155e00aa-0000-5000-8000-0000000000aa" }];
    const needs = [{ ...health.sections.needs_person.rows![0], item_kind: "queue_item", issue_id: "155e00bb-0000-5000-8000-0000000000bb" }];
    expect(linkedIssues(waiting, needs).size).toBe(1);
  });
});

describe("today's AI spend", () => {
  it("shows null money as 'Not available', never 0, and a sub-cent amount as under US$0.01", () => {
    expect(formatMoney(null, "USD")).toBe("Not available");
    expect(formatMoney(undefined, "USD")).toBe("Not available");
    expect(formatMoney(0, "USD")).toBe("US$0.00");
    expect(formatMoney(0.002, "USD")).toBe("under US$0.01");
    expect(formatMoney(12.4, "USD")).toBe("US$12.40");
    const policyMissing = spendLine(opsHealth().sections.spend.rows!.find((row) => row.reason === "policy_missing")!);
    expect(policyMissing.limit).toBe("Not available");
    expect(policyMissing.remaining).toBe("Not available");
  });

  it("labels uncertain spend separately, with 'at least' while reconciliation is required", () => {
    const documents = opsHealth().sections.spend.rows![0];
    expect(uncertainLine(documents)).toBe("Unknown costs: at least under US$0.01 (2 calls, reconciliation required)");
    expect(uncertainLine({ ...documents, uncertain_usd: 1.5, reconciliation_required: true })).toBe("Unknown costs: at least US$1.50 (2 calls, reconciliation required)");
    expect(uncertainLine({ ...documents, uncertain_usd: 1.5, reconciliation_required: false })).toBe("Unknown costs: US$1.50 (2 calls)");
    expect(uncertainLine({ ...documents, uncertain_usd: 0, uncertain_calls: 0, reconciliation_required: false })).toBeNull();
    expect(spendLine(documents).known).toBe("US$3.20");
  });

  it("says why from reason, not available: available true with deployment_limit is refused (Ruling 50, A39)", () => {
    const status = spendStatus({ available: true, reason: "deployment_limit" });
    expect(status.label).toBe("Paused: the deployment's daily limit is reached (not this client's budget)");
    expect(status.tone).toBe("bad");
    expect(status.label).not.toBe("Can run paid work");
    for (const row of deploymentBinding().sections.spend.rows!) {
      expect(spendStatus(row).label).toContain("deployment's daily limit");
      expect(spendStatus(row).label).not.toContain("budget is used up");
    }
    // The deployment's own row is named as the deployment-wide safeguard.
    expect(spendStatus(deploymentBinding().sections.spend.deployment!).label).toBe("Daily limit reached: paid work is paused for every client");
    expect(spendStatus({ available: true, reason: null })).toEqual({ label: "Can run paid work", tone: "ok" });
    expect(spendStatus({ available: false, reason: "budget_exhausted" }).label).toBe("This client's budget is used up");
  });

  it("groups rows per client with names from the client list, and a short id for a missing client", () => {
    const rows = [...opsHealth().sections.spend.rows!, { ...opsHealth().sections.spend.rows![0], client_id: CLIENT_X }];
    const groups = spendGroups(rows, CLIENTS);
    expect(groups.map((group) => group.client)).toEqual(["Cedar Works", `Client ${CLIENT_X.slice(0, 8)}`, "Juniper Studio"]);
    expect(groups.find((group) => group.clientId === CLIENT_A)!.lines.map((line) => line.meter))
      .toEqual(["Documents (today)", "Writing (today)", "Writing (this month)"]);
    expect(groups.find((group) => group.clientId === CLIENT_X)!.known).toBe(false);
    expect(clientLabel(CLIENTS, CLIENT_B)).toEqual({ name: "Cedar Works", known: true });
  });

  it("shows the currency, the UTC accounting day and the reset", () => {
    expect(accountingLabel(opsHealth().sections.spend))
      .toBe("UTC accounting day 7 Oct 2026 · resets 8 Oct 2026, 00:00 UTC · currency USD");
    expect(spendLine(opsHealth().sections.spend.rows![2]).resets).toBe("Resets 1 Nov 2026, 00:00 UTC");
  });
});

describe("times use the shared UTC formatter (P2.7)", () => {
  it("formats every instant exactly as utc-reset's utcStamp does", () => {
    for (const at of [OBSERVED_AT, "2026-12-31T23:59:00Z", "2026-10-07T09:00:00+02:00"]) {
      expect(formatAt(at)).toBe(utcStamp(at));
    }
    expect(observedLabel(OBSERVED_AT)).toBe(`Observed ${utcStamp(OBSERVED_AT)}`);
    expect(staleLabel(OBSERVED_AT)).toBe(`Couldn't refresh · showing data from ${utcStamp(OBSERVED_AT)}`);
    expect(formatAt(null)).toBe("Not recorded");
  });
});

describe("a failed refresh", () => {
  it("keeps the last good data and marks it stale, never blanking it", () => {
    const loaded = healthReducer(INITIAL_HEALTH, { type: "loaded", data: opsHealth() });
    const failed = healthReducer(loaded, { type: "failed", message: "Something broke on our side." });
    expect(failed.data).toBe(loaded.data);
    expect(failed.stale).toBe(true);
    expect(failed.error).toBe("Something broke on our side.");
    const recovered = healthReducer(failed, { type: "loaded", data: opsHealth() });
    expect(recovered.stale).toBe(false);
    expect(recovered.error).toBeNull();
  });

  it("is an error, not stale data, when nothing was ever read", () => {
    const failed = healthReducer(INITIAL_HEALTH, { type: "failed", message: "down" });
    expect(failed).toEqual({ data: null, stale: false, error: "down" });
  });
});
