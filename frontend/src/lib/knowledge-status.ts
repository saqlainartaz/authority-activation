// A knowledge-engine source's status in the client's words (Cycle 5 P2.7; spec
// §7.2-7.4, A26-A27). Client-safe and pure: no credential, no React, no fetch.
// The BFF (`lib/engine.ts`) calls `knowledgeStatus` once per document and sends
// the result with it; the Knowledge screen only prints it. Under M1 nothing here
// runs (A47): M1 documents keep their own three statuses.
//
// Inputs, all read from the backend as they are:
// - the document: its lifecycle `state`, and from its detail `paused_reason` and
//   `next_eligible_at` (P2.4/P2.4b), `lane` and `quarantine`;
// - the C2 evidence release: `{state, yield}`, or null when none is released;
// - the document's open review items (`open_queue_items`, kinds only).
//
// Decisions the spec leaves open are recorded in the P2.7 report, each with its
// spec quote. The two rules that matter most:
// - a null `next_eligible_at` never claims a time: the work waits for a person;
// - the deployment's daily limit is never presented as the client's budget.

import { utcWhen } from "./utc-reset";

/** The §7.2 vocabulary, verbatim. */
export const KNOWLEDGE_LABELS = {
  processing: "Processing",
  available: "Available",
  availableQuestion: "Available · question",
  empty: "Processed · no usable information",
  needsHelp: "Needs your help",
  delayed: "Processing delayed",
  paused: "Paused · daily spending limit",
  notInUse: "Not in use",
  deleting: "Deleting",
} as const;

export type KnowledgeLabel = (typeof KNOWLEDGE_LABELS)[keyof typeof KNOWLEDGE_LABELS];

/** What kind of state a label is, for styling and for when the screen refreshes:
 *  `ready` (usable, or successfully empty), `working` (in progress), `waiting`
 *  (paused or delayed), `action` (the client can fix it), `off` (not used). */
export type KnowledgeTone = "ready" | "working" | "waiting" | "action" | "off";

export type KnowledgeStatus = {
  label: KnowledgeLabel;
  tone: KnowledgeTone;
  /** One line under the label: the stage, the remedy, or when it continues. */
  detail?: string;
  /** The fuller reason the opened source shows under `detail` (P7.2), when there is one. */
  reason?: string;
  /** The instant `detail` names (ISO 8601, UTC). Present only when a time is claimed. */
  resumes_at?: string;
  /** The engine may move it on by itself with no time recorded (a failed stage its
   *  supervisor retries), so the screen reads it again on its normal cadence. */
  recheck?: true;
  /** Paused by the client's own daily spending limit: Settings -> Usage explains it. */
  usage_limited?: true;
};

export type KnowledgeStatusDocument = {
  state: string;
  paused_reason?: string | null;
  next_eligible_at?: string | null;
  lane?: string | null;
  quarantine?: { message?: string | null } | null;
};

/** The C2 evidence release (`GET .../evidence/status`); null when none exists yet. */
export type KnowledgeRelease = { state: string; yield?: string | null } | null;

export type KnowledgeQueueItem = { kind: string };

/** Work that waits for a person: no time is ever promised for it. */
export const WAITING_FOR_OUR_TEAM = "Waiting for our team before it continues.";
/** A technical failure with nothing scheduled yet: no time, no invented action. */
export const NO_RETRY_SCHEDULED = "No retry is scheduled yet.";
export const READING_THE_FILE = "Reading the file";
export const UPDATING_KNOWLEDGE = "Updating knowledge";
export const NOT_IN_USE_DETAIL = "The file is kept but no longer used.";
export const REPLACED_DETAIL = "A newer upload replaced it. The file is kept.";
export const UNREADABLE_DETAIL =
  "We couldn't read this file. Add a readable copy, such as a PDF or plain text, through Add files.";

/** A file the engine's `source_size` stage refused as over the ~13-page (or
 *  40-minute) limit (D08): the status line, with `splitIt` as its reason. */
export const TOO_LONG_DETAIL = "Too long — split it into smaller files";

/** The backend's own split message for its product limit (`source_size.split_it_message`). */
function splitIt(lane: string | null | undefined): string {
  return lane === "transcript"
    ? "This recording is longer than the 40-minute limit. Split it into parts of 40 minutes or fewer and add each one through Add files."
    : "This file is longer than the 13-page limit. Split it into parts of 13 pages or fewer and add each one through Add files.";
}

const READING = new Set([
  "received", "sniffed", "text_pulled", "triaged", "parse_queued", "parsing", "parsed",
  "cleaning", "cleaned", "comprehending",
]);
/** Holds only a person lifts: an operator's triage confirmation, the document's own
 *  spending ceiling, or a failure the engine gave up retrying. */
