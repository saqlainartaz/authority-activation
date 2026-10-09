import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { shouldStop, type TurnState } from "@/agent/bounds";
import type { Driver, DriverRequest, TurnResult, TurnUsage } from "@/agent/lib/driver";
import { MAX_TOKENS } from "@/agent/lib/loop";
import { turnCostMicrodollars } from "@/agent/lib/pricing";
import {
  REPLY_CAP_EXPLANATION,
  estimateCallInputTokens,
  replyBoundsFromReservation,
} from "@/agent/lib/reply-cap";
import { runAgentTurn, type RunTurnOptions, type ToolExecution } from "@/agent/lib/turn";

import { RESERVE_RESPONSE } from "./support/reserve-response";

/**
 * A writing reply stops at its per-reply cap, and never sends a call larger
 * than the per-call input bound (Cycle 5, P1.5; spec 10A.2). Both bounds come
 * from the reservation, which is the cap plus one call's worst case: the agent
 * checks the cost between calls, so one call may start just under the cap.
 *
 * Only a C4 reply has a reservation. The M1 (`context.v1`) path is unchanged.
 */

const usage = (input: number, output = 0, read = 0, write = 0): TurnUsage => ({
  inputTokens: input,
  outputTokens: output,
  cacheReadInputTokens: read,
  cacheCreationInputTokens: write,
});

/** A read pass on Opus 5. 80,000 fresh input tokens at US$5/M = 400,000 microdollars. */
const readPass = (id: string, passUsage: TurnUsage, model = "claude-opus-5"): TurnResult => ({
  text: "",
  toolCalls: [{ id, name: "read_knowledge", input: { selector: "find", query: id, purpose: "test" } }],
  stopReason: "tool_use",
  usage: passUsage,
  model,
});
const submitPass = (id: string, passUsage: TurnUsage): TurnResult => ({
  text: "",
  toolCalls: [{ id, name: "submit_draft", input: { body: id, cited_atom_ids: [], agent_text: "" } }],
  stopReason: "tool_use",
  usage: passUsage,
  model: "claude-opus-5",
});
const reply = (passUsage: TurnUsage): TurnResult => ({
  text: "done",
  toolCalls: [],
  stopReason: "end_turn",
  usage: passUsage,
  model: "claude-opus-5",
});

/** The stub driver of `tests/agent/*`: scripted passes, and every request it was sent. */
function scripted(script: TurnResult[]): Driver & { sent: DriverRequest[] } {
  const sent: DriverRequest[] = [];
  return {
    sent,
    toProviderTools: (tools) => tools,
    runTurn: async (request) => {
      sent.push(request);
      return script[Math.min(sent.length - 1, script.length - 1)];
    },
  };
}

const ok = async (): Promise<ToolExecution> => ({ kind: "ok", result: {} });

/** What the route passes for a C4 reply: the bounds from its reservation. */
function c4(options: RunTurnOptions): RunTurnOptions {
  const bounds = replyBoundsFromReservation(RESERVE_RESPONSE);
  if (bounds === null) throw new Error("the fixture must parse");
  return { ...options, limits: bounds.limits, prices: bounds.prices };
}

const PASS_400K = usage(80_000);

