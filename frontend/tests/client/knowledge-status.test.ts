import { afterEach, describe, expect, it, vi } from "vitest";

import {
  KNOWLEDGE_LABELS as L, NO_RETRY_SCHEDULED, NOT_IN_USE_DETAIL, READING_THE_FILE, REPLACED_DETAIL,
  UNREADABLE_DETAIL, UPDATING_KNOWLEDGE, WAITING_FOR_OUR_TEAM, knowledgeStatus, legacyStatus,
  type KnowledgeRelease, type KnowledgeStatus, type KnowledgeStatusDocument,
} from "@/lib/knowledge-status";
import { utcDay, utcReset, utcStamp, utcTime, utcWhen } from "@/lib/utc-reset";

/**
 * Cycle 5 P2.7 (spec §7.2-7.4, A27): one knowledge-engine source's status in
 * the client's words, from its state, its C2 evidence release, its pause reason
 * and time (P2.4/P2.4b) and its open review items. Pure: no fetch.
 */

const NOW = new Date("2026-10-06T14:00:00Z");
const TOMORROW = "2026-10-07T00:01:00+00:00";
const LATER_TODAY = "2026-10-06T14:05:00Z";

const ACTIVE: KnowledgeRelease = { state: "active", yield: "evidence" };
const EMPTY: KnowledgeRelease = { state: "active", yield: "empty" };
const STALE: KnowledgeRelease = { state: "stale", yield: "evidence" };

type Row = [name: string, document: KnowledgeStatusDocument, release: KnowledgeRelease, queue: string[], expected: KnowledgeStatus];

const doc = (state: string, extra: Partial<KnowledgeStatusDocument> = {}): KnowledgeStatusDocument => ({ state, ...extra });
const paused = (state: string, reason: string, at: string | null) => doc(state, { paused_reason: reason, next_eligible_at: at });