const PERSON_HOLDS = new Set(["parked_low_confidence", "budget_paused", "failed_beyond_repair"]);
/** Pause reasons that always need a person, whatever time the engine records. */
const PERSON_REASONS = new Set(["reconciliation_required", "policy_missing"]);

const status = (label: KnowledgeLabel, tone: KnowledgeTone, detail?: string, resumesAt?: string, reason?: string): KnowledgeStatus => ({
  label, tone,
  ...(detail ? { detail } : {}),
  ...(reason ? { reason } : {}),
  ...(resumesAt ? { resumes_at: resumesAt } : {}),
  ...(label === KNOWLEDGE_LABELS.paused ? { usage_limited: true as const } : {}),
});

/** Ruling 38: a released source stays Available, and when its detail shows a later
 *  knowledge update waiting, one line says so, under the same rules as a pause: a
 *  time only when the engine recorded one, and the deployment's limit in neutral words. */
function updateWaitLine(document: KnowledgeStatusDocument, now: Date): string | null {
  const reason = document.paused_reason;
  if (!reason) return null;
  const when = PERSON_REASONS.has(reason) ? null : utcWhen(document.next_eligible_at, now);
  if (reason === "daily_spending_limit") {
    return when ? `Updating paused · continues after ${when} (daily limit)` : "Updating paused (daily limit) · waiting for our team";
  }
  if (reason === "deployment_limit") {
    return when ? `Updating delayed · continues after ${when}` : "Updating delayed · waiting for our team";
  }
  if (PERSON_REASONS.has(reason)) return "Updating delayed · waiting for our team";
  return when ? `Updating delayed · next try after ${when}` : "Updating delayed · waiting for our team";
}

/** Why the work waits and, only when the engine knows it, when it continues. */
function pauseStatus(document: KnowledgeStatusDocument, now: Date): KnowledgeStatus | null {
  const reason = document.paused_reason;
  if (!reason) return null;
  const when = PERSON_REASONS.has(reason) ? null : utcWhen(document.next_eligible_at, now);
  const resumesAt = when ? new Date(document.next_eligible_at!).toISOString() : undefined;
  if (reason === "daily_spending_limit") {
    return when
      ? status(KNOWLEDGE_LABELS.paused, "waiting", `Continues after ${when}`, resumesAt)
      : status(KNOWLEDGE_LABELS.paused, "waiting", WAITING_FOR_OUR_TEAM);
  }
  // The deployment's limit is not the client's: a neutral delay, never "your budget".
  if (reason === "deployment_limit") {
    return when
      ? status(KNOWLEDGE_LABELS.delayed, "waiting", `Continues after ${when}`, resumesAt)
      : status(KNOWLEDGE_LABELS.delayed, "waiting", WAITING_FOR_OUR_TEAM);
  }
  // provider_capacity, other, and any reason this screen does not know yet: a
  // technical delay, naming a retry only when one is scheduled.
  return when
    ? status(KNOWLEDGE_LABELS.delayed, "waiting", `Next try after ${when}`, resumesAt)
    : status(KNOWLEDGE_LABELS.delayed, "waiting", WAITING_FOR_OUR_TEAM);
}

/** The §7.2 status of one knowledge-engine source. Never throws: an unknown or
 *  legacy state is "Processing delayed", never failure copy. */
