import "server-only";

import fs from "node:fs";
import path from "node:path";

import { getChatSessionSummary, postChatSessionSummaryFailure, putChatSessionSummary } from "@/lib/product";

import { wasCertainlyUnbilled } from "@/agent/lib/call-billing";
import type { Driver, TurnResult, TurnUsage } from "@/agent/lib/driver";
import { passCostMicrodollars, type WriterPrices } from "@/agent/lib/pricing";
import { skillVersion } from "@/agent/lib/prompt-versions";
import { estimateCallInputTokens, requestChars } from "@/agent/lib/reply-cap";
import { boundTranscript, type BoundedTranscript } from "@/agent/lib/transcript-bound";
import {
  assembleTranscriptEntries,
  escapeForBody,
  type ModelMessage,
  type TranscriptEntry,
  type TranscriptMessage,
} from "@/agent/transcript";

/**
 * Context compaction of long writing sessions (Cycle 5, P4.3; spec 10A.7).
 *
 * Every turn resends the conversation, so a long session costs more on every
 * reply. Past one measured threshold the agent:
 *
 * 1. **within a reply**, replaces older `read_knowledge` results with a short
 *    placeholder, keeping the latest two (`compactBeforeCall`). No AI call;
 *    only tool RESULTS change, so every `tool_use` keeps its `tool_result`;
 * 2. **before a reply**, if the conversation still exceeds the threshold,
 *    summarises the WRITER's side of its older part into ONE stored session
 *    summary, updated rather than re-summarised, and sends that summary, then
 *    every older CLIENT message verbatim and in order, then the latest three
 *    turns and the current client message (`compactSession`).
 *
 * **The client's words are carried, not judged** (fix round 1, Ruling 63).
 * Every older client message reaches the model as the same `<client-message>`
 * it always was, the one tag the instructions treat as the client's own words.
 * No model decides which client text survives, and a later "that's fine now"
 * is carried after the instruction it reverses, so the newest one wins. Only
 * when those messages alone pass `CLIENT_CARRY_BUDGET_CHARS` are the OLDEST
 * reduced to passages the summariser quotes from them, copied by code, in a
 * block that says so.
 *
 * The client still sees the whole conversation; only what the model receives
 * changes. A summary failure never blocks a reply: the turn falls back to the
 * deterministic bound (`transcript-bound.ts`), which also stays as the safety
 * cap on whatever compaction sends.
 *
 * **Provenance.** Written from the published concepts; no code is copied. The
 * clear-old-tool-results step and the overflow-then-update-the-summary approach
 * follow OpenCode's `session/compaction.ts` (MIT), and the safe cut point that
 * never separates a tool call from its result follows the idea of Cline's
 * `findCutIndex` (Apache-2.0).
 *
 * **The threshold (Ruling 62).** Compaction is the primary sizing on the c4
 * path, and three numbers must agree:
 *
 * - `MAX_TRANSCRIPT_CHARS` (105,000 characters, ~30k tokens) is where the hard
 *   cap starts cutting the conversation;
 * - compaction must trigger BEFORE that cut. A c4 request carries at least
 *   ~43,000 characters besides the conversation (instructions, skill and tool
 *   schemas; measured 2026-10-07), so a conversation at the cap makes a request
 *   of at least (43,000 + 105,000) / 3.5 = ~42,300 estimated tokens: above
 *   40,000, so compaction has always fired first. `tests/agent/compaction.test.ts`
 *   pins this inequality against the real prompts;
 * - the new-post suggestion fires at 80% (32,000 MEASURED tokens), which a long
 *   session reaches first: ~11k tokens of fixed prompt plus a conversation of
 *   roughly 80,000 characters, where compaction waits for ~97,000.
 *
 * The spec's first figure was "about 60,000". At 60,000 the hard cap would cut
 * long before compaction could trigger, and the notice would almost never show.
 */
export const COMPACTION_INPUT_TOKENS = 40_000;

/** Characters per token for the before-a-reply estimate: the ratio the hard cap
 *  was set with (`transcript-bound.ts`: 30k tokens = 105,000 characters). */
export const COMPACTION_CHARS_PER_TOKEN = 3.5;

/** What a cleared knowledge result says instead. */
export const CLEARED_RESULT = "[earlier result cleared]";

