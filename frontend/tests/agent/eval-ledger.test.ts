import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { DEFAULT_LIMITS } from "@/agent/bounds";
import { MAX_TOKENS } from "@/agent/lib/loop";

import { ledgerPath, reserve, spent, turnCost, turnWorstCase } from "./support/eval-ledger";

/** The paid runner's cap depends on these two, so they are tested without a paid call. */
const WORST = 2_000_000;
const complete = { inputTokens: 1_000, outputTokens: 100, cacheReadInputTokens: 10_000, cacheCreationInputTokens: 0 };

function ledger(rows: object[]): string {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "c4-ledger-")), "ledger.jsonl");
  fs.writeFileSync(file, rows.map((row) => JSON.stringify(row)).join("\n") + "\n");
  return file;
}

describe("the evaluation ledger", () => {
  it("counts a reserved turn that never settled at its worst case", () => {
    expect(spent(ledger([{ turn_id: "t1", phase: "reserved" }]), WORST)).toBe(WORST);
  });

  it("counts a settled turn at its actual cost, not its reservation", () => {
    expect(spent(ledger([{ turn_id: "t1", phase: "reserved" }, { turn_id: "t1", phase: "settled", cost_microdollars: 300_000 }]), WORST)).toBe(300_000);
  });

  it("counts a turn settled without a cost at its worst case", () => {
    expect(spent(ledger([{ turn_id: "t1", phase: "reserved" }, { turn_id: "t1", phase: "settled", cost_microdollars: null }]), WORST)).toBe(WORST);
  });

  it("charges nothing for rows that are not calls", () => {
    expect(spent(ledger([{ phase: "record", cost_microdollars: 9_999 }, { case: "cards", cost_microdollars: 0 }]), WORST)).toBe(0);
  });
});

describe("a turn's cost, pass by pass", () => {
  it("adds every pass", () => {
    expect(turnCost([{ usage: complete }, { usage: complete }])).toBe(2 * (1_000 * 5 + 100 * 25 + 10_000 * 0.5));
  });

  it("is unpriced when any pass missed a figure, never an undercount", () => {
    expect(turnCost([{ usage: complete }, { usage: { ...complete, cacheReadInputTokens: null } }])).toBeNull();
  });
});

describe("the evaluation's cap inputs (outside review pass 7)", () => {
  it("bounds a turn by every pass it may make, at full context and full output", () => {
    // 11 passes x (200,000 x $6.25/M + 4,096 x $25/M).
    expect(turnWorstCase(10, 4096, 200_000)).toBe(14_876_400);
  });

  it("covers the runtime's own limits: one more tool call raises it", () => {
    const now = turnWorstCase(DEFAULT_LIMITS.maxToolCalls, MAX_TOKENS, 200_000);
    expect(turnWorstCase(DEFAULT_LIMITS.maxToolCalls + 1, MAX_TOKENS, 200_000)).toBeGreaterThan(now);
    expect(now).toBeGreaterThan(2_000_000);
  });

  it("refuses to spend without the one named ledger", () => {
    expect(() => ledgerPath({})).toThrow(/C4_EVAL_LEDGER/);
    expect(ledgerPath({ C4_EVAL_LEDGER: "/x/ledger.jsonl" })).toBe("/x/ledger.jsonl");
  });
});

describe("reserving a turn (verification of outside review pass 7)", () => {
  it("writes the reservation only while the cap still holds, as one step", () => {
    const file = ledger([]);
    expect(reserve(file, { turn_id: "a" }, 15, 40)).toBe(true);
    expect(reserve(file, { turn_id: "b" }, 15, 40)).toBe(true);
    // 30 reserved: a third worst case would reach 45.
    expect(reserve(file, { turn_id: "c" }, 15, 40)).toBe(false);
    expect(spent(file, 15)).toBe(30);
    expect(fs.existsSync(`${file}.lock`)).toBe(false);
  });

  it("never reserves past a lock another runner holds", () => {
    const file = ledger([]);
    fs.writeFileSync(`${file}.lock`, "");
    expect(() => reserve(file, { turn_id: "a" }, 15, 40, 100)).toThrow(/ledger lock held/);
    expect(spent(file, 15)).toBe(0);
  });
});
