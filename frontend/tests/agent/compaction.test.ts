import fs from "node:fs";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { markCertainlyUnbilled } from "@/agent/lib/call-billing";
import type { DriverRequest, TurnResult, TurnUsage } from "@/agent/lib/driver";
import type { ModelMessage, TranscriptMessage } from "@/agent/transcript";

import { RESERVE_RESPONSE } from "./support/reserve-response";

/**
 * Cycle 5, P4.3: token-triggered compaction of long writing sessions (spec
 * 10A.7; Ruling 62).
 *
 * - Step 1, within a reply: over the threshold, older `read_knowledge` results
 *   are cleared and the latest two kept; tool calls and results stay paired.
 * - Step 2, before a reply: over the threshold, the older conversation is
 *   summarised (Haiku 4.5, metered with the reply), the latest three turns and
 *   the current message are kept verbatim, and the cut never separates a tool
 *   call from its result.
 * - Every older client message is carried VERBATIM, in order, as the same
 *   `<client-message>` it always was (review focus 4; fix round 1, Ruling 63).
 *   Only past the carry budget are the oldest reduced to quoted excerpts.
 * - A summary failure never blocks the reply (A45): the hard cap is used and no
 *   summary is written.
 * - The thresholds agree: compaction fires before the hard cap would cut, and a
 *   realistic long session reaches the new-post notice first.
 *
 * The route tests drive the shipping route, loop, meter and compaction against
 * stubbed product calls and a stub driver that reports usage.
 */

type Respond = (request: DriverRequest) => TurnResult | Promise<TurnResult>;

const state = vi.hoisted(() => ({
  prior: [] as Array<Record<string, unknown>>,
  stored: null as null | Record<string, unknown>,
  backoff: null as null | Record<string, unknown>,
  failures: [] as Array<Record<string, unknown>>,
  reads: 0,
  puts: [] as Array<Record<string, unknown>>,
  settles: [] as Array<Record<string, unknown>>,
  requests: [] as Array<{ model: string | undefined; messages: ModelMessage[]; system: string }>,
  respond: null as null | ((request: never) => unknown),
}));

vi.mock("@/lib/client-session", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/client-session")>()),
  requireClientToken: async () => "token",
}));

vi.mock("@/lib/product", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/product")>()),
  recordClientTurn: async (_token: string, _session: string, body: { message: string }) => ({
    session: { id: "s", platform: "linkedin", content_item_id: null },
    messages: [
      ...state.prior,
      { id: "current", role: "user", kind: "task", body: body.message, command_kind: null, handle: "U99" },
    ],
    variants: [],
    selected_variant_id: null,
  }),
  getOnboarding: async () => {
    throw new Error("not needed");
  },
  postTurnBudget: async (_token: string, _session: string, body: Record<string, unknown>) => {
    if (body.action === "reserve") return RESERVE_RESPONSE;
    state.settles.push(body);
    return { settled: body.outcome };
  },
  recordAgentTurn: async () => ({}),
  listRecentContent: async () => ({ items: [], next_cursor: null, truncated: false }),
  getChatSessionSummary: async () => ({ summary: state.stored, backoff: state.backoff }),
  postChatSessionSummaryFailure: async (_token: string, _session: string, body: Record<string, unknown>) => {
    state.failures.push(body);
    state.backoff = {
      failures: ((state.backoff?.failures as number | undefined) ?? 0) + 1,
      failed_at_client_messages: body.failed_at_client_messages,
      reason: body.reason,
      updated_at: "2026-10-07T00:00:00Z",
    };
    return state.backoff;
  },
  createChatRead: async () => {
    state.reads += 1;
    return {
      schema: "c4-tool-1",
      read_view: "c4v_abc",
      receipt: `R${state.reads}`,
      items: [],
      sources: [],
      gaps: [],
      coverage: { extent: "selected", truncated: false, processing: "ready", retrieval: "ok", index_pending: false },
      diagnostics: [],
      next_cursor: null,
    };
  },
  putChatSessionSummary: async (_token: string, _session: string, body: Record<string, unknown>) => {
    state.puts.push(body);
    // A summary that landed ends the back-off, as the backend does.
    state.backoff = null;
    state.stored = {
      session_id: "s",
      revision: ((body.expected_revision as number | null) ?? 0) + 1,
      covers_through_message_id: body.covers_through_message_id,
      summary_text: body.summary_text,
      client_excerpts_verbatim: body.client_excerpts_verbatim,
      excerpts_through_message_id: body.excerpts_through_message_id,
      updated_at: "2026-10-07T00:00:00Z",
    };
    return state.stored;
  },
}));

vi.mock("@/lib/client-timezone", () => ({
  clientTimezone: async () => {
    throw new Error("no zone");
  },
}));

vi.mock("@/agent/lib/loop", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/agent/lib/loop")>();
  const stub = {
    toProviderTools: (tools: unknown) => tools,
    runTurn: async (request: DriverRequest): Promise<TurnResult> => {
      state.requests.push({
        model: request.model,
        messages: [...request.messages],
        system: request.system.map((block) => block.text).join("\n"),
      });
      return (state.respond as unknown as Respond)(request);
    },
  };
  return { ...actual, anthropicDriver: stub, anthropicC4Driver: stub };
});