/** Knowledge results kept in full within a reply. */
export const KEEP_LATEST_READ_RESULTS = 2;

/** Turns kept verbatim after a summary, besides the current client message. */
export const KEEP_RECENT_TURNS = 3;

/** The summary model. It is in the writer price table and the reservation. */
export const SUMMARY_MODEL = "claude-haiku-4-5-20251001";

/** The summary's output ceiling: under the agent's `MAX_TOKENS`, so its worst
 *  case is inside the reservation's one-call margin. */
export const SUMMARY_MAX_TOKENS = 2_048;

/** Wall-clock allowance for the summary call, before the turn's own deadline. */
export const SUMMARY_TIMEOUT_MS = 60_000;

/** The backend's bounds on a stored summary (`chat_summaries.py`). */
export const MAX_SUMMARY_CHARS = 20_000;
export const MAX_EXCERPT_CHARS = 40_000;

/** Stored excerpts are joined with this. Splitting on it and joining again
 *  gives back exactly the same text, so nothing is ever rewritten. */
export const EXCERPT_SEPARATOR = "\n\n";

/**
 * The share of the threshold older client messages may take, carried verbatim:
 * 30% of 40,000 tokens = 12,000 tokens, 42,000 characters at the hard cap's
 * ratio. Client messages are short (at most 4,000 characters each, usually a
 * sentence or two), so this is dozens of earlier turns. Past it, the newest
 * that fit are still carried whole and only the oldest become excerpts.
 */
export const CLIENT_CARRY_BUDGET_FRACTION = 0.3;

/**
 * The back-off after a failed summary (P4.6, review M-5): no new attempt until
 * the client has sent this many more messages, doubling with each consecutive
 * failure up to `SUMMARY_BACKOFF_MAX_CLIENT_MESSAGES` (3, 6, 12, 24). Meanwhile
 * the reply uses the hard-capped transcript, which is the spec's fallback.
 *
 * Why 3 to start: a transient failure (an overloaded provider) has usually
 * cleared a few replies later, so compaction resumes soon, and the hard cap
 * covers those turns. Why double: a failure that repeats is likely to be
 * deterministic (a malformed reply, a model the account cannot use), and each
 * paid retry costs about US$0.05 and, if it throws, holds the reply's whole
 * reservation as `uncertain`; doubling bounds a broken session to a handful of
 * attempts a day instead of one per reply. A successful summary clears it.
 */
export const SUMMARY_BACKOFF_CLIENT_MESSAGES = 3;
export const SUMMARY_BACKOFF_MAX_CLIENT_MESSAGES = 24;

/** How many more client messages to wait after `failures` consecutive failures. */
export function summaryBackoffMessages(failures: number): number {
  const doublings = Math.max(Math.min(failures, 10) - 1, 0);
  return Math.min(SUMMARY_BACKOFF_CLIENT_MESSAGES * 2 ** doublings, SUMMARY_BACKOFF_MAX_CLIENT_MESSAGES);
}

/** The back-off marker as stored (`GET .../summary`, `backoff`). */
export type SummaryBackoff = {
  failures: number;
  failed_at_client_messages: number;
  reason: string;
};
export const CLIENT_CARRY_BUDGET_CHARS = Math.floor(
  COMPACTION_INPUT_TOKENS * CLIENT_CARRY_BUDGET_FRACTION * COMPACTION_CHARS_PER_TOKEN,
);

/** Input as the provider counts it: uncached, cache-read and cache-write. A
 *  figure the provider did not report counts as nothing. */
export function measuredInputTokens(usage: TurnUsage): number {
  return (usage.inputTokens ?? 0) + (usage.cacheReadInputTokens ?? 0) + (usage.cacheCreationInputTokens ?? 0);
}

// ---------------------------------------------------------------------------
// Step 1: within a reply
// ---------------------------------------------------------------------------

/**
 * Older `read_knowledge` results replaced by `CLEARED_RESULT`, the latest
 * `KEEP_LATEST_READ_RESULTS` kept in full, but only when the last call's
 * measured input was over the threshold. The same array when nothing changes.
 *
 * Only a result's `content` changes. Its `toolUseId`, its message and every
 * assistant `tool_use` are untouched, so the pairing the API requires holds.
 */