describe("the per-reply cap", () => {
  it("stops after the third pass when each costs about 400,000, below the reservation", async () => {
    const script = [1, 2, 3, 4, 5].map((n) => readPass(`r${n}`, PASS_400K));
    const driver = scripted([...script, reply(usage(10))]);

    const outcome = await runAgentTurn(c4({ driver, executor: ok }));

    // 3 x 400,000 = 1,200,000 >= the 1,000,000 cap: no fourth call.
    expect(driver.sent).toHaveLength(3);
    const spent = turnCostMicrodollars(outcome.trace.passes.map((pass) => ({ model: "claude-opus-5", usage: pass.usage })));
    expect(spent).toBe(1_200_000);
    expect(spent).toBeLessThan(RESERVE_RESPONSE.reserved_microdollars);
    expect(outcome.trace.end).toEqual({ kind: "limit", reason: "reply_cap" });
    expect(outcome.events).toContainEqual({ type: "terminal", outcome: "held", explanation: REPLY_CAP_EXPLANATION });
  });

  it("leaves a reply costing about 300,000 alone", async () => {
    const driver = scripted([readPass("r1", usage(30_000)), readPass("r2", usage(30_000)), reply(usage(10))]);

    const outcome = await runAgentTurn(c4({ driver, executor: ok }));

    expect(driver.sent).toHaveLength(3);
    expect(outcome.trace.end).toEqual({ kind: "reply", reason: null });
    expect(outcome.events.some((event) => event.type === "terminal")).toBe(false);
  });

  it("ends normally when a draft was already submitted in this reply", async () => {
    const driver = scripted([
      submitPass("s1", PASS_400K),
      readPass("r1", PASS_400K),
      readPass("r2", PASS_400K),
      readPass("r3", PASS_400K),
      reply(usage(10)),
    ]);
    const executor = async (name: string): Promise<ToolExecution> =>
      name === "submit_draft"
        ? { kind: "ok", result: { outcome: "verified" }, runtime: { variantId: "v-1" } }
        : { kind: "ok", result: {} };

    const outcome = await runAgentTurn(c4({ driver, executor }));

    expect(driver.sent).toHaveLength(3);
    expect(outcome.events).toContainEqual({ type: "draft.ready", variant_id: "v-1" });
    expect(outcome.events.some((event) => event.type === "terminal")).toBe(false);
    expect(outcome.events.at(-1)).toEqual({ type: "turn.end" });
    expect(outcome.trace.end).toEqual({ kind: "limit", reason: "reply_cap" });
  });

  it("stops when a pass's cost is unknown, because the cap can no longer be shown to hold", async () => {
    const missing = { ...usage(10), cacheCreationInputTokens: null };
    const driver = scripted([readPass("r1", missing), readPass("r2", usage(10)), reply(usage(10))]);

    const outcome = await runAgentTurn(c4({ driver, executor: ok }));

    expect(driver.sent).toHaveLength(1);
    expect(outcome.trace.end).toEqual({ kind: "limit", reason: "reply_cap" });
  });

  it("prices each pass at its own model while it runs", async () => {
    // 40,000 output tokens: US$1.00 on Opus 5, US$0.20 on Haiku 4.5. Four Haiku
    // passes are 800,000, under the cap; priced as Opus they would stop at one.
    const haiku = (id: string) => readPass(id, usage(0, 40_000), "claude-haiku-4-5-20251001");
    const driver = scripted([haiku("h1"), haiku("h2"), haiku("h3"), haiku("h4"), reply(usage(10))]);

    const outcome = await runAgentTurn(c4({ driver, executor: ok }));

    expect(driver.sent).toHaveLength(5);
    expect(outcome.trace.end).toEqual({ kind: "reply", reason: null });
  });

  it("does not apply on the M1 path, which has no reservation", async () => {
    const script = [1, 2, 3, 4, 5].map((n) => readPass(`r${n}`, PASS_400K));
    const driver = scripted([...script, reply(usage(10))]);

    const outcome = await runAgentTurn({ driver, executor: ok });

    expect(driver.sent).toHaveLength(6);
    expect(outcome.trace.end).toEqual({ kind: "reply", reason: null });
  });
});

describe("the per-call input bound", () => {
  it("estimates a call as the last reported input plus new content at 3 characters a token, rounded up", () => {
    expect(estimateCallInputTokens(100_000, 3_001)).toBe(101_001);
    expect(estimateCallInputTokens(100_000, 0)).toBe(100_000);
    // Nothing reported yet: everything is new content.
    expect(estimateCallInputTokens(null, 9_000)).toBe(3_000);
  });

  it("never sends a pass whose estimated input exceeds 120,000 tokens, and says so", async () => {
    // 10,000 fresh + 100,000 cache-read reported, then a tool result of 31,000
    // characters: at least 110,000 + 10,334 > 120,000.
    const driver = scripted([readPass("r1", usage(10_000, 0, 100_000)), reply(usage(10))]);
    const executor = async (): Promise<ToolExecution> => ({ kind: "ok", result: { text: "x".repeat(31_000) } });

    const outcome = await runAgentTurn(c4({ driver, executor }));

    expect(driver.sent).toHaveLength(1);
    expect(outcome.trace.end).toEqual({ kind: "limit", reason: "call_input_cap" });
    expect(outcome.events).toContainEqual({ type: "terminal", outcome: "held", explanation: REPLY_CAP_EXPLANATION });
  });

  it("sends the same pass when the new content fits", async () => {
    const driver = scripted([readPass("r1", usage(10_000, 0, 100_000)), reply(usage(10))]);
    const executor = async (): Promise<ToolExecution> => ({ kind: "ok", result: { text: "x".repeat(3_000) } });

    const outcome = await runAgentTurn(c4({ driver, executor }));

    expect(driver.sent).toHaveLength(2);
    expect(outcome.trace.end).toEqual({ kind: "reply", reason: null });
  });

  it("counts everything as new content on the first call", async () => {
    const driver = scripted([reply(usage(10))]);
    const huge = [{ role: "user" as const, content: "x".repeat(400_000) }];

    const outcome = await runAgentTurn(c4({ driver, executor: ok, messages: huge }));

    expect(driver.sent).toHaveLength(0);
    expect(outcome.trace.end).toEqual({ kind: "limit", reason: "call_input_cap" });
  });
});