const SESSION = "55555555-5555-4555-8555-555555555555";
const HAIKU = "claude-haiku-4-5-20251001";
const OPUS = "claude-opus-5";
const NO_EXCLAMATIONS = "never use exclamation marks";

const usage = (input: number, output = 100, cacheRead = 0, cacheWrite = 0): TurnUsage => ({
  inputTokens: input,
  outputTokens: output,
  cacheReadInputTokens: cacheRead,
  cacheCreationInputTokens: cacheWrite,
});

const reply = (u: TurnUsage = usage(1_000), text = "Here is the revised draft."): TurnResult => ({
  text,
  toolCalls: [],
  stopReason: "end_turn",
  usage: u,
  model: OPUS,
});

const summaryReply = (text: string, u: TurnUsage = usage(30_000, 500)): TurnResult => ({
  text,
  toolCalls: [],
  stopReason: "end_turn",
  usage: u,
  model: HAIKU,
});

const MIDDLE_INSTRUCTION = `Please ${NO_EXCLAMATIONS} anywhere in the post.`;
const REVERSAL = "Exclamation marks are fine now.";

const GOOD_SUMMARY =
  "<summary>\nBrief: a LinkedIn post about the new opening hours. Rejected: a jokey opener.\n</summary>\n" +
  "<client-excerpts>\n</client-excerpts>";

/** A conversation of `turns` client/writer exchanges. The style instruction is
 *  in the MIDDLE (turn 4), not the opening message the hard cap always keeps.
 *  Each exchange is roughly `size` characters. */
function conversation(
  turns: number,
  size = 9_000,
  clientAt: Record<number, string> = { 4: MIDDLE_INSTRUCTION },
): TranscriptMessage[] {
  const rows: TranscriptMessage[] = [];
  for (let t = 1; t <= turns; t += 1) {
    const client =
      clientAt[t] ??
      (t === 1
        ? "Write about our new opening hours."
        : `Turn ${t}: make it a little warmer. ${"Some more context about the business. ".repeat(Math.floor(size / 4 / 38))}`);
    rows.push({ id: `c${t}`, role: "user", kind: "task", body: client, command_kind: null, handle: `U${2 * t - 1}` });
    rows.push({
      id: `a${t}`,
      role: "assistant",
      kind: "agent",
      body: `Draft ${t}. ${"A sentence of the draft that runs on for a while. ".repeat(Math.floor((size * 3) / 4 / 50))}`,
      command_kind: null,
      handle: null,
    });
  }
  return rows;
}

async function turn(contract: "c4" | "context.v1" = "c4", message = "Shorter, please."): Promise<Array<Record<string, unknown>>> {
  process.env.AGENT_CONTRACT = contract;
  vi.resetModules();
  const { POST } = await import("@/app/api/client/chat/sessions/[sessionId]/agent/route");
  const response = await POST(
    new Request("http://localhost/api/client/chat/sessions/x/agent", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message, turnId: crypto.randomUUID() }),
    }),
    { params: Promise.resolve({ sessionId: SESSION }) },
  );
  const text = await response.text();
  return text
    .split("\n\n")
    .filter((frame) => frame.startsWith("data:"))
    .map((frame) => JSON.parse(frame.slice(5)));
}

const mainCalls = () => state.requests.filter((request) => request.model !== HAIKU);
const summaryCalls = () => state.requests.filter((request) => request.model === HAIKU);
const text = (messages: ModelMessage[]) => messages.map((message) => message.content).join("\n");

beforeEach(() => {
  delete process.env.AUTHORITY_AGENT_DRIVER;
  state.prior = [];
  state.stored = null;
  state.backoff = null;
  state.failures = [];
  state.reads = 0;
  state.puts = [];
  state.settles = [];
  state.requests = [];
  state.respond = ((request: DriverRequest) =>
    request.model === HAIKU ? summaryReply(GOOD_SUMMARY) : reply()) as never;
});

afterEach(() => {
  delete process.env.AGENT_CONTRACT;
});

// ---------------------------------------------------------------------------
// Step 1
// ---------------------------------------------------------------------------

/** One assistant pass calling `read_knowledge`, then its result. */
function readPair(n: number, body = `knowledge result ${n} `.repeat(200)): ModelMessage[] {
  return [
    {
      role: "assistant",
      content: "",
      toolCalls: [{ id: `toolu_${n}`, name: "read_knowledge", input: { n } }],
      providerBlocks: [{ type: "tool_use", id: `toolu_${n}`, name: "read_knowledge", input: { n } }],
    },
    {
      role: "user",
      content: "",
      toolResults: [{ toolUseId: `toolu_${n}`, name: "read_knowledge", content: body, isError: false }],
    },
  ];
}

function pairsAreValid(messages: ModelMessage[]): boolean {
  for (let i = 0; i < messages.length; i += 1) {
    const calls = messages[i].toolCalls ?? [];
    if (calls.length === 0) continue;
    const results = messages[i + 1]?.toolResults ?? [];
    const ids = results.map((result) => result.toolUseId);
    if (calls.length !== results.length || !calls.every((call) => ids.includes(call.id))) return false;
  }
  return true;
}