export function clearOlderReadResults(messages: ModelMessage[], measured: number | null): ModelMessage[] {
  if (measured === null || measured <= COMPACTION_INPUT_TOKENS) return messages;
  const positions: Array<[number, number]> = [];
  messages.forEach((message, i) => {
    message.toolResults?.forEach((result, j) => {
      if (result.name === "read_knowledge") positions.push([i, j]);
    });
  });
  const older = positions.slice(0, Math.max(positions.length - KEEP_LATEST_READ_RESULTS, 0));
  const clear = older.filter(([i, j]) => messages[i].toolResults?.[j].content !== CLEARED_RESULT);
  if (clear.length === 0) return messages;
  const byMessage = new Map<number, Set<number>>();
  for (const [i, j] of clear) byMessage.set(i, (byMessage.get(i) ?? new Set<number>()).add(j));
  return messages.map((message, i) => {
    const cleared = byMessage.get(i);
    if (!cleared || !message.toolResults) return message;
    return {
      ...message,
      toolResults: message.toolResults.map((result, j) =>
        cleared.has(j) ? { ...result, content: CLEARED_RESULT } : result,
      ),
    };
  });
}

/** The loop's hook before each model call (`turn.ts`): step 1, measured from
 *  the previous call of this reply. */
export function compactBeforeCall(messages: ModelMessage[], lastPass: TurnUsage | null): ModelMessage[] {
  return clearOlderReadResults(messages, lastPass === null ? null : measuredInputTokens(lastPass));
}

// ---------------------------------------------------------------------------
// The cut point
// ---------------------------------------------------------------------------

function carriesToolUse(message: ModelMessage): boolean {
  if (message.role !== "assistant") return false;
  if ((message.toolCalls?.length ?? 0) > 0) return true;
  return (message.providerBlocks ?? []).some(
    (block) => typeof block === "object" && block !== null && (block as { type?: unknown }).type === "tool_use",
  );
}

function carriesToolResult(message: ModelMessage): boolean {
  return message.role === "user" && (message.toolResults?.length ?? 0) > 0;
}

/** A client's own turn: a user message that is not tool results. */
export function isClientTurnStart(message: ModelMessage): boolean {
  return message.role === "user" && !carriesToolResult(message);
}

/**
 * Where to cut so the latest `keepTurns` turns are kept: the index of the first
 * kept message, or 0 when there are not more turns than that (nothing older to
 * summarise).
 *
 * A turn starts at a message `isTurnStart` accepts. The cut is then walked back
 * until it does not separate a `tool_use` from its `tool_result`: never at a
 * tool-result message, never right after a message that called a tool.
 */
export function findCutIndex(
  messages: ModelMessage[],
  keepTurns: number,
  isTurnStart: (message: ModelMessage, index: number) => boolean = isClientTurnStart,
): number {
  let seen = 0;
  let cut = -1;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (isTurnStart(messages[i], i)) {
      seen += 1;
      if (seen === keepTurns) {
        cut = i;
        break;
      }
    }
  }
  if (cut <= 0) return 0;
  while (cut > 0 && (carriesToolResult(messages[cut]) || carriesToolUse(messages[cut - 1]))) cut -= 1;
  return cut;
}

// ---------------------------------------------------------------------------
// Step 2: before a reply
// ---------------------------------------------------------------------------

/** A session summary as stored (`GET /v1/chat/sessions/{id}/summary`). */
export type StoredSessionSummary = {
  revision: number;
  covers_through_message_id: string;
  summary_text: string;
  /** Passages quoted from the oldest client messages, only once those passed the
   *  carry budget; joined by `EXCERPT_SEPARATOR`. Empty otherwise. */
  client_excerpts_verbatim: string;
  /** The newest client message the excerpts stand for; every later older client
   *  message is carried whole. Null when there are no excerpts. */
  excerpts_through_message_id: string | null;
};

export type CompactionStage = "none" | "stored" | "summarized" | "fallback";