describe("shouldStop and the reply cap", () => {
  const state = (partial: Partial<TurnState> = {}): TurnState => ({
    toolCalls: 0,
    submitDraftCalls: 0,
    startedAt: 0,
    now: 1,
    ...partial,
  });

  it("stops once the running cost reaches the cap", () => {
    expect(shouldStop(state({ replyCostMicrodollars: 999_999 }), { maxReplyCostMicrodollars: 1_000_000 }).stop).toBe(false);
    const verdict = shouldStop(state({ replyCostMicrodollars: 1_000_000 }), { maxReplyCostMicrodollars: 1_000_000 });
    expect(verdict).toEqual({ stop: true, reason: "reply_cap", explanation: REPLY_CAP_EXPLANATION });
  });

  it("treats an unknown running cost as over the cap", () => {
    expect(shouldStop(state({ replyCostMicrodollars: null }), { maxReplyCostMicrodollars: 1_000_000 }).reason).toBe("reply_cap");
  });

  it("has no cap without one", () => {
    expect(shouldStop(state({ replyCostMicrodollars: 50_000_000 })).stop).toBe(false);
  });
});

describe("the reservation's bounds", () => {
  it("are read from the reserve response", () => {
    const bounds = replyBoundsFromReservation(RESERVE_RESPONSE);
    expect(bounds).not.toBeNull();
    expect(bounds?.limits).toEqual({ maxReplyCostMicrodollars: 1_000_000, maxCallInputTokens: 120_000 });
    expect(bounds?.maxCallOutputTokens).toBe(4_096);
    expect(bounds?.prices["claude-haiku-4-5-20251001"]).toEqual(RESERVE_RESPONSE.prices["claude-haiku-4-5-20251001"]);
  });

  it("are absent when the response carries none", () => {
    expect(replyBoundsFromReservation({ call_id: RESERVE_RESPONSE.call_id, reserved_microdollars: 1 })).toBeNull();
    expect(replyBoundsFromReservation({ ...RESERVE_RESPONSE, reply_cap_microdollars: "1000000" })).toBeNull();
  });

  it("are refused, never defaulted, when any part is missing or invalid (fix round 1, ruling 17)", () => {
    for (const malformed of [
      { ...RESERVE_RESPONSE, reply_cap_microdollars: 0 },
      { ...RESERVE_RESPONSE, reply_cap_microdollars: -1 },
      { ...RESERVE_RESPONSE, max_call_input_tokens: undefined },
      { ...RESERVE_RESPONSE, max_call_output_tokens: 0 },
      { ...RESERVE_RESPONSE, prices: undefined },
      { ...RESERVE_RESPONSE, prices: {} },
      { ...RESERVE_RESPONSE, prices: { "claude-opus-5": { input: 5_000_000 } } },
    ]) {
      expect(replyBoundsFromReservation(malformed)).toBeNull();
    }
  });

  it("use the response's prices when present", () => {
    const cheaper = { ...RESERVE_RESPONSE, prices: { "claude-opus-5": { input: 1, cache_write_5m: 1, cache_read: 1, output: 1 } } };
    expect(replyBoundsFromReservation(cheaper)?.prices["claude-opus-5"]).toEqual({ input: 1, cache_write_5m: 1, cache_read: 1, output: 1 });
  });

  it("assume the same output bound the agent sends: both sides change together", () => {
    // `MAX_TOKENS` (loop.ts) = the backend's `MAX_CALL_OUTPUT_TOKENS`, which the
    // backend's tests pin to 4,096. The reservation is derived from it.
    expect(MAX_TOKENS).toBe(RESERVE_RESPONSE.max_call_output_tokens);
  });
});

describe("the route applies the reservation's bounds", () => {
  const route = fs.readFileSync(
    path.join(process.cwd(), "src/app/api/client/chat/sessions/[sessionId]/agent/route.ts"),
    "utf8",
  );

  it("reads the bounds from the reserve response", () => {
    // CHANGED FORM (Cycle 5, P5.2, Ruling 68): read in the shared
    // `metered-operation.ts`, which hands the route the reservation.
    const operation = fs.readFileSync(path.join(process.cwd(), "src/agent/lib/metered-operation.ts"), "utf8");
    expect(operation).toContain("replyBoundsFromReservation(reserved)");
    expect(route).toContain("reservation = reserved;");
  });

  it("passes them to the turn, and nothing on the M1 path", () => {
    expect(route).toContain("limits: reservation?.bounds?.limits,");
    expect(route).toContain("prices: reservation?.bounds?.prices,");
  });

  it("settles with the reservation's prices", () => {
    expect(route).toMatch(/meterTurn\(\s*selectedDriver,[\s\S]*?\(\) => reservation\?\.bounds\?\.prices/);
  });
});