export function knowledgeStatus(
  document: KnowledgeStatusDocument,
  release: KnowledgeRelease,
  queue: readonly KnowledgeQueueItem[] = [],
  now: Date = new Date(),
): KnowledgeStatus {
  const state = typeof document.state === "string" ? document.state : "";
  // Withdrawal is not deletion: the file is kept (spec §2, "Use this source").
  if (state === "withdrawn") return status(KNOWLEDGE_LABELS.notInUse, "off", NOT_IN_USE_DETAIL);
  if (state === "superseded") return status(KNOWLEDGE_LABELS.notInUse, "off", REPLACED_DETAIL);
  // Input issues the client can fix (§7.4, "Unsupported/unreadable input").
  // Over the ~13-page (40-minute) limit, found after upload by `source_size` (D08).
  if (queue.some(item => item.kind === "source_size_rejected")) {
    return status(KNOWLEDGE_LABELS.needsHelp, "action", TOO_LONG_DETAIL, undefined, splitIt(document.lane));
  }
  if (state === "quarantined") {
    const message = document.quarantine?.message?.trim();
    return status(KNOWLEDGE_LABELS.needsHelp, "action", message || UNREADABLE_DETAIL);
  }
  // Released evidence is eligible information that can be used.
  if (state === "ready" && release?.state === "active") {
    if (release.yield === "empty") return status(KNOWLEDGE_LABELS.empty, "ready");
    const wait = updateWaitLine(document, now);
    if (!wait) return status(KNOWLEDGE_LABELS.available, "ready");
    return document.paused_reason === "daily_spending_limit"
      ? { ...status(KNOWLEDGE_LABELS.available, "ready", wait), usage_limited: true }
      : status(KNOWLEDGE_LABELS.available, "ready", wait);
  }
  const paused = pauseStatus(document, now);
  if (paused) return paused;
  if (state === "ready") return status(KNOWLEDGE_LABELS.processing, "working", UPDATING_KNOWLEDGE);
  if (READING.has(state)) return status(KNOWLEDGE_LABELS.processing, "working", READING_THE_FILE);
  if (PERSON_HOLDS.has(state)) return status(KNOWLEDGE_LABELS.delayed, "waiting", WAITING_FOR_OUR_TEAM);
  if (state.startsWith("failed_")) return { ...status(KNOWLEDGE_LABELS.delayed, "waiting", NO_RETRY_SCHEDULED), recheck: true };
  return status(KNOWLEDGE_LABELS.delayed, "waiting");
}

/** A file being deleted (Cycle 5 P8.2/P8.3): "Deleting" until its purge finishes,
 *  then it leaves the list. Nothing in it is used meanwhile; the screen reads the
 *  list again soon, so the row goes as soon as the purge is done. */
export function deletingStatus(): KnowledgeStatus {
  return { ...status(KNOWLEDGE_LABELS.deleting, "working"), recheck: true };
}

/** Said for a source whose own status could not be read just now. */
export const STATUS_UNAVAILABLE = "Status unavailable right now. We'll check again shortly.";

/** A source whose status read failed (P2 milestone review M4; spec §7.2: "Failed
 *  retrieval of status MUST appear unavailable/stale"): a delay, never a failure and
 *  never a time, and read again on the screen's normal cadence. The other sources in
 *  the list keep their own, current status. */
export function unavailableStatus(): KnowledgeStatus {
  return { ...status(KNOWLEDGE_LABELS.delayed, "waiting", STATUS_UNAVAILABLE), recheck: true };
}

/** The three-way status older readers of a knowledge-engine document still use
 *  (the operator panel's progress poll). Usable is "atomised"; something the
 *  client must fix, or a source not in use, is "failed" (settled, so nobody polls
 *  it); everything in progress or waiting is "uploaded". */
export function legacyStatus(knowledge: KnowledgeStatus): "uploaded" | "atomised" | "failed" {
  if (knowledge.tone === "ready") return "atomised";
  return knowledge.tone === "action" || knowledge.tone === "off" ? "failed" : "uploaded";
}

// ---- "Use this source" (Cycle 5 P7.2; spec §7.2-7.3, A21) ---------------------

/** The client's switch for one source, as `GET /v1/sources/{id}/lifecycle` reads it. */
export type SourceUse = {
  state: "on" | "off" | "pending";
  /** While pending, what the newest request asks for. */
  requested: "on" | "off" | null;
  /** Send it back as `expected_lifecycle_revision`. */
  revision: number;
};

export const SWITCHED_OFF_DETAIL = "Use this source is off. The file is kept.";
export const TURNING_OFF_DETAIL = "Turning off · pending";
export const TURNING_ON_DETAIL = "Turning on · pending";

/** The status of a source with its switch applied.
 *  - Off: "Not in use", the file kept (§7.2). Its own detail says the CLIENT's
 *    switch is off, so it is never mistaken for the operator's Stop processing
 *    (a withdrawn source), which this function leaves exactly as it is.
 *  - Pending: the status it has, with what is pending, read again soon. A
 *    pending switch back ON still reads "Not in use" (P7 review M-1): the engine
 *    excludes the source until the change is enforced.
 *  - On (or unknown): unchanged. */
export function withSourceUse(knowledge: KnowledgeStatus, use: SourceUse | null | undefined): KnowledgeStatus {
  if (!use || knowledge.label === KNOWLEDGE_LABELS.notInUse) return knowledge;
  if (use.state === "off") return status(KNOWLEDGE_LABELS.notInUse, "off", SWITCHED_OFF_DETAIL);
  if (use.state === "pending" && use.requested === "on") {
    return { ...status(KNOWLEDGE_LABELS.notInUse, "off", TURNING_ON_DETAIL), recheck: true };
  }
  if (use.state === "pending") return { ...knowledge, detail: TURNING_OFF_DETAIL, recheck: true };
  return knowledge;
}