const ROWS: Row[] = [
  // Usable, or successfully empty.
  ["ready, evidence released", doc("ready"), ACTIVE, [], { label: L.available, tone: "ready" }],
  ["ready, release with no yield field", doc("ready"), { state: "active" }, [], { label: L.available, tone: "ready" }],
  ["ready, empty release", doc("ready"), EMPTY, [], { label: L.empty, tone: "ready" }],
  // Ruling 38: released evidence stays Available; a later C3 wait read from the detail adds a line.
  ["ready + released, C3 waits on the daily limit", paused("ready", "daily_spending_limit", TOMORROW), ACTIVE, [],
    { label: L.available, tone: "ready", detail: "Updating paused · continues after 00:01 UTC on 7 October (daily limit)", usage_limited: true }],
  ["ready + released, C3 daily wait with no time", paused("ready", "daily_spending_limit", null), ACTIVE, [],
    { label: L.available, tone: "ready", detail: "Updating paused (daily limit) · waiting for our team", usage_limited: true }],
  ["ready + released, C3 waits on the deployment", paused("ready", "deployment_limit", TOMORROW), ACTIVE, [],
    { label: L.available, tone: "ready", detail: "Updating delayed · continues after 00:01 UTC on 7 October" }],
  ["ready + released, reconciliation with a stray time", paused("ready", "reconciliation_required", TOMORROW), ACTIVE, [],
    { label: L.available, tone: "ready", detail: "Updating delayed · waiting for our team" }],
  ["ready + released, C3 provider retry", paused("ready", "provider_capacity", LATER_TODAY), ACTIVE, [],
    { label: L.available, tone: "ready", detail: "Updating delayed · next try after 14:05 UTC" }],
  ["ready + released, other with no time", paused("ready", "other", null), ACTIVE, [],
    { label: L.available, tone: "ready", detail: "Updating delayed · waiting for our team" }],
  // In progress, with its stage.
  ...["received", "sniffed", "text_pulled", "triaged", "parse_queued", "parsing", "parsed", "cleaning", "cleaned", "comprehending"]
    .map((state): Row => [`pipeline ${state}`, doc(state), null, [], { label: L.processing, tone: "working", detail: READING_THE_FILE }]),
  ["ready, nothing released yet", doc("ready"), null, [], { label: L.processing, tone: "working", detail: UPDATING_KNOWLEDGE }],
  ["ready, release stale", doc("ready"), STALE, [], { label: L.processing, tone: "working", detail: UPDATING_KNOWLEDGE }],
  // The client's daily limit: its time when known, a person when not.
  ["daily limit, time tomorrow", paused("parsed", "daily_spending_limit", TOMORROW), null, [],
    { label: L.paused, tone: "waiting", detail: "Continues after 00:01 UTC on 7 October", resumes_at: "2026-10-07T00:01:00.000Z", usage_limited: true }],
  ["daily limit, time today", paused("cleaned", "daily_spending_limit", LATER_TODAY), null, [],
    { label: L.paused, tone: "waiting", detail: "Continues after 14:05 UTC", resumes_at: "2026-10-06T14:05:00.000Z", usage_limited: true }],
  ["daily limit on a failed stage, pending supervisor", paused("failed_clean", "daily_spending_limit", "2026-10-07T00:00:00Z"), null, [],
    { label: L.paused, tone: "waiting", detail: "Continues after 00:00 UTC on 7 October", resumes_at: "2026-10-07T00:00:00.000Z", usage_limited: true }],
  ["daily limit, waits used up (null time)", paused("failed_clean", "daily_spending_limit", null), null, [],
    { label: L.paused, tone: "waiting", detail: WAITING_FOR_OUR_TEAM, usage_limited: true }],
  ["daily limit on ready, C2 held (null time)", paused("ready", "daily_spending_limit", null), null, [],
    { label: L.paused, tone: "waiting", detail: WAITING_FOR_OUR_TEAM, usage_limited: true }],
  ["daily limit, unreadable time", paused("parsed", "daily_spending_limit", "not a time"), null, [],
    { label: L.paused, tone: "waiting", detail: WAITING_FOR_OUR_TEAM, usage_limited: true }],
  // The deployment's limit: neutral, never the client's budget.
  ["deployment limit, time", paused("parsed", "deployment_limit", TOMORROW), null, [],
    { label: L.delayed, tone: "waiting", detail: "Continues after 00:01 UTC on 7 October", resumes_at: "2026-10-07T00:01:00.000Z" }],
  ["deployment limit, null time", paused("parsed", "deployment_limit", null), null, [],
    { label: L.delayed, tone: "waiting", detail: WAITING_FOR_OUR_TEAM }],
  // A person must act: no time, even when one is recorded.
  ["reconciliation", paused("budget_paused", "reconciliation_required", null), null, [],
    { label: L.delayed, tone: "waiting", detail: WAITING_FOR_OUR_TEAM }],
  ["reconciliation with a stray time", paused("parsed", "reconciliation_required", TOMORROW), null, [],
    { label: L.delayed, tone: "waiting", detail: WAITING_FOR_OUR_TEAM }],
  ["policy missing", paused("parsed", "policy_missing", TOMORROW), null, [],
    { label: L.delayed, tone: "waiting", detail: WAITING_FOR_OUR_TEAM }],
  ["own ceiling (budget_paused, other)", paused("budget_paused", "other", null), null, [],
    { label: L.delayed, tone: "waiting", detail: WAITING_FOR_OUR_TEAM }],
  // A technical delay names a retry only when one is scheduled.
  ["provider capacity, retry scheduled", paused("ready", "provider_capacity", LATER_TODAY), null, [],
    { label: L.delayed, tone: "waiting", detail: "Next try after 14:05 UTC", resumes_at: "2026-10-06T14:05:00.000Z" }],
  ["other, transient retry scheduled", paused("failed_parse", "other", LATER_TODAY), null, [],
    { label: L.delayed, tone: "waiting", detail: "Next try after 14:05 UTC", resumes_at: "2026-10-06T14:05:00.000Z" }],
  ["a pause reason this screen does not know", paused("parsed", "brand_new_reason", LATER_TODAY), null, [],
    { label: L.delayed, tone: "waiting", detail: "Next try after 14:05 UTC", resumes_at: "2026-10-06T14:05:00.000Z" }],
  // Holds and failures with nothing scheduled.
  ["budget_paused without a reason read", doc("budget_paused"), null, [], { label: L.delayed, tone: "waiting", detail: WAITING_FOR_OUR_TEAM }],
  ["parked for an operator's triage", doc("parked_low_confidence"), null, [], { label: L.delayed, tone: "waiting", detail: WAITING_FOR_OUR_TEAM }],
  ["failed beyond repair", doc("failed_beyond_repair"), null, [], { label: L.delayed, tone: "waiting", detail: WAITING_FOR_OUR_TEAM }],
  ...["failed_intake", "failed_parse", "failed_clean", "failed_comprehend"].map((state): Row =>
    [state, doc(state), null, [], { label: L.delayed, tone: "waiting", detail: NO_RETRY_SCHEDULED, recheck: true }]),
  // Input issues the client can fix.
  ["over the 13-page limit", doc("parsed", { lane: "document" }), null, ["source_size_rejected"], {
    label: L.needsHelp, tone: "action", detail: "Too long — split it into smaller files",
    reason: "This file is longer than the 13-page limit. Split it into parts of 13 pages or fewer and add each one through Add files.",
  }],
  ["a recording over 40 minutes", doc("parsed", { lane: "transcript" }), null, ["suspected_duplicate", "source_size_rejected"], {
    label: L.needsHelp, tone: "action", detail: "Too long — split it into smaller files",
    reason: "This recording is longer than the 40-minute limit. Split it into parts of 40 minutes or fewer and add each one through Add files.",
  }],
  ["quarantined, with the backend's own remedy", doc("quarantined", { quarantine: { message: "The file is empty." } }), null, [],
    { label: L.needsHelp, tone: "action", detail: "The file is empty." }],
  ["quarantined, no message read", doc("quarantined"), null, [], { label: L.needsHelp, tone: "action", detail: UNREADABLE_DETAIL }],
  ["an operator review item alone changes nothing", doc("ready"), ACTIVE, ["suspected_duplicate"], { label: L.available, tone: "ready" }],
  // Not in use: kept, never deleted.
  ["withdrawn", doc("withdrawn"), null, [], { label: L.notInUse, tone: "off", detail: NOT_IN_USE_DETAIL }],
  ["withdrawn with a withdrawn release", doc("withdrawn"), { state: "withdrawn" }, [], { label: L.notInUse, tone: "off", detail: NOT_IN_USE_DETAIL }],
  ["superseded", doc("superseded"), null, [], { label: L.notInUse, tone: "off", detail: REPLACED_DETAIL }],
  // Unknown or legacy: the fallback, never failure copy.
  ["an unknown state", doc("teleported"), null, [], { label: L.delayed, tone: "waiting" }],
  ["an empty state", doc(""), null, [], { label: L.delayed, tone: "waiting" }],
];

