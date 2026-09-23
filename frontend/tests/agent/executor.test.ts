import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Task 8 fix round, item 5. This is the seam that did not exist before this
 * round: `createExecutor` used to be an inline closure inside
 * `agent/route.ts`'s `ReadableStream.start()`, reachable only through a full
 * `Request`. Every one of this round's defects — the payload-unwrapping bug,
 * the escaping corruption, the attempt-accounting gap — lived in exactly
 * that untested code. These tests are the guard against it recurring.
 *
 * The five tool modules are mocked: this file tests DISPATCH (which tool
 * function gets called, with what arguments, and how its result becomes a
 * `ToolExecution`) — not the tool implementations themselves, which have
 * their own tests (`submit-draft.test.ts`, `schedule-tool.test.ts`, and
 * Task 7's `backend.test.ts`).
 */
vi.mock("@/agent/tools/prepare-generation", () => ({ prepareGeneration: vi.fn() }));
vi.mock("@/agent/tools/submit-draft", () => ({ submitDraft: vi.fn() }));
vi.mock("@/agent/tools/get-variant-sources", () => ({ getVariantSources: vi.fn() }));
vi.mock("@/agent/tools/propose-durable-fact", () => ({ proposeDurableFact: vi.fn() }));
vi.mock("@/agent/tools/schedule", () => ({ schedule: vi.fn() }));

import { ProductHttpError } from "@/lib/product";

import type { Driver, TurnResult } from "@/agent/lib/driver";
import { createExecutor } from "@/agent/lib/executor";
import { runAgentTurn } from "@/agent/lib/turn";
import { prepareGeneration } from "@/agent/tools/prepare-generation";
import { submitDraft } from "@/agent/tools/submit-draft";
import { getVariantSources } from "@/agent/tools/get-variant-sources";
import { proposeDurableFact } from "@/agent/tools/propose-durable-fact";
import { schedule } from "@/agent/tools/schedule";

const NO_USAGE = { inputTokens: null, outputTokens: null, cacheReadInputTokens: null, cacheCreationInputTokens: null };

const SKILL_VERSIONS = [{ slug: "instructions", version: "1.1.0" }];

const prepareArgs = (message: string) => ({
  message,
  operation: "generate" as const,
  subject: message,
  retrieval_query: message,
});

function build() {
  return createExecutor({
    sessionId: "session-1",
    turnId: "11111111-1111-1111-1111-111111111111",
    selectedVariantId: null,
    token: "token-abc",
    getUsage: () => NO_USAGE,
    skillVersions: SKILL_VERSIONS,
  });
}

beforeEach(() => {
  vi.mocked(prepareGeneration).mockReset();
  vi.mocked(submitDraft).mockReset();
  vi.mocked(getVariantSources).mockReset();
  vi.mocked(proposeDurableFact).mockReset();
  vi.mocked(schedule).mockReset();
});

describe("createExecutor — dispatch and the mutable handles/snapshotId wiring", () => {
  it("rejects an unknown tool name without calling anything", async () => {
    const { executor } = build();
    const execution = await executor("not_a_real_tool", {});
    expect(execution.kind).toBe("failed");
    expect(prepareGeneration).not.toHaveBeenCalled();
  });

  it("rejects malformed input with reachedPython: false, before dispatching", async () => {
    const { executor } = build();
    const execution = await executor("prepare_generation", { message: 123 });
    expect(execution.kind).toBe("rejected");
    if (execution.kind === "rejected") expect(execution.reachedPython).toBe(false);
    expect(prepareGeneration).not.toHaveBeenCalled();
  });

  it("prepare_generation renders material exactly once and updates state.handles/snapshotId", async () => {
    const { executor, state } = build();
    vi.mocked(prepareGeneration).mockResolvedValue({
      contract_version: "context.v1",
      snapshot_id: "snap-1",
      platform: "linkedin",
      status: "ready",
      question: null,
      subject: "the launch",
      task: "write a post",
      voice: { tone: [], audience: null, do_phrases: [], avoid_phrases: [] },
      material: [{ atom_id: "atom-1", atom_type: "fact", text: "we doubled revenue", trust: "untrusted" }],
      background: [],
      banned_phrases: [],
      gaps: [],
      conflicts: [],
    });

    expect(state.snapshotId).toBeNull();
    expect(state.handles.size).toBe(0);

    const execution = await executor("prepare_generation", prepareArgs("write a post"));

    expect(execution.kind).toBe("ok");
    expect(state.snapshotId).toBe("snap-1");
    expect(state.handles.size).toBe(1);
    expect(state.handles.get("M1")?.atom_id).toBe("atom-1");
    if (execution.kind === "ok") {
      expect(execution.result.material).toContain("we doubled revenue");
      expect(execution.result.material).toContain("M1"); // the handle, not the uuid
      expect(JSON.stringify(execution.result)).not.toContain("atom-1"); // never the raw uuid
    }
  });

  it("rejects submit_draft with reachedPython: false when no snapshot has been prepared yet", async () => {
    const { executor } = build();
    const execution = await executor("submit_draft", { body: "b", title: "Test post", cited_atom_ids: [], agent_text: "a" });
    expect(execution.kind).toBe("rejected");
    if (execution.kind === "rejected") expect(execution.reachedPython).toBe(false);
    expect(submitDraft).not.toHaveBeenCalled();
  });

  it("a submit_draft call's ToolContext.handles is the SAME map prepare_generation just built — not recomputed", async () => {
    const { executor, state } = build();
    vi.mocked(prepareGeneration).mockResolvedValue({
      contract_version: "context.v1",
      snapshot_id: "snap-1",
      platform: "linkedin",
      status: "ready",
      question: null,
      subject: null,
      task: "write a post",
      voice: { tone: [], audience: null, do_phrases: [], avoid_phrases: [] },
      material: [{ atom_id: "atom-1", atom_type: "fact", text: "we doubled revenue", trust: "untrusted" }],
      background: [],
      banned_phrases: [],
      gaps: [],
      conflicts: [],
    });
    vi.mocked(submitDraft).mockResolvedValue({ outcome: "verified", variant_id: "v1" });

    await executor("prepare_generation", prepareArgs("m"));
    await executor("submit_draft", {
      body: "we doubled revenue",
      title: "Revenue lesson",
      cited_atom_ids: [{ handle: "M1", quoted_span: "we doubled revenue", claim_text: "we doubled revenue" }],
      agent_text: "here",
    });

    expect(submitDraft).toHaveBeenCalledTimes(1);
    const [, context] = vi.mocked(submitDraft).mock.calls[0];
    expect(context.handles).toBe(state.handles); // identity, not just equality
    // Task 12: threaded through the same way `token` is — server state, set
    // once by whoever builds the executor, never derived per tool call.
    expect(context.skillVersions).toBe(SKILL_VERSIONS);
  });

  it("a LOCAL pre-flight hold (problems present) reports reachedPython: false, and records no agent_text", async () => {
    const { executor, state } = build();
    vi.mocked(prepareGeneration).mockResolvedValue(materialContext());
    vi.mocked(submitDraft).mockResolvedValue({
      outcome: "held",
      problems: [{ kind: "span_too_short", detail: "too short" }],
    });

    await executor("prepare_generation", prepareArgs("m"));
    const execution = await executor("submit_draft", {
      body: "b",
      title: "Test post",
      cited_atom_ids: [{ handle: "M1", quoted_span: "x", claim_text: "x" }],
      agent_text: "a",
    });

    expect(execution.kind).toBe("rejected");
    if (execution.kind === "rejected") {
      expect(execution.reachedPython).toBe(false);
      expect(execution.reason).toContain("too short");
    }
    // Never reached Python, so nothing was written for it to record — this
    // is one half of the discriminator the next test pins the other half of.
    expect(state.submittedAgentTexts).toEqual([]);
  });

  it("a PYTHON-side hold (no problems, a rejectionKind) reports reachedPython: true, and DOES record agent_text", async () => {
    // The exact distinction item 3 requires: this call DID leave the
    // process, so it must count against the ceiling even though its outcome
    // is also "held". §9 step 5's D-A review round: `chat.py` appends the
    // `kind=agent` row OUTSIDE its verified/held branch ("whichever branch
    // ran"), so a held submission that reached the server must be recorded
    // exactly as a verified one is — otherwise the route's byte-identical
    // guard is blind to a held attempt's `agent_text`, and a held-then-
    // verified turn (the ordinary shape §5.5's one correction produces) can
    // record a duplicate row.
    const { executor, state } = build();
    vi.mocked(prepareGeneration).mockResolvedValue(materialContext());
    vi.mocked(submitDraft).mockResolvedValue({ outcome: "held", rejectionKind: "citation_absent" });

    await executor("prepare_generation", prepareArgs("m"));
    const execution = await executor("submit_draft", {
      body: "b",
      title: "Test post",
      cited_atom_ids: [{ handle: "M1", quoted_span: "x", claim_text: "x" }],
      agent_text: "a",
    });

    expect(execution.kind).toBe("rejected");
    if (execution.kind === "rejected") {
      expect(execution.reachedPython).toBe(true);
      expect(execution.reason).toContain("citation_absent");
    }
    expect(state.submittedAgentTexts).toEqual(["a"]);
  });

  it("a verified submit_draft is ok and carries variant_id", async () => {
    const { executor } = build();
    vi.mocked(prepareGeneration).mockResolvedValue(materialContext());
    vi.mocked(submitDraft).mockResolvedValue({ outcome: "verified", variant_id: "v1" });

    await executor("prepare_generation", prepareArgs("m"));
    const execution = await executor("submit_draft", {
      body: "b",
      title: "Test post",
      cited_atom_ids: [{ handle: "M1", quoted_span: "x", claim_text: "x" }],
      agent_text: "a",
    });

    expect(execution).toEqual({ kind: "ok", result: { outcome: "verified", variant_id: "v1" } });
  });

  it("remembers every agent_text it submitted, in order", async () => {
    // D-A's guard needs to know what was already recorded transactionally.
    // The executor is the only layer that sees `agent_text` at all: it is a
    // tool INPUT, so neither the driver nor the route ever sees it.
    const { executor, state } = build();
    vi.mocked(prepareGeneration).mockResolvedValue(materialContext());
    vi.mocked(submitDraft).mockResolvedValue({ outcome: "verified", variant_id: "v1" });

    await executor("prepare_generation", prepareArgs("the launch"));
    await executor("submit_draft", {
      body: "A post citing M1.",
      title: "Grounded draft",
      cited_atom_ids: [{ handle: "M1", quoted_span: "we doubled revenue", claim_text: "A post citing M1." }],
      agent_text: "Here's a draft from your 14 March call.",
    });

    expect(state.submittedAgentTexts).toEqual(["Here's a draft from your 14 March call."]);
  });

  it("records nothing for a submit that never reached Python", async () => {
    // A pre-flight rejection wrote no variant and no message, so its
    // agent_text must not suppress a later, legitimate recording.
    const { executor, state } = build();

    const execution = await executor("submit_draft", {
      body: "No material prepared.",
      title: "Unprepared draft",
      cited_atom_ids: [],
      agent_text: "Here you go.",
    });

    expect(execution.kind).toBe("rejected");
    expect(state.submittedAgentTexts).toEqual([]);
  });

  it("dispatches get_variant_sources, propose_durable_fact and schedule with the renamed (camelCase) argument shapes", async () => {
    const { executor } = build();
    vi.mocked(getVariantSources).mockResolvedValue({ sources: [{ source_label: "call 1" }] });
    vi.mocked(proposeDurableFact).mockResolvedValue({ pendingConfirmationId: "pc-1" });
    vi.mocked(schedule).mockResolvedValue({ scheduledFor: "2026-08-20T13:00:00.000Z" });

    await executor("get_variant_sources", { variant_id: "v1" });
    await executor("propose_durable_fact", { text: "the price is $500" });
    await executor("schedule", { content_item_id: "item-1", when: "2026-08-20T09:00" });

    expect(vi.mocked(getVariantSources).mock.calls[0][0]).toEqual({ variantId: "v1" });
    expect(vi.mocked(proposeDurableFact).mock.calls[0][0]).toEqual({ text: "the price is $500" });
    expect(vi.mocked(schedule).mock.calls[0][0]).toEqual({ contentItemId: "item-1", when: "2026-08-20T09:00" });
  });

  it("increments the attempt number per tool name across repeated calls", async () => {
    const { executor } = build();
    vi.mocked(getVariantSources).mockResolvedValue({ sources: [] });

    await executor("get_variant_sources", { variant_id: "v1" });
    await executor("get_variant_sources", { variant_id: "v1" });

    const [, , firstAttempt] = vi.mocked(getVariantSources).mock.calls[0];
    const [, , secondAttempt] = vi.mocked(getVariantSources).mock.calls[1];
    expect(firstAttempt).toBe(1);
    expect(secondAttempt).toBe(2);
  });

  it("surfaces a plain Error's own message (the model's own bad input), and a safe PROJECTED sentence for an HTTP error — never its raw message", async () => {
    const { executor } = build();
    vi.mocked(getVariantSources).mockRejectedValueOnce(new Error("that variant id looks malformed"));
    // No usable `detail` (undefined) and a 5xx: `safeProductSentence` falls
    // back to the generic 5xx sentence — still never the raw
    // `error.message`, which would contain the upstream path and body
    // (`ProductHttpError`'s own docstring warns against exactly that leak).
    vi.mocked(proposeDurableFact).mockRejectedValueOnce(new ProductHttpError("product POST ... -> 500: {...}", 500, undefined));

    const plain = await executor("get_variant_sources", { variant_id: "v1" });
    const http = await executor("propose_durable_fact", { text: "x" });

    expect(plain.kind).toBe("failed");
    if (plain.kind === "failed") expect(plain.reason).toBe("that variant id looks malformed");

    expect(http.kind).toBe("failed");
    if (http.kind === "failed") {
      expect(http.reason).not.toContain("product POST");
      expect(http.reason).toBe("Something broke on our side. Nothing was saved — try again.");
    }
  });

  it("I4 (final whole-branch review): a 422 with a KNOWN detail reaches the model as that detail, not the generic 'failed unexpectedly' sentence", async () => {
    // Before this fix, EVERY `ProductHttpError`/`EngineHttpError` collapsed to
    // `` `${name} failed unexpectedly and could not complete` `` here — an
    // actionable, self-correctable refusal (e.g. `schedule`'s own
    // `snapshot_not_generation_ready`-shaped detail strings) was
    // indistinguishable from a genuine infrastructure failure, and the model
    // had nothing to correct even though the tool result still counted
    // against the ceiling for `submit_draft`.
    const { executor } = build();
    vi.mocked(schedule).mockRejectedValueOnce(
      new ProductHttpError(
        "product POST /v1/content-items/item-1/schedule -> 422: {...}",
        422,
        "snapshot_not_generation_ready",
      ),
    );

    const execution = await executor("schedule", { content_item_id: "item-1", when: "2026-08-20T09:00" });

    expect(execution.kind).toBe("failed");
    if (execution.kind === "failed") {
      expect(execution.reason).toBe("snapshot_not_generation_ready");
      expect(execution.reason).not.toContain("product POST");
      expect(execution.reason).not.toContain("failed unexpectedly");
    }
  });
});

/**
 * Item 3's own explicit ask: prove §4.7 mechanism 3 holds "through the real
 * executor, not through the seam". Every test above this point drives
 * `createExecutor` directly; this one wires its REAL executor into the REAL
 * `runAgentTurn`, with a scripted driver standing in for the model — the
 * same shape production actually runs, `turn.test.ts`'s own scripted-seam
 * tests are what this exists to be independent of.
 */
describe("item 3, through the real executor — a local pre-flight hold spends no submit_draft attempt", () => {
  function scriptedDriver(script: TurnResult[]): Driver {
    let call = 0;
    return {
      toProviderTools: (tools) => tools,
      runTurn: async () => script[Math.min(call++, script.length - 1)],
    };
  }

  const NO_USAGE_2 = { inputTokens: null, outputTokens: null, cacheReadInputTokens: null, cacheCreationInputTokens: null };
  const submitCall = (id: string): TurnResult => ({
    text: "",
    toolCalls: [
      {
        id,
        name: "submit_draft",
        input: { body: "we doubled revenue", title: "Revenue lesson", cited_atom_ids: [{ handle: "M1", quoted_span: "we doubled revenue", claim_text: "we doubled revenue" }], agent_text: "here" },
      },
    ],
    stopReason: "tool_use",
    usage: NO_USAGE_2,
  });
  const prepareOnce = (id: string): TurnResult => ({
    text: "",
    toolCalls: [{ id, name: "prepare_generation", input: prepareArgs("write a post") }],
    stopReason: "tool_use",
    usage: NO_USAGE_2,
  });

  it("one call that never reaches Python (local preflight) does not count, so two REAL Python calls still fit under the ceiling of two", async () => {
    vi.mocked(prepareGeneration).mockResolvedValue(materialContext());
    // First real submit: local preflight rejects it (a span too short) —
    // never reaches `submitDraft`'s network call at all, because
    // `submit-draft.ts`'s own `preflight()` check runs first and returns
    // early. Second and third: Python itself is asked, and rejects both.
    vi.mocked(submitDraft)
      .mockResolvedValueOnce({ outcome: "held", problems: [{ kind: "span_too_short", detail: "too short" }] })
      .mockResolvedValueOnce({ outcome: "held", rejectionKind: "citation_absent" })
      .mockResolvedValueOnce({ outcome: "held", rejectionKind: "citation_absent" });

    const { executor } = createExecutor({
      sessionId: "session-1",
      turnId: "11111111-1111-1111-1111-111111111111",
      selectedVariantId: null,
      token: "token-abc",
      getUsage: () => NO_USAGE_2,
      skillVersions: SKILL_VERSIONS,
    });

    const outcome = await runAgentTurn({
      driver: scriptedDriver([prepareOnce("p1"), submitCall("s1"), submitCall("s2"), submitCall("s3")]),
      executor,
    });

    // All three submit_draft tool calls reached the executor (the loop
    // doesn't know in advance which will be local) — but only the two REAL
    // Python calls trip the ceiling. If the fix regressed and the LOCAL
    // preflight call were counted too, the ceiling would trip one call
    // early — on `s2` — and `submitDraft` would be called only 2 times, not
    // 3, because `s3` would never be dispatched (R12 breaks the loop
    // immediately). This assertion is what would catch that.
    expect(submitDraft).toHaveBeenCalledTimes(3);
    const terminal = outcome.events.find((event) => event.type === "terminal");
    expect(terminal).toBeDefined();
    // R13's in-loop terminal uses the LAST rejection's OWN reason (Python's
    // real rejection kind), not `bounds.ts`'s canned ceiling sentence — that
    // sentence only fires from `shouldStop` at the top of a PASS that never
    // happens here, because the ceiling trips mid-pass, inside `s3`'s own
    // tool-call handling.
    expect(terminal && "explanation" in terminal ? terminal.explanation : "").toContain("citation_absent");
  });
});

function materialContext() {
  return {
    contract_version: "context.v1" as const,
    snapshot_id: "snap-1",
    platform: "linkedin" as const,
    status: "ready" as const,
    question: null,
    subject: null,
    task: "write a post",
    voice: { tone: [], audience: null, do_phrases: [], avoid_phrases: [] },
    material: [{ atom_id: "atom-1", atom_type: "fact", text: "we doubled revenue", trust: "untrusted" as const }],
    background: [],
    banned_phrases: [],
    gaps: [],
    conflicts: [],
  };
}