export type SessionCompaction = {
  /** The earlier conversation to send, within the hard cap. */
  transcript: BoundedTranscript;
  stage: CompactionStage;
  /** Why it fell back, or null. A code, never content. */
  reason: string | null;
  /** What the summary call cost, counted against the reply cap: priced from
   *  its usage; its worst case when it may have been billed but cannot be
   *  priced; 0 without a call or when it certainly was not billed. */
  summaryCostMicrodollars: number;
  /** Whether the model is shown a summary this turn. */
  summaryInUse: boolean;
  /** Whether some older client messages are shown only as excerpts. */
  excerptsInUse: boolean;
  /** The summary prompt's version, when a summary call was prepared. */
  promptVersion: string | null;
};

export type SessionCompactionInput = {
  token: string;
  sessionId: string;
  /** The stored conversation before this turn (the just-recorded message excluded). */
  rows: TranscriptMessage[];
  /** Characters every call of this turn sends besides the earlier conversation:
   *  system, tools, turn context and the current client message. */
  fixedChars: number;
  /** The turn's METERED driver: the summary is a pass of this reply. */
  driver: Driver;
  /** The reservation's prices; the summary model must be among them. */
  prices: WriterPrices;
  /** The reservation's per-call input bound; a larger summary call is not sent. */
  maxCallInputTokens: number;
};

let promptFile: string | null = null;

/** The summary prompt, read once. Its frontmatter is not sent. */
export function summaryPrompt(): { text: string; version: string | null } {
  if (promptFile === null) {
    promptFile = fs.readFileSync(path.join(process.cwd(), "src/agent/prompts/session-summary.md"), "utf8");
  }
  return {
    text: promptFile.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, "").trim(),
    version: skillVersion("session-summary", promptFile)?.version ?? null,
  };
}

/** Estimated tokens of `chars` characters, at the hard cap's ratio. */
export function estimateSessionTokens(chars: number): number {
  return Math.ceil(chars / COMPACTION_CHARS_PER_TOKEN);
}

export function splitExcerpts(stored: string): string[] {
  return stored.split(EXCERPT_SEPARATOR).filter((item) => item.trim().length > 0);
}

/**
 * Earlier excerpts first, then new ones not already held, exactly as written.
 * Within `MAX_EXCERPT_CHARS` by dropping the OLDEST: this is already the
 * over-budget path, and failing here would only make every later turn pay for
 * a summary it then throws away (review M4).
 */
export function mergeExcerpts(previous: string[], added: string[]): string[] {
  const merged = [...previous];
  for (const item of added) if (item.trim().length > 0 && !merged.includes(item)) merged.push(item);
  while (merged.length > 0 && merged.join(EXCERPT_SEPARATOR).length > MAX_EXCERPT_CHARS) merged.shift();
  return merged;
}

/** Older client messages carried whole: after the excerpted ones, before `end`. */
export function carriedClientEntries(entries: TranscriptEntry[], end: number, excerptsThrough: number): TranscriptEntry[] {
  return entries.slice(excerptsThrough + 1, end).filter((entry) => entry.row.kind === "task");
}

/** The newest client messages that fit the carry budget, and the older rest. */
export function withinCarryBudget(clientEntries: TranscriptEntry[]): {
  carried: TranscriptEntry[];
  overflow: TranscriptEntry[];
} {
  let used = 0;
  let first = clientEntries.length;
  for (let i = clientEntries.length - 1; i >= 0; i -= 1) {
    const size = clientEntries[i].message.content.length;
    if (used + size > CLIENT_CARRY_BUDGET_CHARS) break;
    used += size;
    first = i;
  }
  return { carried: clientEntries.slice(first), overflow: clientEntries.slice(0, first) };
}

/**
 * What stands for the summarised part of the conversation, in order: the
 * summary of the writer's side; the excerpts block, when there is one; then
 * every carried client message exactly as the transcript renders it.
 */
export function compactedPrefix(
  summaryText: string,
  excerpts: string[],
  carried: TranscriptEntry[],
): ModelMessage[] {
  const summary: ModelMessage = {
    role: "user",
    content:
      "<server-note>The earlier part of this conversation is summarised below in place of the writer's messages. " +
      "The client's own earlier messages follow it word for word, oldest first. " +
      "The client can still see the whole conversation.</server-note>\n" +
      `<session-summary trust="model-summarized" citable="false">\n${escapeForBody(summaryText)}\n</session-summary>`,
  };
  const excerptBlock: ModelMessage[] =
    excerpts.length === 0
      ? []
      : [
          {
            role: "user",
            content:
              "<server-note>The client's earliest messages are too long to repeat in full. The passages below are " +
              "quoted exactly from them, but which passages were kept was chosen by a summariser, so something the " +
              "client said there may be missing. Their later messages follow in full.</server-note>\n" +
              excerpts.map((item) => `<client-message excerpt="true">${escapeForBody(item)}</client-message>`).join("\n"),
          },
        ];
  return [summary, ...excerptBlock, ...carried.map((entry) => entry.message)];
}