describe("knowledgeStatus", () => {
  it.each(ROWS)("%s", (_name, document, release, queue, expected) => {
    expect(knowledgeStatus(document, release, queue.map(kind => ({ kind })), NOW)).toEqual(expected);
  });

  it("never claims a time when next_eligible_at is null, whatever the reason", () => {
    for (const reason of ["daily_spending_limit", "deployment_limit", "reconciliation_required", "policy_missing", "provider_capacity", "other"]) {
      const status = knowledgeStatus(paused("parsed", reason, null), null, [], NOW);
      expect(status.detail).toBe(WAITING_FOR_OUR_TEAM);
      expect(status.resumes_at).toBeUndefined();
      expect(JSON.stringify(status)).not.toMatch(/UTC|Continues|Next try|\d\d:\d\d/);
    }
  });

  it("never claims a time for a released source's update wait when next_eligible_at is null (Ruling 38)", () => {
    for (const reason of ["daily_spending_limit", "deployment_limit", "reconciliation_required", "policy_missing", "provider_capacity", "other"]) {
      const status = knowledgeStatus(paused("ready", reason, null), ACTIVE, [], NOW);
      expect(status.label).toBe(L.available);
      expect(status.detail).toMatch(/waiting for our team$/);
      expect(JSON.stringify(status)).not.toMatch(/UTC|continues|next try|\d\d:\d\d/);
    }
    // The deployment's wait on a released source is neutral too.
    expect(knowledgeStatus(paused("ready", "deployment_limit", TOMORROW), ACTIVE, [], NOW).detail).not.toMatch(/limit|budget|spending/);
  });

  it("never tells the client the deployment's limit is their own budget", () => {
    for (const at of [TOMORROW, null]) {
      const status = knowledgeStatus(paused("parsed", "deployment_limit", at), null, [], NOW);
      expect(status.label).not.toBe(L.paused);
      expect(JSON.stringify(status)).not.toMatch(/budget|spending|your limit|limit/i);
    }
  });

  it("never shows a deleted or failed label for any state", () => {
    const states = ["withdrawn", "superseded", "failed_intake", "failed_parse", "failed_clean", "failed_comprehend",
      "failed_beyond_repair", "quarantined", "budget_paused", "parked_low_confidence", "mystery"];
    for (const state of states) {
      const status = knowledgeStatus(doc(state), null, [], NOW);
      expect(JSON.stringify(status)).not.toMatch(/delet|fail/i);
    }
    expect(knowledgeStatus(doc("withdrawn"), null, [], NOW).label).toBe("Not in use");
  });

  it("does not crash on a malformed document", () => {
    expect(knowledgeStatus({ state: undefined as unknown as string }, null, [], NOW)).toEqual({ label: L.delayed, tone: "waiting" });
  });

  it("keeps the older three-way status for readers of `status`", () => {
    expect(legacyStatus({ label: L.available, tone: "ready" })).toBe("atomised");
    expect(legacyStatus({ label: L.empty, tone: "ready" })).toBe("atomised");
    expect(legacyStatus({ label: L.processing, tone: "working" })).toBe("uploaded");
    expect(legacyStatus({ label: L.paused, tone: "waiting" })).toBe("uploaded");
    expect(legacyStatus({ label: L.needsHelp, tone: "action" })).toBe("failed");
    expect(legacyStatus({ label: L.notInUse, tone: "off" })).toBe("failed");
  });
});