describe("step 1: older knowledge results within a reply", () => {
  it("a short session is never compacted", async () => {
    const { clearOlderReadResults, COMPACTION_INPUT_TOKENS } = await import("@/agent/lib/compaction");
    const messages = [1, 2, 3, 4, 5].flatMap((n) => readPair(n));

    expect(clearOlderReadResults(messages, COMPACTION_INPUT_TOKENS)).toBe(messages);
    expect(clearOlderReadResults(messages, 1_000)).toBe(messages);
    expect(clearOlderReadResults(messages, null)).toBe(messages);
  });

  it("over the threshold, keeps the latest 2 of 5 results in full, clears 3, and keeps every pair", async () => {
    const { clearOlderReadResults, CLEARED_RESULT, COMPACTION_INPUT_TOKENS } = await import("@/agent/lib/compaction");
    const messages: ModelMessage[] = [
      { role: "user", content: "<client-message>Write it.</client-message>" },
      ...[1, 2, 3, 4, 5].flatMap((n) => readPair(n)),
    ];
    const before = JSON.parse(JSON.stringify(messages));

    const compacted = clearOlderReadResults(messages, COMPACTION_INPUT_TOKENS + 1);

    const results = compacted.flatMap((message) => message.toolResults ?? []);
    expect(results.map((result) => result.content === CLEARED_RESULT)).toEqual([true, true, true, false, false]);
    expect(results[3].content).toBe(messages[8].toolResults![0].content);
    expect(results[4].content).toBe(messages[10].toolResults![0].content);
    // Only result contents changed: every tool_use, id and position is as it was.
    expect(compacted.map((message) => message.toolCalls)).toEqual(before.map((message: ModelMessage) => message.toolCalls));
    expect(compacted.map((message) => message.providerBlocks)).toEqual(
      before.map((message: ModelMessage) => message.providerBlocks),
    );
    expect(results.map((result) => result.toolUseId)).toEqual(["toolu_1", "toolu_2", "toolu_3", "toolu_4", "toolu_5"]);
    expect(pairsAreValid(compacted)).toBe(true);
    // The caller's array is not mutated.
    expect(messages).toEqual(before);
  });

  it("is applied by the loop before the next call once a pass measured over the threshold", async () => {
    const { runAgentTurn } = await import("@/agent/lib/turn");
    const { CLEARED_RESULT } = await import("@/agent/lib/compaction");
    const seen: ModelMessage[][] = [];
    let pass = 0;
    const driver = {
      toProviderTools: (tools: unknown) => tools,
      runTurn: async (request: DriverRequest): Promise<TurnResult> => {
        seen.push(request.messages.map((message) => ({ ...message })));
        pass += 1;
        if (pass <= 5) {
          return {
            text: "",
            toolCalls: [{ id: `toolu_${pass}`, name: "read_knowledge", input: { pass } }],
            stopReason: "tool_use",
            // Passes 1-4 are small; pass 5 measures over the threshold.
            usage: pass < 5 ? usage(10_000) : usage(1_000, 100, 30_000, 10_001),
            model: OPUS,
          };
        }
        return reply();
      },
    };

    await runAgentTurn({
      driver,
      executor: async () => ({ kind: "ok", result: { items: ["a long knowledge result"] } }),
      messages: [{ role: "user", content: "<client-message>Write it.</client-message>" }],
    });

    const cleared = (messages: ModelMessage[]) =>
      messages.flatMap((message) => message.toolResults ?? []).filter((result) => result.content === CLEARED_RESULT);
    // Before pass 5 reported, nothing was cleared; after it, the oldest three were.
    expect(cleared(seen[4])).toHaveLength(0);
    expect(cleared(seen[5])).toHaveLength(3);
    expect(pairsAreValid(seen[5])).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// The cut point
// ---------------------------------------------------------------------------

/** A deterministic generator: no new dependency, the same cases every run. */
function prng(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value = (Math.imul(value, 1_664_525) + 1_013_904_223) >>> 0;
    return value / 2 ** 32;
  };
}

function generatedTranscript(random: () => number): ModelMessage[] {
  const messages: ModelMessage[] = [];
  const turns = 1 + Math.floor(random() * 8);
  let id = 0;
  for (let t = 0; t < turns; t += 1) {
    messages.push({ role: "user", content: `<client-message>turn ${t}</client-message>` });
    const tools = Math.floor(random() * 4);
    for (let k = 0; k < tools; k += 1) {
      const calls = 1 + Math.floor(random() * 3);
      const ids = Array.from({ length: calls }, () => `toolu_${(id += 1)}`);
      messages.push({ role: "assistant", content: "", toolCalls: ids.map((callId) => ({ id: callId, name: "read_knowledge", input: {} })) });
      messages.push({
        role: "user",
        content: "",
        toolResults: ids.map((callId) => ({ toolUseId: callId, name: "read_knowledge", content: "r", isError: false })),
      });
    }
    if (random() < 0.8) messages.push({ role: "assistant", content: `reply ${t}` });
  }
  return messages;
}

function splitsAPair(messages: ModelMessage[], cut: number): boolean {
  if (cut <= 0 || cut >= messages.length) return false;
  return (messages[cut - 1].toolCalls?.length ?? 0) > 0 || (messages[cut].toolResults?.length ?? 0) > 0;
}

describe("the cut point", () => {
  it("never separates a tool call from its result, over 2,000 generated transcripts", async () => {
    const { findCutIndex, isClientTurnStart } = await import("@/agent/lib/compaction");
    const random = prng(20261007);
    let cutsMade = 0;
    for (let n = 0; n < 2_000; n += 1) {
      const messages = generatedTranscript(random);
      const keep = 1 + Math.floor(random() * 3);
      const cut = findCutIndex(messages, keep);
      const turns = messages.filter(isClientTurnStart).length;
      expect(splitsAPair(messages, cut)).toBe(false);
      if (turns <= keep) {
        expect(cut).toBe(0);
      } else {
        cutsMade += 1;
        // The latest `keep` turns are all kept, and the kept part starts a turn.
        expect(messages.slice(cut).filter(isClientTurnStart)).toHaveLength(keep);
        expect(isClientTurnStart(messages[cut])).toBe(true);
      }
    }
    expect(cutsMade).toBeGreaterThan(500);
  });

  it("walks back from a cut that would land between a call and its result", async () => {
    const { findCutIndex } = await import("@/agent/lib/compaction");
    const messages: ModelMessage[] = [
      { role: "user", content: "first" },
      { role: "assistant", content: "one" },
      ...readPair(1),
      { role: "user", content: "second" },
    ];
    // Turn starts are only where the caller says: here, at the tool result.
    const cut = findCutIndex(messages, 1, (_message, index) => index === 3);
    expect(cut).toBe(2);
    expect(splitsAPair(messages, cut)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Step 2, through the route
// ---------------------------------------------------------------------------

describe("step 2: a long session is summarised before the reply", () => {
  it("a short session is never compacted: no summary call, no summary written", async () => {
    // Five turns: enough to summarise, too short to need it.
    state.prior = conversation(5, 2_000);

    const stream = await turn();

    expect(summaryCalls()).toHaveLength(0);
    expect(state.puts).toEqual([]);
    expect(stream.at(-1)).toEqual({ type: "turn.end" });
    expect(text(mainCalls()[0].messages)).toContain(NO_EXCLAMATIONS);
    expect(text(mainCalls()[0].messages)).toContain("Turn 2: make it a little warmer.");
  });

  it("carries an instruction from the MIDDLE of a long session verbatim, as a <client-message> (review focus 4)", async () => {
    state.prior = conversation(12);

    await turn();

    // One summary call, on Haiku, before the reply.
    expect(state.requests.map((request) => request.model ?? OPUS)).toEqual([HAIKU, OPUS]);
    expect(summaryCalls()[0].system).toContain("Rejected options");
    // Haiku is shown the client's words as context only; nothing is marked for excerpting.
    expect(text(summaryCalls()[0].messages)).toContain(`from="client">${MIDDLE_INSTRUCTION}</message>`);
    expect(text(summaryCalls()[0].messages)).not.toContain('overflow="true"');
    expect(state.puts).toHaveLength(1);
    const put = state.puts[0];
    expect(put.expected_revision).toBeNull();
    // The client's words are carried from the conversation, not stored as picks.
    expect(put.client_excerpts_verbatim).toBe("");
    expect(put.excerpts_through_message_id).toBeNull();
    // The older turns were summarised: the cut keeps the latest three.
    expect(put.covers_through_message_id).toBe("a9");
    const sent = mainCalls()[0].messages;
    // Turn 4's message reaches the model exactly as the transcript renders it.
    expect(sent.filter((message) => message.content.includes(NO_EXCLAMATIONS)).map((message) => message.content)).toEqual([
      `<client-message handle="U7">${MIDDLE_INSTRUCTION}</client-message>`,
    ]);
    const all = text(sent);
    expect(all).toContain("<session-summary");
    expect(all).not.toContain("Draft 4.");
    expect(all).not.toContain("Draft 9.");
    expect(all).toContain("Turn 9: make it a little warmer.");
    for (const kept of ["Turn 10:", "Turn 11:", "Turn 12:", "Draft 12."]) expect(all).toContain(kept);
    expect(all).toContain("Shorter, please.");

    // The next turn: the stored summary, the carried client messages and the
    // verbatim recent turns, with no new call.
    state.requests = [];
    state.prior = [
      ...conversation(12),
      { id: "c13", role: "user", kind: "task", body: "Shorter, please.", command_kind: null, handle: "U25" },
      { id: "a13", role: "assistant", kind: "agent", body: "Here is the revised draft.", command_kind: null, handle: null },
    ];

    await turn("c4", "Now a closing line.");

    expect(summaryCalls()).toHaveLength(0);
    const next = mainCalls()[0].messages.map((message) => message.content);
    expect(next).toContain(`<client-message handle="U7">${MIDDLE_INSTRUCTION}</client-message>`);
    expect(next.join("\n")).toContain("Brief: a LinkedIn post about the new opening hours.");
    expect(next.join("\n")).not.toContain("Draft 9.");
    expect(next.join("\n")).toContain("Draft 12.");
  });

  it("carries a later reversal too, after the instruction it reverses", async () => {
    state.prior = conversation(12, 9_000, { 4: MIDDLE_INSTRUCTION, 7: REVERSAL });

    await turn();

    expect(summaryCalls()).toHaveLength(1);
    const sent = mainCalls()[0].messages.map((message) => message.content);
    const original = sent.indexOf(`<client-message handle="U7">${MIDDLE_INSTRUCTION}</client-message>`);
    const reversal = sent.indexOf(`<client-message handle="U13">${REVERSAL}</client-message>`);
    expect(original).toBeGreaterThan(0);
    expect(reversal).toBeGreaterThan(original);
  });

  it("past the carry budget, keeps the newest client messages whole and excerpts only the oldest, in a marked block", async () => {
    const { CLIENT_CARRY_BUDGET_CHARS } = await import("@/agent/lib/compaction");
    expect(CLIENT_CARRY_BUDGET_CHARS).toBe(42_000);
    // Thirty turns of long client messages: 27 older ones of ~3,000 characters
    // each are well past the 42,000-character budget.
    const filler = "Here is more about the business and its customers. ".repeat(58);
    const rows: TranscriptMessage[] = [];
    for (let t = 1; t <= 30; t += 1) {
      const body = t === 2 ? `MARK-${t}: Please ${NO_EXCLAMATIONS}. ${filler}` : `MARK-${t}: ${filler}`;
      rows.push({ id: `c${t}`, role: "user", kind: "task", body, command_kind: null, handle: `U${2 * t - 1}` });
      rows.push({ id: `a${t}`, role: "assistant", kind: "agent", body: `Draft ${t}. ${"x ".repeat(250)}`, command_kind: null, handle: null });
    }
    state.prior = rows;
    state.respond = ((request: DriverRequest) => {
      if (request.model !== HAIKU) return reply();
      const n = /<message n="(\d+)" from="client" overflow="true">MARK-2:/.exec(request.messages[0].content)?.[1];
      return summaryReply(
        `<summary>Brief.</summary><client-excerpts><excerpt message="${n}">Please ${NO_EXCLAMATIONS}.</excerpt></client-excerpts>`,
      );
    }) as never;

    await turn();

    const input = summaryCalls()[0].messages[0].content;
    const overflowCount = input.match(/overflow="true"/g)?.length ?? 0;
    expect(overflowCount).toBeGreaterThan(1);
    expect(overflowCount).toBeLessThan(27);
    expect(state.puts[0].client_excerpts_verbatim).toBe(`Please ${NO_EXCLAMATIONS}.`);
    expect(state.puts[0].excerpts_through_message_id).toBe(`c${overflowCount}`);
    const sent = text(mainCalls()[0].messages);
    expect(sent).toContain(`<client-message excerpt="true">Please ${NO_EXCLAMATIONS}.</client-message>`);
    expect(sent).toContain("too long to repeat in full");
    // The oldest are excerpted, not carried; the newest older ones are whole.
    for (const t of [1, 2, overflowCount]) expect(sent).not.toContain(`MARK-${t}:`);
    for (const t of [overflowCount + 1, 27]) expect(sent).toContain(`MARK-${t}: ${filler}`);

    // The next turn pays for no summary: the excerpts are stored, and the
    // client text over budget is not re-summarised every turn.
    state.requests = [];
    state.prior = [
      ...rows,
      { id: "c31", role: "user", kind: "task", body: "Shorter, please.", command_kind: null, handle: "U61" },
      { id: "a31", role: "assistant", kind: "agent", body: "Here is the revised draft.", command_kind: null, handle: null },
    ];

    await turn("c4", "Now a closing line.");

    expect(summaryCalls()).toHaveLength(0);
    const next = text(mainCalls()[0].messages);
    expect(next).toContain(`<client-message excerpt="true">Please ${NO_EXCLAMATIONS}.</client-message>`);
    expect(next).not.toContain("MARK-2:");
    expect(next).toContain(`MARK-${overflowCount + 1}: ${filler}`);
  });

  it("copies an overflow message whole when the excerpt is not verbatim, and ignores picks from carried messages", async () => {
    const { parseSummaryReply } = await import("@/agent/lib/compaction");
    const entry = (id: string, body: string) => ({
      row: { id, role: "user", kind: "task", body, command_kind: null, handle: null },
      message: { role: "user" as const, content: body },
    });
    const items = [
      { entry: entry("c1", "Keep it short. No emojis, please."), overflow: true },
      { entry: entry("c2", "Mention the open day."), overflow: false },
    ];

    const parsed = parseSummaryReply(
      '<summary>Brief.</summary><client-excerpts><excerpt message="1">No emojis please</excerpt>' +
        '<excerpt message="2">Mention the open day.</excerpt></client-excerpts>',
      items,
    );

    expect(parsed).toEqual({ summary: "Brief.", excerpts: ["Keep it short. No emojis, please."] });
  });

  it("A45: a summary failure still completes the reply with the hard cap, and writes no summary", async () => {
    const { boundTranscript } = await import("@/agent/lib/transcript-bound");
    const { assembleTranscript } = await import("@/agent/transcript");
    state.prior = conversation(24);
    state.respond = ((request: DriverRequest) => {
      if (request.model === HAIKU) throw new Error("summary provider down");
      return reply(usage(1_000), "Here it is.");
    }) as never;

    const stream = await turn();

    expect(summaryCalls()).toHaveLength(1);
    expect(state.puts).toEqual([]);
    expect(stream.filter((event) => event.type === "terminal")).toEqual([]);
    expect(stream.filter((event) => event.type === "message.delta" || event.type === "turn.end").at(-1)).toEqual({
      type: "turn.end",
    });
    // What the model got is exactly the hard cap over the whole conversation.
    const expected = boundTranscript(assembleTranscript(conversation(24))).messages;
    expect(expected.some((message) => message.content.includes("are not shown to you"))).toBe(true);
    const sent = mainCalls()[0].messages;
    for (const message of expected) expect(sent.map((m) => m.content)).toContain(message.content);
    // A call that threw may have been billed: the turn settles uncertain.
    expect(state.settles.at(-1)?.outcome).toBe("uncertain");
  });

  it("settles normally at the real passes when the summary failure was certainly not billed", async () => {
    state.prior = conversation(24);
    state.respond = ((request: DriverRequest) => {
      // What the c4 driver throws when its retries end on a 429/529/refused connection.
      if (request.model === HAIKU) throw markCertainlyUnbilled(new Error("overloaded, retries exhausted"));
      return reply(usage(1_000), "Here it is.");
    }) as never;

    const stream = await turn();

    expect(summaryCalls()).toHaveLength(1);
    expect(state.puts).toEqual([]);
    expect(stream.filter((event) => event.type === "terminal")).toEqual([]);
    // Only the Opus pass is charged: 1,000 x $5/M + 100 x $25/M = 7,500.
    expect(state.settles.at(-1)).toMatchObject({ outcome: "settled", actual_microdollars: 7_500 });
  });

  it("counts the summary call's usage in the turn's settled cost, at Haiku rates", async () => {
    state.prior = conversation(12);
    state.respond = ((request: DriverRequest) =>
      request.model === HAIKU ? summaryReply(GOOD_SUMMARY, usage(30_000, 500)) : reply(usage(20_000, 400))) as never;

    await turn();

    // Haiku: 30,000 x $1/M + 500 x $5/M = 32,500. Opus: 20,000 x $5/M + 400 x $25/M = 110,000.
    const settle = state.settles.at(-1)!;
    expect(settle.outcome).toBe("settled");
    expect(settle.actual_microdollars).toBe(32_500 + 110_000);
    expect((settle.usage as Record<string, number>).inputTokens).toBe(50_000);
    // And per model, so a reconciler can price each at its own rates.
    expect((settle.usage as Record<string, unknown>).by_model).toEqual({
      [HAIKU]: usage(30_000, 500),
      [OPUS]: usage(20_000, 400),
    });
  });

  it("counts the summary's cost against the same per-reply cap", async () => {
    const { REPLY_CAP_EXPLANATION } = await import("@/agent/bounds");
    state.prior = conversation(12);
    // A summary that cost the whole US$1 cap (1,000,000 Haiku input tokens).
    state.respond = ((request: DriverRequest) =>
      request.model === HAIKU ? summaryReply(GOOD_SUMMARY, usage(1_000_000, 0)) : reply()) as never;

    const stream = await turn();

    // The reply's first agent call is never sent: the cap is already reached.
    expect(mainCalls()).toHaveLength(0);
    expect(stream.filter((event) => event.type === "terminal")).toEqual([
      { type: "terminal", outcome: "held", explanation: REPLY_CAP_EXPLANATION },
    ]);
    expect(state.settles.at(-1)).toMatchObject({ outcome: "settled", actual_microdollars: 1_000_000 });
  });

  it("backs off after a failed summary: no paid attempt until the client has sent 3 more messages (M-5)", async () => {
    const { boundTranscript } = await import("@/agent/lib/transcript-bound");
    const { assembleTranscript } = await import("@/agent/transcript");
    let failing = true;
    state.respond = ((request: DriverRequest) => {
      if (request.model === HAIKU) {
        if (failing) throw new Error("summary provider down");
        return summaryReply(GOOD_SUMMARY);
      }
      return reply();
    }) as never;

    // The failure is recorded at 24 client messages.
    state.prior = conversation(24);
    await turn();
    expect(summaryCalls()).toHaveLength(1);
    expect(state.failures).toEqual([{ failed_at_client_messages: 24, reason: "summary_failed" }]);

    // Two more client messages later: still backing off, no call, the hard cap.
    for (const turns of [25, 26]) {
      state.requests = [];
      state.prior = conversation(turns);
      const stream = await turn();
      expect(summaryCalls()).toHaveLength(0);
      expect(stream.filter((event) => event.type === "terminal")).toEqual([]);
      const expected = boundTranscript(assembleTranscript(conversation(turns))).messages.map((m) => m.content);
      const sent = mainCalls()[0].messages.map((m) => m.content);
      for (const content of expected) expect(sent).toContain(content);
    }
    expect(state.failures).toHaveLength(1);

    // Three more: it tries again, succeeds, and the marker is cleared.
    failing = false;
    state.requests = [];
    state.prior = conversation(27);
    await turn();
    expect(summaryCalls()).toHaveLength(1);
    expect(state.puts).toHaveLength(1);
    expect(state.backoff).toBeNull();
  });

  it("doubles the wait with each consecutive failure, up to 24 client messages", async () => {
    const { summaryBackoffMessages } = await import("@/agent/lib/compaction");
    expect([1, 2, 3, 4, 5, 50].map(summaryBackoffMessages)).toEqual([3, 6, 12, 24, 24, 24]);
  });

  it("never runs under M1", async () => {
    state.prior = conversation(24);

    await turn("context.v1");

    expect(summaryCalls()).toHaveLength(0);
    expect(state.puts).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The thresholds agree (Ruling 62)
// ---------------------------------------------------------------------------

describe("the new-post notice measures what the next turn carries (P4.6, review I-1)", () => {
  /** A first reply that reads twice. Each pass reports what a provider would:
   *  its input grows with every read result, which is never carried forward. */
  function readingReply(firstInput: number, laterInputs: [number, number]) {
    let pass = 0;
    return ((request: DriverRequest) => {
      if (request.model === HAIKU) return summaryReply(GOOD_SUMMARY);
      pass += 1;
      if (pass <= 2) {
        return {
          text: "",
          toolCalls: [
            { id: `toolu_${pass}`, name: "read_knowledge", input: { selector: "find", purpose: "research", query: "opening hours" } },
          ],
          stopReason: "tool_use",
          usage: usage(pass === 1 ? firstInput : laterInputs[0]),
          model: OPUS,
        } satisfies TurnResult;
      }
      return reply(usage(laterInputs[1]));
    }) as never;
  }

  it("a read-heavy FIRST reply does not suggest a new post", async () => {
    // First call 12,000 (the fixed prompt and the client's message); the reads
    // take the later calls to 40,000 and 46,000, over the 32,000 notice line.
    state.respond = readingReply(12_000, [40_000, 46_000]);

    const stream = await turn();

    expect(state.reads).toBe(2);
    expect(mainCalls()).toHaveLength(3);
    expect(stream.map((event) => event.type)).not.toContain("session.long");
  });

  it("a long session still does, whatever this reply reads", async () => {
    state.prior = conversation(5, 2_000);
    // The carried conversation already measures 33,000 on the first call.
    state.respond = readingReply(33_000, [40_000, 46_000]);

    const stream = await turn();

    expect(summaryCalls()).toHaveLength(0);
    expect(stream.filter((event) => event.type === "session.long")).toHaveLength(1);
    expect(stream.slice(-2)).toEqual([{ type: "session.long" }, { type: "turn.end" }]);
  });
});

describe("the thresholds agree", () => {
  it("compaction fires before the hard cap would cut, for every c4 profile's real prompts", async () => {
    const { COMPACTION_INPUT_TOKENS, estimateSessionTokens } = await import("@/agent/lib/compaction");
    const { MAX_TRANSCRIPT_CHARS } = await import("@/agent/lib/transcript-bound");
    const { instructionsFor } = await import("@/agent/capabilities");
    const { buildSystemBlocks } = await import("@/agent/lib/context-assembly");
    const { buildToolSpecs } = await import("@/agent/lib/tool-schemas");
    const { requestChars } = await import("@/agent/lib/reply-cap");
    const { PROFILES } = await import("@/agent/profile");
    const instructions = fs.readFileSync(path.join(process.cwd(), "src/agent/instructions.md"), "utf8");
    const c4 = Object.values(PROFILES).filter((profile) => profile.contract === "c4");
    expect(c4.length).toBeGreaterThan(0);
    for (const profile of c4) {
      const skill = fs.readFileSync(path.join(process.cwd(), "src/agent/skills", profile.skill, "SKILL.md"), "utf8");
      const fixed = requestChars(
        buildSystemBlocks(instructionsFor(instructions, profile), skill),
        [],
        buildToolSpecs(profile.tools, profile.contract),
      );
      // A conversation exactly at the hard cap already puts the request over the threshold.
      expect(estimateSessionTokens(fixed + MAX_TRANSCRIPT_CHARS)).toBeGreaterThan(COMPACTION_INPUT_TOKENS);
    }
  });

  it("a realistic long session reaches the new-post notice, then compaction, and the hard cap never cuts first", async () => {
    const { requestChars } = await import("@/agent/lib/reply-cap");
    // The stub reports what a provider would: input measured at four
    // characters per token, the typical English rate, all of it reported.
    state.respond = ((request: DriverRequest) => {
      const input = Math.ceil(requestChars(request.system, request.messages, request.tools) / 4);
      return request.model === HAIKU ? summaryReply(GOOD_SUMMARY, usage(input, 500)) : reply(usage(input, 400));
    }) as never;

    const rows: TranscriptMessage[] = [];
    let noticeAt: number | null = null;
    let compactedAt: number | null = null;
    for (let t = 1; t <= 40 && compactedAt === null; t += 1) {
      state.prior = [...rows];
      state.requests = [];
      const stream = await turn("c4", `Turn ${t}.`);
      const sent = text(mainCalls()[0].messages);
      if (summaryCalls().length > 0) compactedAt = t;
      // Until compaction runs, the hard cap has not had to cut.
      if (compactedAt === null) expect(sent).not.toContain("are not shown to you");
      if (noticeAt === null && stream.some((event) => event.type === "session.long")) noticeAt = t;
      const exchange = conversation(1, 8_000);
      rows.push(
        { ...exchange[0], id: `c${t}`, body: `${exchange[0].body} (${t})` },
        { ...exchange[1], id: `a${t}`, body: `${exchange[1].body} (${t})` },
      );
    }

    expect(noticeAt).not.toBeNull();
    expect(compactedAt).not.toBeNull();
    expect(noticeAt!).toBeLessThan(compactedAt!);
  });
});

// ---------------------------------------------------------------------------
// The provider call itself
// ---------------------------------------------------------------------------

describe("the summary call on the real driver", () => {
  it("runs on Haiku 4.5 without thinking, effort or tools, and reports its model; the agent's call is unchanged", async () => {
    const { createAnthropicDriver, MAX_TOKENS } = await vi.importActual<typeof import("@/agent/lib/loop")>(
      "@/agent/lib/loop",
    );
    const sent: Array<Record<string, unknown>> = [];
    const client = () => ({
      withOptions: () => ({
        messages: {
          stream: (params: unknown) => {
            sent.push(params as Record<string, unknown>);
            return {
              on: () => undefined,
              finalMessage: async () => ({
                content: [{ type: "text", text: "<summary>x</summary>" }],
                stop_reason: "end_turn",
                usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
              }),
            };
          },
        },
      }),
    });
    const driver = createAnthropicDriver({ retry: "unbilled_only", client: client as never });
    const base = {
      system: [{ text: "s", cache: false }],
      messages: [{ role: "user" as const, content: "m" }],
      tools: [],
      onText: () => {},
      timeoutMs: 60_000,
    };

    const summary = await driver.runTurn({ ...base, model: HAIKU, maxTokens: 2_048 });
    const agent = await driver.runTurn(base);

    expect(summary.model).toBe(HAIKU);
    expect(sent[0].model).toBe(HAIKU);
    expect(sent[0].max_tokens).toBe(2_048);
    expect(sent[0]).not.toHaveProperty("thinking");
    expect(sent[0]).not.toHaveProperty("output_config");
    expect(sent[0]).not.toHaveProperty("tools");
    // A one-off call is never resent, so it carries no cache marker (review M2).
    expect(JSON.stringify(sent[0].messages)).not.toContain("cache_control");
    expect(agent.model).toBe(OPUS);
    expect(sent[1]).toMatchObject({
      model: OPUS,
      max_tokens: MAX_TOKENS,
      thinking: { type: "adaptive" },
      output_config: { effort: "low" },
      tools: [],
    });
    expect(JSON.stringify(sent[1].messages)).toContain("cache_control");
    // A call can lower the output ceiling, never raise it.
    await driver.runTurn({ ...base, model: HAIKU, maxTokens: 100_000 });
    expect(sent[2].max_tokens).toBe(MAX_TOKENS);
  });
});

describe("a certainly-unbilled failure on the real driver", () => {
  it("is marked only when the retries end on a failure answered before any generation", async () => {
    const Anthropic = (await import("@anthropic-ai/sdk")).default;
    const { createAnthropicDriver } = await vi.importActual<typeof import("@/agent/lib/loop")>("@/agent/lib/loop");
    const { wasCertainlyUnbilled } = await import("@/agent/lib/call-billing");
    const failing = (error: () => Error) => () => ({
      withOptions: () => ({
        messages: {
          stream: () => ({
            on: () => undefined,
            finalMessage: async () => {
              throw error();
            },
          }),
        },
      }),
    });
    const base = {
      system: [],
      messages: [{ role: "user" as const, content: "m" }],
      tools: [],
      onText: () => {},
      timeoutMs: 60_000,
    };
    const overloaded = () =>
      Anthropic.APIError.generate(529, { type: "error", error: { type: "overloaded_error" } }, undefined, new Headers());
    const timeout = () => new Anthropic.APIConnectionTimeoutError();

    const unbilled = await createAnthropicDriver({ retry: "unbilled_only", client: failing(overloaded) as never, sleep: async () => {} })
      .runTurn(base)
      .catch((error: unknown) => error);
    const timedOut = await createAnthropicDriver({ retry: "unbilled_only", client: failing(timeout) as never, sleep: async () => {} })
      .runTurn(base)
      .catch((error: unknown) => error);

    expect(wasCertainlyUnbilled(unbilled)).toBe(true);
    // Still the provider's own error, so callers that test its type still can.
    expect(unbilled).toBeInstanceOf(Anthropic.APIError);
    expect(wasCertainlyUnbilled(timedOut)).toBe(false);
  });
});
