import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import type { Driver, TurnResult, TurnUsage } from "@/agent/lib/driver";
import { turnCostMicrodollars } from "@/agent/lib/pricing";
import { runAgentTurn, type ToolExecution } from "@/agent/lib/turn";
import { meterTurn } from "@/agent/lib/turn-settlement";

/**
 * How a C4 turn's reservation settles (Cycle 5, P1.4; spec 10A.1): from the
 * model calls the turn actually made, whatever way the turn ended.
 *
 *   no call dispatched                    -> cancelled_unsent (released)
 *   every dispatched call fully reported  -> settled at the priced sum, even if the turn then threw
 *   anything else                         -> uncertain (held for a human)
 */

const usage = (input: number, output: number, read = 0, write = 0): TurnUsage => ({
  inputTokens: input,
  outputTokens: output,
  cacheReadInputTokens: read,
  cacheCreationInputTokens: write,
});

const readPass = (id: string, passUsage: TurnUsage): TurnResult => ({
  text: "",
  toolCalls: [{ id, name: "read_knowledge", input: { selector: "find", query: id, purpose: "test" } }],
  stopReason: "tool_use",
  usage: passUsage,
});
const reply = (passUsage: TurnUsage): TurnResult => ({ text: "done", toolCalls: [], stopReason: "end_turn", usage: passUsage });

/** The stub driver pattern of `tests/agent/*`: a scripted list of passes. A
 *  script entry that is an Error is thrown by that call instead. */
function scripted(script: Array<TurnResult | Error>): Driver {
  let call = 0;
  return {
    toProviderTools: (tools) => tools,
    runTurn: async () => {
      const next = script[Math.min(call++, script.length - 1)];
      if (next instanceof Error) throw next;
      return next;
    },
  };
}

const ok = async (): Promise<ToolExecution> => ({ kind: "ok", result: {} });

/** A pass with no model id is priced at the runtime's default model, Opus 5 here. */
const opus = (passUsage: TurnUsage) => ({ model: "claude-opus-5", usage: passUsage });

