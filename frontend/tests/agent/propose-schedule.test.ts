import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/product", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/product")>();
  return { ...actual, proposeSchedule: vi.fn(), scheduleContentItem: vi.fn(), publishContentItemNow: vi.fn() };
});

const { proposeSchedule, scheduleContentItem } = await import("@/lib/product");
const { createExecutor } = await import("@/agent/lib/executor");
const { runAgentTurn } = await import("@/agent/lib/turn");

/**
 * `propose_schedule`: the agent proposes, and nothing it can do schedules.
 *
 * The model gets the time as the client will read it; the proposal's id goes
 * to the browser off the model-facing result, the way a draft's variant id
 * does, and the loop announces the card on the stream.
 */

const PROPOSAL = {
  id: "11111111-2222-4333-8444-555555555555",
  kind: "schedule" as const,
  status: "pending" as const,
  slot_at: "2026-10-03T08:00:00+00:00",
  slot_zone: "Europe/London",
  goes_out: "Saturday 3 October 2026, 09:00 (Europe/London)",
  when_local: "2026-10-03T09:00",
  proposed_goes_out: "Saturday 3 October 2026, 09:00 (Europe/London)",
  preview: "Membership costs 49 a month.",
  expires_at: "2026-10-03T08:00:00+00:00",
  delivery: { channel: "linkedin" as const, mode: "automatic" as const, line: "LinkedIn: goes out automatically" },
};

const NO_USAGE = { inputTokens: null, outputTokens: null, cacheReadInputTokens: null, cacheCreationInputTokens: null };

function executor(contract: "c4" | "context.v1" = "c4") {
  return createExecutor({
    sessionId: "44444444-4444-4444-8444-444444444444",
    turnId: "55555555-5555-4555-8555-555555555555",
    token: "token",
    getUsage: () => ({ inputTokens: 0, outputTokens: 0, cacheReadInputTokens: null, cacheCreationInputTokens: null }),
    skillVersions: [],
    contract,
    selectedVariantId: null,
  }).executor;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(proposeSchedule).mockResolvedValue(PROPOSAL);
});

describe("propose_schedule", () => {
  it("tells the model the time and pending, and never the proposal's id", async () => {
    const outcome = await executor()("propose_schedule", { when: "2026-10-03T09:00" });

    expect(outcome.kind).toBe("ok");
    const ok = outcome as { result: Record<string, unknown>; runtime?: { proposalId?: string } };
    expect(ok.result).toEqual({ status: "pending", goes_out: PROPOSAL.goes_out });
    expect(JSON.stringify(ok.result)).not.toContain(PROPOSAL.id);
    expect(ok.runtime?.proposalId).toBe(PROPOSAL.id);
  });

  it("sends the local time and a key derived from the turn, and nothing else", async () => {
    await executor()("propose_schedule", { when: "2026-10-03T09:00" });

    const [, sessionId, body] = vi.mocked(proposeSchedule).mock.calls[0];
    expect(sessionId).toBe("44444444-4444-4444-8444-444444444444");
    expect(Object.keys(body).sort()).toEqual(["idempotency_key", "when"]);
    expect((body as { when: string }).when).toBe("2026-10-03T09:00");
  });

  it("refuses a time with an offset: the zone is the client's, never the model's", async () => {
    const outcome = await executor()("propose_schedule", { when: "2026-10-03T09:00+02:00" });

    expect(outcome.kind).toBe("rejected");
    expect(proposeSchedule).not.toHaveBeenCalled();
  });

  it("announces the card on the stream, with the id and nothing more", async () => {
    const events: { type: string }[] = [];
    let call = 0;
    await runAgentTurn({
      driver: {
        toProviderTools: (tools) => tools,
        runTurn: async () =>
          call++ === 0
            ? { text: "", toolCalls: [{ id: "t1", name: "propose_schedule", input: {} }], stopReason: "tool_use", usage: NO_USAGE }
            : { text: "The card is ready.", toolCalls: [], stopReason: "end_turn", usage: NO_USAGE },
      },
      executor: async () => ({ kind: "ok", result: { status: "pending", goes_out: "x" }, runtime: { proposalId: "p1" } }),
      onEvent: (event) => events.push(event),
    });

    expect(events).toContainEqual({ type: "schedule.proposed", proposal_id: "p1" });
  });


  // Review 5, B1: c4 stopped ADVERTISING `schedule`, but the executor ran any
  // tool the code knew, so a model that returned the name anyway scheduled a
  // post with the client's token and no click.
  it("refuses a direct schedule under c4, whatever the model returns", async () => {
    const outcome = await executor()("schedule", {
      content_item_id: "66666666-6666-4666-8666-666666666666",
      when: "2026-10-03T09:00",
    });

    expect(outcome).toEqual({ kind: "failed", reason: "unknown tool schedule" });
    expect(scheduleContentItem).not.toHaveBeenCalled();
  });

  it("refuses a c4 tool under context.v1", async () => {
    const outcome = await executor("context.v1")("propose_schedule", { when: "2026-10-03T09:00" });

    expect(outcome).toEqual({ kind: "failed", reason: "unknown tool propose_schedule" });
    expect(proposeSchedule).not.toHaveBeenCalled();
  });

});