describe("the one UTC formatter", () => {
  afterEach(() => { vi.unstubAllEnvs(); });

  it("prints the same UTC instant whatever the local clock's zone", () => {
    const outputs = ["Asia/Kolkata", "America/Los_Angeles", "Pacific/Kiritimati", "UTC"].map(zone => {
      vi.stubEnv("TZ", zone);
      return [
        utcTime("2026-10-31T21:30:00-04:00"), utcDay("2026-10-31T21:30:00-04:00"),
        utcStamp("2026-10-31T21:30:00-04:00"), utcReset("2026-11-01T00:00:00Z", "month"),
        utcWhen(TOMORROW, NOW), knowledgeStatus(paused("parsed", "daily_spending_limit", TOMORROW), null, [], NOW).detail,
      ];
    });
    vi.stubEnv("TZ", "Asia/Kolkata");
    // The stub really moved the local clock, so the equality below means something.
    expect(new Date("2026-10-06T00:00:00Z").getHours()).toBe(5);
    for (const output of outputs) {
      expect(output).toEqual([
        "01:30 UTC", "1 November", "1 Nov 2026, 01:30 UTC", "1 November, 00:00 UTC",
        "00:01 UTC on 7 October", "Continues after 00:01 UTC on 7 October",
      ]);
    }
  });

  it("names the date only when it is not today, in UTC", () => {
    expect(utcWhen("2026-10-06T23:59:00Z", NOW)).toBe("23:59 UTC");
    expect(utcWhen("2026-10-07T00:00:00Z", NOW)).toBe("00:00 UTC on 7 October");
    expect(utcWhen("2027-01-01T09:00:00Z", NOW)).toBe("09:00 UTC on 1 January");
  });

  it("reads nothing it cannot parse", () => {
    for (const value of [null, undefined, "", "soon"]) {
      expect(utcTime(value)).toBeNull();
      expect(utcDay(value)).toBeNull();
      expect(utcStamp(value)).toBeNull();
      expect(utcReset(value, "day")).toBeNull();
      expect(utcWhen(value, NOW)).toBeNull();
    }
  });

  it("keeps each existing call site's output, with the client's month spelled out", () => {
    expect(utcReset("2026-10-07T00:00:00Z", "day")).toBe("00:00 UTC");
    expect(utcDay("2026-11-01T00:00:00Z", { short: true })).toBe("1 Nov");
  });
});