describe("a C4 turn's settlement", () => {
  it("settles cancelled_unsent when the turn throws before any model call", async () => {
    const meter = meterTurn(scripted([reply(usage(1, 1))]));
    // What the route's try block does when something fails before the first
    // pass: the driver is never called.
    const turn = async () => {
      throw new Error("failed before the first model call");
    };
    await expect(turn()).rejects.toThrow();

    expect(meter.settlement()).toEqual({ outcome: "cancelled_unsent" });
  });

  it("settles at the sum when two fully reported passes complete and the turn then throws", async () => {
    const first = usage(100, 20, 900, 50);
    const second = usage(40, 10, 950, 0);
    const meter = meterTurn(scripted([readPass("r1", first), readPass("r2", second), reply(usage(1, 1))]));
    let calls = 0;
    const executor = async (): Promise<ToolExecution> => {
      calls += 1;
      if (calls === 2) throw new Error("tool dispatch failed after the second pass");
      return { kind: "ok", result: {} };
    };

    await expect(runAgentTurn({ driver: meter.driver, executor })).rejects.toThrow();

    const sum = usage(140, 30, 1850, 50);
    expect(meter.usage()).toEqual(sum);
    // CHANGED FORM (P1.5): priced pass by pass, each rounded up, then summed.
    const cost = turnCostMicrodollars([opus(first), opus(second)]);
    expect(meter.settlement()).toEqual({ outcome: "settled", actualMicrodollars: cost });
    expect(cost).toBeGreaterThan(0);
  });

  it("settles uncertain when one pass is missing a usage field", async () => {
    const missing = { ...usage(30, 5, 0, 0), cacheCreationInputTokens: null };
    const meter = meterTurn(scripted([readPass("r1", usage(100, 20)), reply(missing)]));

    await runAgentTurn({ driver: meter.driver, executor: ok });

    expect(meter.settlement()).toEqual({ outcome: "uncertain" });
  });

  it("settles at cost when a turn completes with every pass fully reported", async () => {
    const meter = meterTurn(scripted([readPass("r1", usage(100, 20)), reply(usage(10, 5))]));

    await runAgentTurn({ driver: meter.driver, executor: ok });

    expect(meter.settlement()).toEqual({
      outcome: "settled",
      actualMicrodollars: turnCostMicrodollars([opus(usage(100, 20)), opus(usage(10, 5))]),
    });
  });

  it("settles uncertain when a model call throws, because it may have reached the provider", async () => {
    const meter = meterTurn(scripted([readPass("r1", usage(100, 20)), new Error("provider timed out")]));

    await expect(runAgentTurn({ driver: meter.driver, executor: ok })).rejects.toThrow();

    expect(meter.settlement()).toEqual({ outcome: "uncertain" });
  });

  it("settles uncertain when the very first model call throws", async () => {
    const meter = meterTurn(scripted([new Error("provider timed out")]));

    await expect(runAgentTurn({ driver: meter.driver, executor: ok })).rejects.toThrow();

    expect(meter.settlement()).toEqual({ outcome: "uncertain" });
  });

  it("treats a usage figure that is not a number as missing", async () => {
    const odd = { ...usage(1, 1), outputTokens: undefined } as unknown as TurnUsage;
    const meter = meterTurn(scripted([reply(odd)]));

    await runAgentTurn({ driver: meter.driver, executor: ok });

    expect(meter.settlement()).toEqual({ outcome: "uncertain" });
  });

  it("prices each pass at the model it ran on (P1.5)", async () => {
    // 1,000 input + 100 output: 7,500 on Opus 5, 1,500 on Haiku 4.5.
    const haikuRead = { ...readPass("r1", usage(1_000, 100)), model: "claude-haiku-4-5-20251001" };
    const opusReply = { ...reply(usage(1_000, 100)), model: "claude-opus-5" };
    const meter = meterTurn(scripted([haikuRead, opusReply]));

    await runAgentTurn({ driver: meter.driver, executor: ok });

    expect(meter.settlement()).toEqual({ outcome: "settled", actualMicrodollars: 9_000 });
  });

  it("prices with the reservation's prices when it has them (P1.5)", async () => {
    const given = { "claude-opus-5": { input: 2_000_000, cache_write_5m: 0, cache_read: 0, output: 0 } };
    const meter = meterTurn(scripted([{ ...reply(usage(1_000_000, 0)), model: "claude-opus-5" }]), undefined, () => given);

    await runAgentTurn({ driver: meter.driver, executor: ok });

    expect(meter.settlement()).toEqual({ outcome: "settled", actualMicrodollars: 2_000_000 });
  });

  it("hands each completed pass to the observer", async () => {
    const seen: string[] = [];
    const meter = meterTurn(scripted([readPass("r1", usage(1, 1)), reply(usage(1, 1))]), (result) => seen.push(result.stopReason));

    await runAgentTurn({ driver: meter.driver, executor: ok });

    expect(seen).toEqual(["tool_use", "end_turn"]);
  });
});

describe("the route settles from the meter on every outcome", () => {
  // Read from source, the convention this suite uses for the route: it has no
  // seam a unit test can drive, so the decision lives in `turn-settlement.ts`.
  const route = fs.readFileSync(
    path.join(process.cwd(), "src/app/api/client/chat/sessions/[sessionId]/agent/route.ts"),
    "utf8",
  );

  it("runs the turn on the metered driver", () => {
    expect(route).toMatch(/const meter = meterTurn\(selectedDriver,/);
    expect(route).toContain("driver: meter.driver,");
  });

  // CHANGED FORM, same property (Cycle 5, P5.2, Ruling 68): reserve, settle
  // and their finally block moved, unchanged, into `metered-operation.ts`,
  // shared by the route and the voice preview. The route hands it its meter.
  const operation = fs.readFileSync(path.join(process.cwd(), "src/agent/lib/metered-operation.ts"), "utf8");

  it("chooses the outcome in the finally block, from the meter", () => {
    expect(route).toMatch(/await runMeteredOperation\(\{[\s\S]*?\bmeter,/);
    const finallyBlock = operation.slice(operation.indexOf("} finally {"));
    expect(finallyBlock).toContain("const settlement = options.meter.settlement();");
    expect(finallyBlock).toContain("outcome: settlement.outcome,");
    expect(finallyBlock).toMatch(
      /settlement\.outcome === "settled"\s*\?\s*\{ actual_microdollars: settlement\.actualMicrodollars \}/,
    );
  });

  it("sends usage on every outcome", () => {
    // P4.3 fix round 1: the summed usage plus a per-model split (a turn can
    // have a Haiku summary pass beside its Opus passes).
    expect(operation).toContain("usage: { ...options.meter.usage(), by_model: options.meter.usageByModel() },");
  });
});