function speaker(kind: string): string {
  if (kind === "task") return "client";
  if (kind === "agent") return "writer";
  return "server";
}

/** One message given to the summariser; `overflow` client messages are to be excerpted. */
export type SummaryItem = { entry: TranscriptEntry; overflow: boolean };

/** The summary call's one user message: the earlier summary and the messages to fold in. */
export function summaryInput(previousSummary: string | null, items: SummaryItem[]): string {
  const lines = items.map(
    ({ entry, overflow }, index) =>
      `<message n="${index + 1}" from="${speaker(entry.row.kind)}"${overflow ? ' overflow="true"' : ""}>` +
      `${escapeForBody(entry.row.body)}</message>`,
  );
  return (
    (previousSummary ? `<previous-summary>\n${escapeForBody(previousSummary)}\n</previous-summary>\n` : "") +
    `<conversation>\n${lines.join("\n")}\n</conversation>`
  );
}

function unescapeBody(value: string): string {
  return value.replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&amp;", "&");
}

/**
 * The summary, and the passages quoted from overflow client messages, from the
 * model's reply; `null` when the reply is not in the format asked for.
 *
 * **The model points; the code copies.** An excerpt is kept only when it names
 * an overflow client message and is a verbatim part of it; a quote that is not
 * verbatim keeps that WHOLE message instead. Anything naming a message that is
 * not overflow is ignored: those are carried whole anyway.
 */
export function parseSummaryReply(
  reply: string,
  items: SummaryItem[],
): { summary: string; excerpts: string[] } | null {
  const summary = /<summary>([\s\S]*?)<\/summary>/.exec(reply)?.[1]?.trim();
  if (!summary || summary.length > MAX_SUMMARY_CHARS) return null;
  const excerpts: string[] = [];
  for (const match of reply.matchAll(/<excerpt\s+message="(\d+)"\s*>([\s\S]*?)<\/excerpt>/g)) {
    const item = items[Number(match[1]) - 1];
    if (!item || !item.overflow) continue;
    const quote = unescapeBody(match[2]).trim();
    if (quote.length === 0) continue;
    const body = item.entry.row.body;
    const verbatim = body.includes(quote) ? quote : body;
    if (!excerpts.includes(verbatim)) excerpts.push(verbatim);
  }
  return { summary, excerpts };
}

function isStoredSummary(raw: unknown): raw is StoredSessionSummary {
  if (typeof raw !== "object" || raw === null) return false;
  const value = raw as Record<string, unknown>;
  return (
    Number.isSafeInteger(value.revision) &&
    (value.revision as number) > 0 &&
    typeof value.covers_through_message_id === "string" &&
    typeof value.summary_text === "string" &&
    value.summary_text.trim().length > 0 &&
    typeof value.client_excerpts_verbatim === "string" &&
    (value.excerpts_through_message_id === null || typeof value.excerpts_through_message_id === "string")
  );
}

function isBackoff(raw: unknown): raw is SummaryBackoff {
  if (typeof raw !== "object" || raw === null) return false;
  const value = raw as Record<string, unknown>;
  return (
    Number.isSafeInteger(value.failures) &&
    (value.failures as number) > 0 &&
    Number.isSafeInteger(value.failed_at_client_messages) &&
    typeof value.reason === "string"
  );
}

/** The stored summary and back-off marker (`GET .../summary`), each null when absent. */
async function readStoredState(
  token: string,
  sessionId: string,
): Promise<{ summary: StoredSessionSummary | null; backoff: SummaryBackoff | null }> {
  try {
    const raw = await getChatSessionSummary(token, sessionId);
    const state = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
    return {
      summary: isStoredSummary(state.summary) ? state.summary : null,
      backoff: isBackoff(state.backoff) ? state.backoff : null,
    };
  } catch {
    // A failed read means no summary this turn; the hard cap still holds.
    return { summary: null, backoff: null };
  }
}