describe("propose_post_now", () => {
  const NOW = { ...PROPOSAL, id: "66666666-7777-4888-8999-000000000000", kind: "post_now" as const };

  it("asks the server for a post-now card, naming no time and no post", async () => {
    vi.mocked(proposeSchedule).mockResolvedValue(NOW);
    const outcome = await executor()("propose_post_now", {});

    const [, , body] = vi.mocked(proposeSchedule).mock.calls[0];
    expect(Object.keys(body).sort()).toEqual(["idempotency_key", "kind"]);
    expect((body as { kind: string }).kind).toBe("post_now");
    expect(outcome.kind).toBe("ok");
    const ok = outcome as { result: Record<string, unknown>; runtime?: { proposalId?: string } };
    // The model hears whether it will post itself, and never the card's id.
    expect(ok.result).toEqual({ status: "pending", delivery: "LinkedIn: goes out automatically" });
    expect(JSON.stringify(ok.result)).not.toContain(NOW.id);
    expect(ok.runtime?.proposalId).toBe(NOW.id);
  });

  it("publishes nothing itself, whatever the model returns", async () => {
    vi.mocked(proposeSchedule).mockResolvedValue(NOW);
    await executor()("propose_post_now", { when: "2026-10-03T09:00", content_item_id: "x" });

    const { publishContentItemNow } = await import("@/lib/product");
    expect(vi.mocked(publishContentItemNow)).not.toHaveBeenCalled();
    expect(scheduleContentItem).not.toHaveBeenCalled();
  });

  it("is not a v1 tool", async () => {
    const outcome = await executor("context.v1")("propose_post_now", {});

    expect(outcome).toEqual({ kind: "failed", reason: "unknown tool propose_post_now" });
  });

  it("announces its card on the stream like a schedule card", async () => {
    const events: { type: string }[] = [];
    let call = 0;
    await runAgentTurn({
      driver: {
        toProviderTools: (tools) => tools,
        runTurn: async () =>
          call++ === 0
            ? { text: "", toolCalls: [{ id: "t1", name: "propose_post_now", input: {} }], stopReason: "tool_use", usage: NO_USAGE }
            : { text: "The card is ready.", toolCalls: [], stopReason: "end_turn", usage: NO_USAGE },
      },
      executor: async () => ({ kind: "ok", result: { status: "pending", delivery: "x" }, runtime: { proposalId: "n1" } }),
      onEvent: (event) => events.push(event),
    });

    expect(events).toContainEqual({ type: "schedule.proposed", proposal_id: "n1" });
  });
});