/** Record a failed summary for the back-off. Never throws: it is bookkeeping. */
async function recordFailure(
  token: string,
  sessionId: string,
  clientMessages: number,
  reason: "summary_failed" | "summary_malformed" | "summary_not_stored",
): Promise<void> {
  try {
    await postChatSessionSummaryFailure(token, sessionId, { failed_at_client_messages: clientMessages, reason });
  } catch {
    // Unrecorded: the next turn over the threshold may try again.
  }
}

/** The summary call's worst case, held against the reply cap until it is priced. */
function summaryWorstCase(inputTokens: number, prices: WriterPrices): number {
  const rate = prices[SUMMARY_MODEL];
  const inputRate = Math.max(rate.input, rate.cache_write_5m, rate.cache_read);
  return Math.ceil((inputTokens * inputRate + SUMMARY_MAX_TOKENS * rate.output) / 1_000_000);
}

/**
 * The earlier conversation this turn sends, compacted when it is too large.
 *
 * Never throws and never blocks the reply. Any failure (the call throws or
 * times out, its reply is malformed or cut off, the call would exceed the
 * per-call input bound, the summary model has no price) falls back to the hard
 * cap over what is already held, and writes no summary.
 */
export async function compactSession(input: SessionCompactionInput): Promise<SessionCompaction> {
  let cost = 0;
  let promptVersion: string | null = null;
  let effective: ModelMessage[] = [];
  let stored: StoredSessionSummary | null = null;
  let storedExcerpts: string[] = [];
  const result = (
    stage: CompactionStage,
    transcript: ModelMessage[],
    reason: string | null,
    summaryInUse: boolean,
    excerptsInUse: boolean,
  ): SessionCompaction => ({
    transcript: boundTranscript(transcript),
    stage,
    reason,
    summaryCostMicrodollars: cost,
    summaryInUse,
    excerptsInUse,
    promptVersion,
  });
  const fallback = (reason: string) =>
    result("fallback", effective, reason, stored !== null, stored !== null && storedExcerpts.length > 0);
  // A session's first turn has nothing to compact and no summary to read.
  if (input.rows.length === 0) return result("none", [], null, false, false);
  try {
    const entries = assembleTranscriptEntries(input.rows);
    effective = entries.map((entry) => entry.message);
    const state = await readStoredState(input.token, input.sessionId);
    stored = state.summary;
    // The client's messages so far: the back-off's clock.
    const clientMessages = entries.filter((entry) => entry.row.kind === "task").length;
    const storedRevision = stored?.revision ?? null;
    let start = 0;
    let excerptsThrough = -1;
    if (stored !== null) {
      const coveredId = stored.covers_through_message_id;
      const covered = entries.findIndex((entry) => entry.row.id === coveredId);
      if (covered < 0) {
        // Unusable: every client message is carried whole instead.
        stored = null;
      } else {
        start = covered + 1;
        const throughId = stored.excerpts_through_message_id;
        excerptsThrough = throughId === null ? -1 : entries.findIndex((entry) => entry.row.id === throughId);
        storedExcerpts = excerptsThrough < 0 ? [] : splitExcerpts(stored.client_excerpts_verbatim);
      }
    }
    const recent = entries.slice(start);
    const recentMessages = recent.map((entry) => entry.message);
    effective = stored
      ? [
          ...compactedPrefix(stored.summary_text, storedExcerpts, carriedClientEntries(entries, start, excerptsThrough)),
          ...recentMessages,
        ]
      : recentMessages;

    const estimated = estimateSessionTokens(input.fixedChars + requestChars([], effective, []));
    if (estimated <= COMPACTION_INPUT_TOKENS) {
      return result(stored ? "stored" : "none", effective, null, stored !== null, storedExcerpts.length > 0);
    }

    const cut = findCutIndex(recentMessages, KEEP_RECENT_TURNS, (_message, index) => recent[index].row.kind === "task");
    if (cut === 0) return fallback("too_few_turns");
    const end = start + cut;
    const older = recent.slice(0, cut);
    const kept = recent.slice(cut);
    // Every older client message, whole, newest first within the budget; only
    // the oldest past it are excerpted.
    const { carried, overflow } = withinCarryBudget(carriedClientEntries(entries, end, excerptsThrough));
    const overflowIds = new Set(overflow.map((entry) => entry.row.id));
    const olderIds = new Set(older.map((entry) => entry.row.id));
    const items: SummaryItem[] = entries
      .filter((entry) => overflowIds.has(entry.row.id) || olderIds.has(entry.row.id))
      .map((entry) => ({ entry, overflow: overflowIds.has(entry.row.id) }));

    // Backing off after a failure: no paid attempt until the client has sent
    // enough further messages (review M-5).
    if (
      state.backoff !== null &&
      clientMessages < state.backoff.failed_at_client_messages + summaryBackoffMessages(state.backoff.failures)
    ) {
      return fallback("summary_backoff");
    }
    if (!Object.prototype.hasOwnProperty.call(input.prices, SUMMARY_MODEL)) return fallback("summary_model_unpriced");
    const prompt = summaryPrompt();
    promptVersion = prompt.version;
    const system = [{ text: prompt.text, cache: false }];
    const messages: ModelMessage[] = [{ role: "user", content: summaryInput(stored?.summary_text ?? null, items) }];
    const summaryTokens = estimateCallInputTokens(null, requestChars(system, messages, []));
    if (summaryTokens > input.maxCallInputTokens) return fallback("summary_input_too_large");

    // Held at its worst case from before the call: one that throws may still
    // have been billed, and the reply cap must count it either way.
    cost = summaryWorstCase(summaryTokens, input.prices);
    let reply: TurnResult;
    try {
      reply = await input.driver.runTurn({
        model: SUMMARY_MODEL,
        maxTokens: SUMMARY_MAX_TOKENS,
        system,
        messages,
        tools: [],
        onText: () => {},
        timeoutMs: SUMMARY_TIMEOUT_MS,
      });
    } catch (error) {
      // Certainly not billed (Ruling 16's list): nothing to hold against the cap.
      if (wasCertainlyUnbilled(error)) cost = 0;
      await recordFailure(input.token, input.sessionId, clientMessages, "summary_failed");
      return fallback("summary_failed");
    }
    cost = passCostMicrodollars(reply.usage, reply.model ?? SUMMARY_MODEL, input.prices) ?? cost;

    const parsed = reply.stopReason === "max_tokens" ? null : parseSummaryReply(reply.text, items);
    if (parsed === null) {
      await recordFailure(input.token, input.sessionId, clientMessages, "summary_malformed");
      return fallback("summary_malformed");
    }
    const excerpts = overflow.length > 0 ? mergeExcerpts(storedExcerpts, parsed.excerpts) : storedExcerpts;
    const throughEntry = overflow.length > 0 ? overflow[overflow.length - 1] : excerptsThrough >= 0 ? entries[excerptsThrough] : null;

    const next: StoredSessionSummary = {
      revision: (storedRevision ?? 0) + 1,
      covers_through_message_id: older[older.length - 1].row.id,
      summary_text: parsed.summary,
      client_excerpts_verbatim: excerpts.join(EXCERPT_SEPARATOR),
      excerpts_through_message_id: throughEntry?.row.id ?? null,
    };
    try {
      await putChatSessionSummary(input.token, input.sessionId, {
        expected_revision: storedRevision,
        covers_through_message_id: next.covers_through_message_id,
        summary_text: next.summary_text,
        client_excerpts_verbatim: next.client_excerpts_verbatim,
        excerpts_through_message_id: next.excerpts_through_message_id,
      });
    } catch (error) {
      // Not stored: this turn still uses it. A lost race (409) means another
      // turn stored one, which is fine; any other failure backs off, or every
      // later turn would pay for a summary it cannot keep.
      if ((error as { status?: unknown }).status !== 409) {
        await recordFailure(input.token, input.sessionId, clientMessages, "summary_not_stored");
      }
    }
    return result(
      "summarized",
      [...compactedPrefix(next.summary_text, excerpts, carried), ...kept.map((entry) => entry.message)],
      null,
      true,
      excerpts.length > 0,
    );
  } catch {
    return fallback("compaction_error");
  }
}
