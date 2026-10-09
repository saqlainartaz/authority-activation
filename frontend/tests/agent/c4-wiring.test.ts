import { beforeEach, describe, expect, it, vi } from "vitest";

import { buildTurnMessages } from "@/agent/lib/context-assembly";
import { assembleTranscript } from "@/agent/transcript";
import { safeProductSentence } from "@/lib/product";
import { C4_TOOL_NAMES } from "@/agent/profile";
import { buildToolSpecs } from "@/agent/lib/tool-schemas";

vi.mock("@/lib/product", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/product")>();
  return { ...actual, createChatContext: vi.fn() };
});

const { createChatContext } = await import("@/lib/product");
const { createExecutor } = await import("@/agent/lib/executor");

/**
 * The wiring between the c4 Python surface and a model.
 *
 * **Every test here covers something that was built, tested and unreachable.**
 * The second independent review found that the runtime never asked for
 * `context.v2`, never showed a message handle, and collapsed every typed
 * product-tool refusal to "That didn't work (409)." — so perspective,
 * guideline, sources, the selected draft and the whole task-material path
 * existed in Python and in unit tests, and no model could reach any of them.
 *
 * Each test below reddens if the corresponding wire is cut again. That is the
 * only thing they are for: the behaviour they cover is tested elsewhere, and
 * was green throughout the period when none of it worked.
 */

const CONTEXT_V2 = {
  contract_version: "context.v2",
  snapshot_id: "11111111-1111-4111-8111-111111111111",
  platform: "linkedin",
  status: "ready",
  question: null,
  subject: "membership",
  task: "write about pricing",
  voice: { tone: [], audience: null, do_phrases: [], avoid_phrases: [] },
  material: [],
  background: [],
  banned_phrases: [],
  gaps: [],
  conflicts: [],
  selected_draft: null,
  sources: [{ label: "sales call", processing: "ready" }],
  perspective: {
    mode: "personal",
    author: { kind: "entity", id: "22222222-2222-4222-8222-222222222222", revision: 3 },
    brand: null,
    label: "Ada Lovelace",
  },
  guideline: {
    guideline_id: "33333333-3333-4333-8333-333333333333",
    revision: 2,
    text_digest: "a".repeat(64),
    text: "Say members, not clients.",
    precedence: "saved_default",
  },
};

function executor(contract: "context.v1" | "c4") {
  return createExecutor({
    sessionId: "44444444-4444-4444-8444-444444444444",
    turnId: "55555555-5555-4555-8555-555555555555",
    token: "token",
    getUsage: () => ({
      inputTokens: 0,
      outputTokens: 0,
      cacheReadInputTokens: null,
      cacheCreationInputTokens: null,
    }),
    skillVersions: [],
    contract,
    selectedVariantId: "66666666-6666-4666-8666-666666666666",
    // The session's variants, as every real envelope carries them. Without
    // this the helper built a session whose selected draft appears in no
    // variant list -- a shape production cannot produce, which the runtime
    // now correctly refuses to name.
    knownVariants: [
      { id: "66666666-6666-4666-8666-666666666666", variant_no: 1 },
      { id: "77777777-7777-4777-8777-777777777777", variant_no: 2 },
    ],
  });
}

const ARGS = {
  message: "write about pricing",
  operation: "generate",
  subject: "membership",
  retrieval_query: "membership price",
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(createChatContext).mockResolvedValue(CONTEXT_V2 as never);
});

describe("the c4 runtime asks for context.v2", () => {
  it("sends contract: context.v2 under the c4 profile", async () => {
    // THE REGRESSION CONTROL. `prepareGeneration` was called with no runtime
    // argument, so `contract` was undefined and Python answered `context.v1`.
    // Nothing anywhere asserted the outbound body.
    await executor("c4").executor("prepare_generation", ARGS);

    const [, , body] = vi.mocked(createChatContext).mock.calls[0];
    expect(body.contract).toBe("context.v2");
  });

  it("sends the selected variant, so a revise turn gets the real draft", async () => {
    await executor("c4").executor("prepare_generation", ARGS);

    const [, , body] = vi.mocked(createChatContext).mock.calls[0];
    expect(body.selected_variant_id).toBe("66666666-6666-4666-8666-666666666666");
  });

  it("leaves a v1 turn asking for nothing new", async () => {
    // A retained v1 session's request must not move: its cached prefix and
    // its stored snapshots were written against that exact shape.
    await executor("context.v1").executor("prepare_generation", ARGS);

    const [, , body] = vi.mocked(createChatContext).mock.calls[0];
    expect(body.contract).toBeUndefined();
  });
});

describe("what the model is shown of the v2 context", () => {
  it("gives the model the perspective by NAME, never by id", async () => {
    const outcome = await executor("c4").executor("prepare_generation", ARGS);

    expect(outcome.kind).toBe("ok");
    const result = (outcome as { result: Record<string, unknown> }).result;
    expect(result.perspective).toEqual({ mode: "personal", writing_as: "Ada Lovelace" });
    // §2.1: entity refs and internal identifiers are omitted, not echoed.
    expect(JSON.stringify(result)).not.toContain("22222222-2222-4222-8222-222222222222");
  });

  it("gives the model the guideline text and its precedence, and no digest", async () => {
    const outcome = await executor("c4").executor("prepare_generation", ARGS);
    const result = (outcome as { result: Record<string, unknown> }).result;

    expect(result.guideline).toContain("Say members, not clients.");
    // CHANGED FORM: precedence is DATA in the block now, and the rule that
    // interprets it lives in the instructions (test in list-recent-content),
    // because an instruction inside a tool result is treated as untrusted.
    expect(result.guideline).toContain('precedence="saved_default"');
    expect(JSON.stringify(result)).not.toContain("a".repeat(64));
    expect(JSON.stringify(result)).not.toContain("33333333-3333-4333-8333-333333333333");
  });

  it("gives the model the source labels", async () => {
    const outcome = await executor("c4").executor("prepare_generation", ARGS);
    const result = (outcome as { result: Record<string, unknown> }).result;

    expect(result.sources).toContain("<sources>");
    expect(result.sources).toContain("sales call");
  });

  it("degrades a perspective with no resolvable name to neutral", async () => {
    // Being told to write as someone whose name you do not know is worse
    // than being told to attribute nothing: the model would paper over it.
    vi.mocked(createChatContext).mockResolvedValue({
      ...CONTEXT_V2,
      perspective: { ...CONTEXT_V2.perspective, label: null },
    } as never);

    const outcome = await executor("c4").executor("prepare_generation", ARGS);
    const result = (outcome as { result: Record<string, unknown> }).result;

    expect(result.perspective).toEqual({ mode: "neutral", writing_as: null });
  });

  it("renders the real <guideline> block, not a second spelling of it", async () => {
    // The executor emits what `buildGuidelineBlock` produces, so the block
    // the model reads is the one whose precedence sentence and escaping are
    // tested. A locally-composed string here is how the two would drift.
    const outcome = await executor("c4").executor("prepare_generation", ARGS);
    const result = (outcome as { result: Record<string, unknown> }).result;

    expect(result.guideline).toContain("<guideline");
    expect(result.guideline).toContain('precedence="saved_default"');
    expect(result.guideline).toContain("Say members, not clients.");
  });

  it("omits the guideline entirely when there is no saved guidance", async () => {
    // MOVED from selected-draft/list-recent-content, which asserted it
    // against the removed assembler. An empty block reads to the model as
    // guidance that says nothing, which is a different claim from no saved
    // guidance at all.
    vi.mocked(createChatContext).mockResolvedValue({
      ...CONTEXT_V2,
      guideline: null,
    } as never);

    const outcome = await executor("c4").executor("prepare_generation", ARGS);
    const result = (outcome as { result: Record<string, unknown> }).result;

    expect(result.guideline).toBeNull();
  });

  it("omits the selected draft entirely when nothing is selected", async () => {
    // MOVED, same reason. An empty `<selected-draft/>` would read as "the
    // draft is blank" rather than "nothing is selected".
    const outcome = await executor("c4").executor("prepare_generation", ARGS);
    const result = (outcome as { result: Record<string, unknown> }).result;

    expect(result.selected_draft).toBeNull();
  });

  it("renders the selected draft exactly once when there is one", async () => {
    // `mockResolvedValue`, not `...Once`: the once-queue is shared across the
    // file and survives `clearAllMocks`, so a test that reads its own
    // override is reading whatever is at the front of that queue.
    vi.mocked(createChatContext).mockResolvedValue({
      ...CONTEXT_V2,
      selected_draft: {
        variant_id: "77777777-7777-4777-8777-777777777777",
        version_no: 2,
        body: "the draft being revised",
        body_digest: "c".repeat(64),
      },
    } as never);

    const outcome = await executor("c4").executor("prepare_generation", ARGS);
    const result = (outcome as { result: Record<string, unknown> }).result;

    expect(result.selected_draft).toContain("the draft being revised");
    expect(String(result.selected_draft).match(/<selected-draft/g)).toHaveLength(1);
  });

  it("omits the sources block entirely when there are no sources", async () => {
    vi.mocked(createChatContext).mockResolvedValue({
      ...CONTEXT_V2,
      sources: [],
    } as never);

    const outcome = await executor("c4").executor("prepare_generation", ARGS);
    const result = (outcome as { result: Record<string, unknown> }).result;

    expect(result.sources).toBeNull();
  });

  it("adds nothing at all to a v1 tool result", async () => {
    // The v1 result sits inside the cached prefix; a new key moves the bytes.
    vi.mocked(createChatContext).mockResolvedValue({
      ...CONTEXT_V2,
      contract_version: "context.v1",
    } as never);

    const outcome = await executor("context.v1").executor("prepare_generation", ARGS);
    const result = (outcome as { result: Record<string, unknown> }).result;

    expect(result).not.toHaveProperty("perspective");
    expect(result).not.toHaveProperty("guideline");
    expect(result).not.toHaveProperty("sources");
  });
});

describe("the message handle the model is told to name", () => {
  it("appears on a replayed client turn", () => {
    // It appeared nowhere. `use_task_material` takes a handle and the model
    // was never shown one, so the whole path was undriveable.
    const [rendered] = assembleTranscript([
      { id: "a", role: "user", kind: "task", body: "our programme is weekly", handle: "U5" },
    ]);

    expect(rendered.content).toContain('handle="U5"');
    expect(rendered.content).toContain("our programme is weekly");
  });

  it("appears on the current turn", () => {
    // The fact a client states in THIS message is the one the agent most
    // wants; without a handle here it could only reach back to older turns.
    const { messages } = buildTurnMessages([], [], "our programme is weekly", [], "U7");

    const current = messages.at(-1);
    expect(current?.content).toContain('handle="U7"');
  });

  it("is omitted rather than emitted empty when the server issued none", () => {
    // An empty `handle=""` is a handle the server refuses to resolve, offered
    // to the model as though it were usable.
    const [rendered] = assembleTranscript([
      { id: "a", role: "user", kind: "task", body: "hello", handle: null },
    ]);

    expect(rendered.content).not.toContain("handle=");
  });

  it("escapes a handle rather than letting it close the attribute", () => {
    const [rendered] = assembleTranscript([
      { id: "a", role: "user", kind: "task", body: "hi", handle: 'U1" evil="' },
    ]);

    expect(rendered.content).not.toContain('evil="');
  });
});

describe("a typed product-tool refusal reaches the model as itself", () => {
  it("carries the code and the sentence", () => {
    // Every one of these was "That didn't work (409)." — so the instructions
    // that tell the model how to react to each could never fire.
    const sentence = safeProductSentence(409, {
      code: "clarification_required",
      detail: "say what this fact applies to, or leave it unset",
    });

    expect(sentence).toContain("clarification_required");
    expect(sentence).toContain("say what this fact applies to");
  });

  it("still falls back when there is genuinely no detail", () => {
    const sentence = safeProductSentence(409, null);

    expect(sentence).toContain("409");
  });
});

describe("prepared material is background under c4, and citable under v1", () => {
  /** The same context with two atoms, so a second prepare re-mints `M1`. */
  const WITH_MATERIAL = {
    ...CONTEXT_V2,
    material: [
      { atom_id: "77777777-7777-4777-8777-777777777777", atom_type: "fact", text: "First." },
      { atom_id: "88888888-8888-4888-8888-888888888888", atom_type: "fact", text: "Second." },
    ],
  };

  beforeEach(() => {
    vi.mocked(createChatContext).mockResolvedValue(WITH_MATERIAL as never);
  });

  it("mints no M-handle a c4 model could cite", async () => {
    // THE BLOCKING FINDING. `M{n}` is minted in this runtime and exists in no
    // read view, so the fence cannot resolve it: a c4 model that cited what it
    // was shown had its draft refused for citing the material it was given.
    const state = executor("c4");
    const outcome = await state.executor("prepare_generation", ARGS);

    const result = (outcome as { result: Record<string, unknown> }).result;
    expect(result.material).not.toContain("M1");
    expect(result.material).toContain("citable=\"no\"");
    // The text still reaches the model — it is background, not withheld.
    expect(result.material).toContain("First.");
    // And nothing was bound. The citable namespace is the server's.
    expect(state.state.handles.size).toBe(0);
  });

  it("lets a c4 turn prepare TWICE, which §5.4 calls a feature", async () => {
    // The other half of the same defect: positional handles re-mint, so the
    // second prepare asked `AppendOnlyHandles` to rebind `M1` and it threw —
    // correctly. The fix is that prepare binds nothing, not a cleverer number.
    const state = executor("c4");
    await state.executor("prepare_generation", ARGS);

    vi.mocked(createChatContext).mockResolvedValue({
      ...WITH_MATERIAL,
      material: [
        { atom_id: "99999999-9999-4999-8999-999999999999", atom_type: "fact", text: "Different." },
      ],
    } as never);
    const second = await state.executor("prepare_generation", ARGS);

    expect(second.kind).toBe("ok");
    const result = (second as { result: Record<string, unknown> }).result;
    expect(result.material).toContain("Different.");
  });

  it("leaves v1's M-handles exactly as they were", async () => {
    // v1 cites `M{n}` by design: `buildDraftPayload` substitutes the real
    // `atom_id` before the payload leaves the runtime. Nothing here moves it.
    const state = executor("context.v1");
    const outcome = await state.executor("prepare_generation", ARGS);

    const result = (outcome as { result: Record<string, unknown> }).result;
    expect(result.material).toContain("[M1]");
    expect(result.material).toContain("[M2]");
    expect(state.state.handles.get("M1")?.text).toBe("First.");
  });

  it("tells a c4 model, in the tool list, that prepared material is not citable", async () => {
    // The instruction and the mechanism have to agree. A model told to freeze
    // a snapshot and write from it will cite it, whatever the renderer does.
    const { buildToolSpecs } = await import("@/agent/lib/tool-schemas");
    const { PROFILES } = await import("@/agent/profile");

    const c4 = buildToolSpecs(PROFILES["linkedin-c4"].tools, "c4").find(
      (tool) => tool.name === "prepare_generation",
    );
    expect(c4?.description).toMatch(/cannot cite it/);
    expect(c4?.description).toMatch(/read_knowledge or use_task_material/);

    // And a v1 session's cached prefix must not move by a byte.
    const v1 = buildToolSpecs(PROFILES.linkedin.tools).find(
      (tool) => tool.name === "prepare_generation",
    );
    expect(v1?.description).toBe(
      "Retrieve and freeze a snapshot of this client's context from an explicit subject and standalone search query. Call before writing. One meaningfully different re-retrieval is allowed when the returned material is mismatched.",
    );
  });
});

describe("the draft id reaches the browser and the handle reaches the model", () => {
  /**
   * A regression I nearly shipped in the act of fixing another one.
   *
   * `draft.ready` read `execution.result.variant_id` — the same object the
   * loop JSON-stringifies into the model's tool-result message. Projecting the
   * uuid out of it for the model therefore also removed it from the event that
   * tells the BROWSER which draft to open: the client would have lost every
   * draft it had just paid for, and nothing in ~480 tests said so, because
   * nothing asserted the two consumers separately. They now travel apart —
   * `result` for the model, `runtime` for the loop.
   */
  it("gives the model a handle and the loop the real id", async () => {
    const { createExecutor } = await import("@/agent/lib/executor");
    const state = createExecutor({
      sessionId: "44444444-4444-4444-8444-444444444444",
      turnId: "55555555-5555-4555-8555-555555555555",
      token: "token",
      getUsage: () => ({
        inputTokens: 0,
        outputTokens: 0,
        cacheReadInputTokens: null,
        cacheCreationInputTokens: null,
      }),
      skillVersions: [],
      contract: "c4",
    });
    const product = await import("@/lib/product");
    vi.spyOn(product, "createChatBasis").mockResolvedValue({
      basis_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    } as never);
    vi.spyOn(product, "submitChatDraft").mockResolvedValue({
      // INPUT CORRECTED, not the check. This mock used to carry `payload`
      // alone, a response the route never sends: `RuntimeSessionOut` always
      // includes the session's `variants`, and the c4 runtime now names a
      // draft by the `variant_no` in that list rather than by counting.
      variants: [{ id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", variant_no: 1, status: "verified", body: "" }],
      payload: {
        outcome: "verified",
        variant_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      },
    } as never);

    // INPUT CORRECTED: bound through the namespace, as every c4 handle is in

    // production. Writing `state.handles` directly built a map a prepare now

    // rebuilds from the namespace (it binds the piece's task facts there).

    state.state.namespace.set("K1", {
      atom_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      atom_type: "fact",
      text: "Membership costs 49.00 USD per month.",
    } as never);

    state.state.handles = state.state.namespace.asMap();

    // INPUT CORRECTED: a c4 turn prepares before it submits, and the runtime
    // now refuses a submit that skipped it (the basis must record who the
    // turn writes as). This test used to submit cold, a sequence production
    // can no longer run.
    await state.executor("prepare_generation", ARGS);
    const outcome = await state.executor("submit_draft", {
      body: "Membership costs 49.00 USD per month.",
      title: "Membership price", // INPUT CORRECTED: main's Library title is required (C4 merged main)
      cited_atom_ids: [
        {
          handle: "K1",
          quoted_span: "Membership costs 49.00 USD per month.",
          claim_text: "Membership costs 49.00 USD per month.",
        },
      ],
      agent_text: "Here it is.",
    });

    expect(outcome.kind).toBe("ok");
    const ok = outcome as {
      result: Record<string, unknown>;
      runtime?: { variantId?: string };
    };
    // What the model is handed: a handle, and no uuid anywhere in it.
    expect(ok.result.draft).toBe("D1");
    expect(JSON.stringify(ok.result)).not.toContain("bbbbbbbb");
    // What the loop is handed, for `draft.ready`: the real id.
    expect(ok.runtime?.variantId).toBe("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
  });
});

describe("a draft handle means the same draft on every turn", () => {
  /**
   * The outside review's O3, and a defect I introduced: `D1` was minted for
   * whichever variant a turn's executor met first, and the executor is rebuilt
   * on every HTTP turn. Show variant A as `D1`, select variant B, start a new
   * turn, and B was `D1` too. Handles now come from the server's `variant_no`.
   */
  const A = "aaaa0000-0000-4000-8000-00000000000a";
  const B = "bbbb0000-0000-4000-8000-00000000000b";
  const VARIANTS = [
    { id: A, variant_no: 1 },
    { id: B, variant_no: 2 },
  ];

  function turn(selected: string) {
    vi.mocked(createChatContext).mockResolvedValue({
      ...CONTEXT_V2,
      selected_draft: {
        variant_id: selected,
        version_no: 1,
        body: `the body of ${selected}`,
        body_digest: "b".repeat(64),
      },
    } as never);
    return createExecutor({
      sessionId: "44444444-4444-4444-8444-444444444444",
      turnId: crypto.randomUUID(),
      token: "token",
      getUsage: () => ({
        inputTokens: 0,
        outputTokens: 0,
        cacheReadInputTokens: null,
        cacheCreationInputTokens: null,
      }),
      skillVersions: [],
      contract: "c4",
      selectedVariantId: selected,
      knownVariants: VARIANTS,
    });
  }

  async function selectedHandle(selected: string): Promise<string> {
    const outcome = await turn(selected).executor("prepare_generation", ARGS);
    const block = (outcome as unknown as { result: { selected_draft: string } }).result.selected_draft;
    const match = block.match(/<selected-draft handle="(D\d+)"/);
    expect(match).not.toBeNull();
    return match![1];
  }

  it("keeps A as D1 and names B D2, whichever turn shows them", async () => {
    // The review's exact scenario. Under the old counter both calls said D1.
    expect(await selectedHandle(A)).toBe("D1");
    expect(await selectedHandle(B)).toBe("D2");
    expect(await selectedHandle(A)).toBe("D1");
  });

  it("names no draft the server did not number, rather than inventing a handle", async () => {
    // Fail closed: a selected draft missing from the session's own variant
    // list is an invariant break, and it is omitted -- never shown under a
    // guessed handle, and never under its uuid.
    const stranger = "cccc0000-0000-4000-8000-00000000000c";
    const outcome = await turn(stranger).executor("prepare_generation", ARGS);
    const result = (outcome as { result: Record<string, unknown> }).result;
    expect(result.selected_draft).toBeNull();
    expect(JSON.stringify(result)).not.toContain(stranger);
  });
});

describe("a c4 submit carries the compare-and-set", () => {
  /**
   * The outside review's O4. The backend refuses a submit whose
   * `expected_variant_id` no longer matches the session's selection (C4-12),
   * but the runtime never sent one -- so a turn that began on draft A, with
   * the client switching to B before it submitted, stored over B's selection.
   */
  async function submittedBody(selectedVariantId: string | null) {
    const product = await import("@/lib/product");
    vi.spyOn(product, "createChatBasis").mockResolvedValue({
      basis_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    } as never);
    const submit = vi.spyOn(product, "submitChatDraft").mockResolvedValue({
      variants: [],
      payload: { outcome: "verified", variant_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" },
    } as never);
    const { state, executor: run } = createExecutor({
      sessionId: "44444444-4444-4444-8444-444444444444",
      turnId: crypto.randomUUID(),
      token: "token",
      getUsage: () => ({
        inputTokens: 0,
        outputTokens: 0,
        cacheReadInputTokens: null,
        cacheCreationInputTokens: null,
      }),
      skillVersions: [],
      contract: "c4",
      selectedVariantId,
    });
    // INPUT CORRECTED: bound through the namespace, as every c4 handle is in
    // production. Writing `state.handles` directly built a map a prepare now
    // rebuilds from the namespace (it binds the piece's task facts there).
    state.namespace.set("K1", {
      atom_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      atom_type: "fact",
      text: "Membership costs 49.00 USD per month.",
    } as never);
    state.handles = state.namespace.asMap();
    // INPUT CORRECTED: a c4 turn prepares before it submits, and the runtime
    // now refuses a submit that skipped it (the basis must record who the
    // turn writes as). This test used to submit cold, a sequence production
    // can no longer run.
    await run("prepare_generation", ARGS);
    await run("submit_draft", {
      body: "Membership costs 49.00 USD per month.",
      title: "Membership price", // INPUT CORRECTED: main's Library title is required (C4 merged main)
      cited_atom_ids: [
        {
          handle: "K1",
          quoted_span: "Membership costs 49.00 USD per month.",
          claim_text: "Membership costs 49.00 USD per month.",
        },
      ],
      agent_text: "Here it is.",
    });
    return submit.mock.calls[0][2] as Record<string, unknown>;
  }

  it("pins the selection the turn started with", async () => {
    const body = await submittedBody("66666666-6666-4666-8666-666666666666");
    expect(body.expected_variant_id).toBe("66666666-6666-4666-8666-666666666666");
  });

  it("sends an explicit null when the session had no selection", async () => {
    // CHANGED EXPECTATION, deliberately. This asserted the field was ABSENT,
    // which the server read as "no expectation" -- so two concurrent
    // first-draft turns each stored and the later replaced the earlier's
    // selection (outside review O4, the no-selection half). The server now
    // reads an explicit null as "nothing was selected when I began" and
    // refuses the store if something is (test_two_first_drafts_cannot_
    // replace_each_other). The assertion is stricter than the one it replaces.
    const body = await submittedBody(null);
    expect("expected_variant_id" in body).toBe(true);
    expect(body.expected_variant_id).toBeNull();
  });
});

describe("the perspective reaches the stored basis", () => {
  /**
   * The outside review's O5. Neither `prepareGeneration` nor `submitDraftC4`
   * sent a perspective, so every c4 draft was prepared and stored as neutral
   * -- a request to write as a person or a brand left a basis that did not
   * record the voice it asked for. Each test below cuts one link.
   */
  const AUTHOR = "22222222-2222-4222-8222-222222222222";

  async function prepareThenSubmit(label: string | null = "Ada Lovelace") {
    vi.mocked(createChatContext).mockResolvedValue({
      ...CONTEXT_V2,
      perspective: { ...CONTEXT_V2.perspective, label },
    } as never);
    const product = await import("@/lib/product");
    const basis = vi.spyOn(product, "createChatBasis").mockResolvedValue({
      basis_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    } as never);
    vi.spyOn(product, "submitChatDraft").mockResolvedValue({
      variants: [],
      payload: { outcome: "verified", variant_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" },
    } as never);

    const { state, executor: run } = executor("c4");
    await run("prepare_generation", { ...ARGS, perspective: "personal" });
    // INPUT CORRECTED: bound through the namespace, as every c4 handle is in
    // production. Writing `state.handles` directly built a map a prepare now
    // rebuilds from the namespace (it binds the piece's task facts there).
    state.namespace.set("K1", {
      atom_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      atom_type: "fact",
      text: "Membership costs 49.00 USD per month.",
    } as never);
    state.handles = state.namespace.asMap();
    await run("submit_draft", {
      body: "Membership costs 49.00 USD per month.",
      title: "Membership price", // INPUT CORRECTED: main's Library title is required (C4 merged main)
      cited_atom_ids: [
        {
          handle: "K1",
          quoted_span: "Membership costs 49.00 USD per month.",
          claim_text: "Membership costs 49.00 USD per month.",
        },
      ],
      agent_text: "Here it is.",
    });
    return {
      contextBody: vi.mocked(createChatContext).mock.calls[0][2] as Record<string, unknown>,
      basisBody: basis.mock.calls[0][2] as Record<string, unknown>,
    };
  }

  it("asks the server for the mode the model reported", async () => {
    const { contextBody } = await prepareThenSubmit();
    expect(contextBody.perspective_mode).toBe("personal");
  });

  it("records the RESOLVED author on the basis, from the server's own response", async () => {
    // The id comes back in `context.v2`; the model never saw it and did not
    // supply it. This is the link whose absence made every basis neutral.
    const { basisBody } = await prepareThenSubmit();
    expect(basisBody.perspective_mode).toBe("personal");
    expect(basisBody.perspective_author_id).toBe(AUTHOR);
  });

  it("records neutral when the model was told neutral, whatever the server resolved", async () => {
    // `describePerspective` degrades a mode with no nameable author to
    // neutral for the model. The basis follows what the model was TOLD: a
    // receipt for an attribution the draft was never written under is false.
    const { basisBody } = await prepareThenSubmit(null);
    expect(basisBody.perspective_mode).toBe("neutral");
    expect(basisBody.perspective_author_id).toBeNull();
  });

  it("offers the field to a c4 model and not to a v1 one", async () => {
    const { buildToolSpecs } = await import("@/agent/lib/tool-schemas");
    const { PROFILES } = await import("@/agent/profile");
    const props = (contract: "context.v1" | "c4", tools: readonly string[]) =>
      (
        buildToolSpecs(tools as never, contract).find((t) => t.name === "prepare_generation")!
          .inputSchema as { properties: Record<string, unknown> }
      ).properties;

    expect(props("c4", PROFILES["linkedin-c4"].tools)).toHaveProperty("perspective");
    // v1's cached prefix must not move by a byte.
    expect(props("context.v1", PROFILES.linkedin.tools)).not.toHaveProperty("perspective");
  });
});

describe("schedule asks a c4 model for no identifier", () => {
  /**
   * The outside review's O2, second half. The v1 `schedule` schema asks the
   * model for a raw `content_item_id`, which a c4 model -- never shown one --
   * could only supply by leaking or inventing it.
   */
  it("offers a c4 model only the date and time", async () => {
    const { buildToolSpecs } = await import("@/agent/lib/tool-schemas");
    const { PROFILES } = await import("@/agent/profile");
    const spec = (contract: "context.v1" | "c4", tools: readonly string[], name: string) =>
      buildToolSpecs(tools as never, contract).find((t) => t.name === name);

    // CHANGED FORM, same property: c4 now PROPOSES a time rather than
    // scheduling (operator ruling, 2026-09-24), and the proposal still asks
    // the model for the local date and time and nothing that identifies.
    expect(spec("c4", PROFILES["linkedin-c4"].tools, "schedule")).toBeUndefined();
    const c4 = spec("c4", PROFILES["linkedin-c4"].tools, "propose_schedule")!.inputSchema as {
      properties: Record<string, unknown>;
    };
    expect(Object.keys(c4.properties)).toEqual(["when"]);
    // v1's cached prefix must not move by a byte.
    const v1 = spec("context.v1", PROFILES.linkedin.tools, "schedule")!.inputSchema as {
      properties: Record<string, unknown>;
    };
    expect(v1.properties).toHaveProperty("content_item_id");
  });

  it("refuses rather than guesses when the session has no saved piece", async () => {
    const { executor: run } = createExecutor({
      sessionId: "44444444-4444-4444-8444-444444444444",
      turnId: crypto.randomUUID(),
      token: "token",
      getUsage: () => ({
        inputTokens: 0,
        outputTokens: 0,
        cacheReadInputTokens: null,
        cacheCreationInputTokens: null,
      }),
      skillVersions: [],
      contract: "c4",
      contentItemId: null,
    });
    const outcome = await run("schedule", { when: "2026-10-01T09:00" });
    // CHANGED EXPECTATION, review 5 (B1): the property -- a c4 `schedule` call
    // schedules nothing -- now holds one step EARLIER. c4 does not offer
    // `schedule` at all (the client's click schedules), so the executor
    // refuses the name before any schema, saved piece or backend is consulted.
    expect(outcome).toEqual({ kind: "failed", reason: "unknown tool schedule" });
  });
});


describe("fix verification: the two defects my own fixes introduced", () => {
  const A = "aaaa0000-0000-4000-8000-00000000000a";
  const B = "bbbb0000-0000-4000-8000-00000000000b";
  const C = "cccc0000-0000-4000-8000-00000000000c";

  function c4Turn(selected: string | null, known: { id: string; variant_no: number }[]) {
    return createExecutor({
      sessionId: "44444444-4444-4444-8444-444444444444",
      turnId: crypto.randomUUID(),
      token: "token",
      getUsage: () => ({
        inputTokens: 0,
        outputTokens: 0,
        cacheReadInputTokens: null,
        cacheCreationInputTokens: null,
      }),
      skillVersions: [],
      contract: "c4",
      selectedVariantId: selected,
      knownVariants: known,
    });
  }

  const DRAFT = {
    body: "Membership costs 49.00 USD per month.",
    title: "Membership price", // INPUT CORRECTED: main's Library title is required (C4 merged main)
    cited_atom_ids: [
      {
        handle: "K1",
        quoted_span: "Membership costs 49.00 USD per month.",
        claim_text: "Membership costs 49.00 USD per month.",
      },
    ],
    agent_text: "Here it is.",
  };

  it("N2: a second submit in one turn compares against the first submit's draft", async () => {
    // Start on A. The first submit stores B, which SELECTS B. The second
    // submit's compare-and-set must pin B -- pinning the opening A made the
    // turn's own write look like somebody else's, and refused it.
    const product = await import("@/lib/product");
    vi.spyOn(product, "createChatBasis").mockResolvedValue({
      basis_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    } as never);
    const submit = vi
      .spyOn(product, "submitChatDraft")
      .mockResolvedValueOnce({
        variants: [
          { id: A, variant_no: 1, status: "verified", body: "" },
          { id: B, variant_no: 2, status: "verified", body: "" },
        ],
        payload: { outcome: "verified", variant_id: B },
      } as never)
      .mockResolvedValueOnce({
        variants: [
          { id: A, variant_no: 1, status: "verified", body: "" },
          { id: B, variant_no: 2, status: "verified", body: "" },
          { id: C, variant_no: 3, status: "verified", body: "" },
        ],
        payload: { outcome: "verified", variant_id: C },
      } as never);

    const { state, executor: run } = c4Turn(A, [{ id: A, variant_no: 1 }]);
    // INPUT CORRECTED: bound through the namespace, as every c4 handle is in
    // production. Writing `state.handles` directly built a map a prepare now
    // rebuilds from the namespace (it binds the piece's task facts there).
    state.namespace.set("K1", {
      atom_id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
      atom_type: "fact",
      text: "Membership costs 49.00 USD per month.",
    } as never);
    state.handles = state.namespace.asMap();
    // INPUT CORRECTED: a c4 turn prepares before it submits, and the runtime
    // now refuses a submit that skipped it (the basis must record who the
    // turn writes as). This test used to submit cold, a sequence production
    // can no longer run.
    await run("prepare_generation", ARGS);
    await run("submit_draft", DRAFT);
    await run("submit_draft", DRAFT);

    const first = submit.mock.calls[0][2] as Record<string, unknown>;
    const second = submit.mock.calls[1][2] as Record<string, unknown>;
    expect(first.expected_variant_id).toBe(A);
    expect(second.expected_variant_id).toBe(B);
  });

  it("N3: a draft handle the model was never shown does not resolve", async () => {
    // A is shown as D1. B exists as variant 2 and is known to the map -- it
    // must be, for numbering to be stable -- but the model was never given
    // D2, so guessing it must not reach B's sources.
    const product = await import("@/lib/product");
    const sources = vi
      .spyOn(product, "getChatVariantSources")
      .mockResolvedValue({ claims: [] } as never);
    vi.mocked(createChatContext).mockResolvedValue({
      ...CONTEXT_V2,
      selected_draft: { variant_id: A, version_no: 1, body: "the body of A", body_digest: "a".repeat(64) },
    } as never);

    const { executor: run } = c4Turn(A, [
      { id: A, variant_no: 1 },
      { id: B, variant_no: 2 },
    ]);
    await run("prepare_generation", ARGS);

    const guessed = await run("get_variant_sources", { variant_id: "D2" });
    expect(guessed.kind).toBe("rejected");
    expect((guessed as { reachedPython?: boolean }).reachedPython).toBe(false);
    expect(sources).not.toHaveBeenCalled();

    // And the one it WAS shown still resolves, to the real id.
    await run("get_variant_sources", { variant_id: "D1" });
    expect(sources).toHaveBeenCalledTimes(1);
    expect(sources.mock.calls[0][2]).toBe(A);
  });
});


describe("a c4 submit cannot skip the prepare that resolves perspective", () => {
  /**
   * O5, the part the audit refused to let stand. A submit with no prepare
   * recorded a NEUTRAL basis, while the model could still write the personal
   * post the client asked for -- a receipt misstating who is speaking. My
   * first disposition argued neutral was truthful because the model was told
   * nothing; the independent audit was right that this does not follow.
   */
  it("refuses a cold submit before anything reaches the server", async () => {
    const product = await import("@/lib/product");
    const basis = vi.spyOn(product, "createChatBasis");
    const submit = vi.spyOn(product, "submitChatDraft");
    const { state, executor: run } = executor("c4");
    // INPUT CORRECTED: bound through the namespace, as every c4 handle is in
    // production. Writing `state.handles` directly built a map a prepare now
    // rebuilds from the namespace (it binds the piece's task facts there).
    state.namespace.set("K1", {
      atom_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      atom_type: "fact",
      text: "Membership costs 49.00 USD per month.",
    } as never);
    state.handles = state.namespace.asMap();

    const outcome = await run("submit_draft", {
      body: "Membership costs 49.00 USD per month.",
      title: "Membership price", // INPUT CORRECTED: main's Library title is required (C4 merged main)
      cited_atom_ids: [
        {
          handle: "K1",
          quoted_span: "Membership costs 49.00 USD per month.",
          claim_text: "Membership costs 49.00 USD per month.",
        },
      ],
      agent_text: "Here it is.",
    });

    expect(outcome.kind).toBe("rejected");
    expect((outcome as { reachedPython?: boolean }).reachedPython).toBe(false);
    expect((outcome as { reason: string }).reason).toMatch(/prepare_generation/);
    // Nothing was frozen and nothing was submitted: no basis, no draft.
    expect(basis).not.toHaveBeenCalled();
    expect(submit).not.toHaveBeenCalled();
  });

  it("leaves v1 exactly as it was", async () => {
    // v1 has its own guard (a prepared snapshot) and its own message; this
    // check is c4's and must not change what a v1 turn is told.
    const { executor: run } = executor("context.v1");
    const outcome = await run("submit_draft", {
      body: "Membership costs 49.00 USD per month.",
      title: "Membership price", // INPUT CORRECTED: main's Library title is required (C4 merged main)
      cited_atom_ids: [],
      agent_text: "Here it is.",
    });
    expect((outcome as { reason?: string }).reason ?? "").not.toMatch(
      /resolves who this piece is written as/,
    );
  });
});


describe("an open perspective question blocks the submit", () => {
  /**
   * The final outside review's O5 finding. A prepare that returns
   * `answer_needed` because the perspective is ambiguous resolves to neutral
   * while the question is open. The first version of the prepare guard
   * accepted it, so a model could submit "I founded..." before the client had
   * said which founder, and a verified draft was stored under a neutral
   * receipt.
   */
  const DRAFT = {
    body: "Membership costs 49.00 USD per month.",
    title: "Membership price", // INPUT CORRECTED: main's Library title is required (C4 merged main)
    cited_atom_ids: [
      {
        handle: "K1",
        quoted_span: "Membership costs 49.00 USD per month.",
        claim_text: "Membership costs 49.00 USD per month.",
      },
    ],
    agent_text: "Here it is.",
  };

  it("refuses to store a draft while the client still has a question to answer", async () => {
    vi.mocked(createChatContext).mockResolvedValue({
      ...CONTEXT_V2,
      status: "answer_needed",
      question: { prompt: "Which founder is this written as: Ada or Grace?", fact_key: "writing_author" },
      perspective: { mode: "neutral", author: null, brand: null, label: null },
    } as never);
    const product = await import("@/lib/product");
    const basis = vi.spyOn(product, "createChatBasis");
    const submit = vi.spyOn(product, "submitChatDraft");

    const { state, executor: run } = executor("c4");
    await run("prepare_generation", { ...ARGS, perspective: "personal" });
    // INPUT CORRECTED: bound through the namespace, as every c4 handle is in
    // production. Writing `state.handles` directly built a map a prepare now
    // rebuilds from the namespace (it binds the piece's task facts there).
    state.namespace.set("K1", {
      atom_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      atom_type: "fact",
      text: "Membership costs 49.00 USD per month.",
    } as never);
    state.handles = state.namespace.asMap();
    const outcome = await run("submit_draft", DRAFT);

    expect(outcome.kind).toBe("rejected");
    expect((outcome as { reason: string }).reason).toMatch(/question to answer/);
    expect(basis).not.toHaveBeenCalled();
    expect(submit).not.toHaveBeenCalled();
  });

  it("lets the turn submit once a later prepare comes back ready", async () => {
    // The client answered; the model prepared again. The LATEST prepare decides.
    const product = await import("@/lib/product");
    vi.spyOn(product, "createChatBasis").mockResolvedValue({
      basis_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    } as never);
    const submit = vi.spyOn(product, "submitChatDraft").mockResolvedValue({
      variants: [],
      payload: { outcome: "verified", variant_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" },
    } as never);

    const { state, executor: run } = executor("c4");
    vi.mocked(createChatContext).mockResolvedValue({ ...CONTEXT_V2, status: "answer_needed" } as never);
    await run("prepare_generation", { ...ARGS, perspective: "personal" });
    vi.mocked(createChatContext).mockResolvedValue(CONTEXT_V2 as never);
    await run("prepare_generation", { ...ARGS, perspective: "personal" });
    // INPUT CORRECTED: bound through the namespace, as every c4 handle is in
    // production. Writing `state.handles` directly built a map a prepare now
    // rebuilds from the namespace (it binds the piece's task facts there).
    state.namespace.set("K1", {
      atom_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      atom_type: "fact",
      text: "Membership costs 49.00 USD per month.",
    } as never);
    state.handles = state.namespace.asMap();
    await run("submit_draft", DRAFT);

    expect(submit).toHaveBeenCalledTimes(1);
  });
});

describe("a revise turn can keep the draft's citations", () => {
  /**
   * Cross-turn reuse. The model sees the transcript, not earlier turns' tool
   * results, so a revise turn held the draft's words and none of the handles
   * behind them. The server now lists the draft's citations its view still
   * binds; the runtime shows them and the model re-reads before citing, and
   * that re-read is what puts the handle in this turn's namespace.
   */
  const CLAIM = "Membership costs 49.00 USD per month.";
  const REVISED = {
    body: `${CLAIM} Join this week.`,
    title: "Membership price", // INPUT CORRECTED: main's Library title is required (C4 merged main)
    cited_atom_ids: [{ handle: "K1", quoted_span: CLAIM, claim_text: CLAIM }],
    agent_text: "Shorter, same price.",
  };
  const REVISE_CONTEXT = {
    ...CONTEXT_V2,
    selected_draft: {
      variant_id: "66666666-6666-4666-8666-666666666666",
      version_no: 1,
      body: `${CLAIM} Members also get the first year discounted.`,
      body_digest: "b".repeat(64),
      citations: [{ handle: "K1", claim_text: CLAIM }],
    },
  };

  async function reviseTurn() {
    vi.mocked(createChatContext).mockResolvedValue(REVISE_CONTEXT as never);
    const product = await import("@/lib/product");
    vi.spyOn(product, "createChatBasis").mockResolvedValue({
      basis_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    } as never);
    const submit = vi.spyOn(product, "submitChatDraft").mockResolvedValue({
      variants: [],
      payload: { outcome: "verified", variant_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" },
    } as never);
    const read = vi.spyOn(product, "createChatRead").mockResolvedValue({
      schema: "c4-tool-1",
      read_view: "c4v_abc",
      receipt: "R2",
      // The canonical exchange's K1 (contracts/read-exchange.json), complete:
      // the model-read schema is strict, and a partial payload is refused.
      items: [
        {
          handle: "K1",
          payload: {
            kind: "knowledge",
            handle: "K1",
            meaning_id: "offering.price",
            subject_label: "Membership",
            reported_claimant_label: null,
            modality: "asserted",
            statement: CLAIM,
            value: { kind: "quantity", amount: "49.00", currency: "USD", raw: "49.00 USD" },
            qualifications: [],
            epistemic: "confirmed",
            temporal: "current_supported",
            unresolved: [],
            support_handles: [],
            conflict_handles: [],
          },
        },
      ],
      sources: [],
      gaps: [],
      coverage: {
        extent: "selected",
        truncated: false,
        processing: "ready",
        retrieval: "ok",
        index_pending: false,
      },
      diagnostics: [],
      next_cursor: null,
    } as never);
    const { executor: run } = executor("c4");
    const prepared = await run("prepare_generation", { ...ARGS, operation: "revise" });
    return { run, prepared, submit, read };
  }

  it("shows the model what the draft cited, and how to keep it", async () => {
    const { prepared } = await reviseTurn();

    const shown = JSON.stringify(prepared);
    expect(shown).toContain('<citation handle=\\"K1\\">');
    expect(shown).toContain(CLAIM);
    // CHANGED FORM: HOW to keep it (re-read with inspect) is no longer inside
    // the tool result -- an instruction there is treated as untrusted -- but
    // in read_knowledge's own description, which this pins instead.
    expect(shown).not.toContain("inspect");
    const read = buildToolSpecs(C4_TOOL_NAMES, "c4").find((spec) => spec.name === "read_knowledge");
    expect(read?.description).toMatch(/must be re-read with inspect before you cite it again/);
  });

  it("holds a citation the turn has not re-read, before anything reaches the server", async () => {
    const { run, submit } = await reviseTurn();

    const outcome = await run("submit_draft", REVISED);

    expect(outcome.kind).toBe("rejected");
    expect((outcome as { reason: string }).reason).toMatch(/K1 is not one of the handles/);
    expect(submit).not.toHaveBeenCalled();
  });

  it("stores the revision once the handle is re-read, citing the same handle", async () => {
    const { run, submit, read } = await reviseTurn();

    const reread = await run("read_knowledge", { selector: "inspect", refs: ["K1"], purpose: "keep the price" });
    expect(reread.kind).toBe("ok");
    const outcome = await run("submit_draft", REVISED);

    expect(read).toHaveBeenCalledTimes(1);
    expect(outcome.kind).toBe("ok");
    const claims = (submit.mock.calls[0][2] as { claims: { bases: { handle: string }[] }[] }).claims;
    expect(claims[0].bases[0].handle).toBe("K1");
  });

  it("adds no citations block when the server listed none", async () => {
    vi.mocked(createChatContext).mockResolvedValue({
      ...REVISE_CONTEXT,
      selected_draft: { ...REVISE_CONTEXT.selected_draft, citations: [] },
    } as never);
    const { executor: run } = executor("c4");

    const prepared = await run("prepare_generation", { ...ARGS, operation: "revise" });

    expect(JSON.stringify(prepared)).not.toContain("draft-citations");
  });
});

describe("the client's confirmed facts stay citable across turns", () => {
  /**
   * The final outside sign-off. A `TA{n}` was citable only in the turn
   * `use_task_material` issued it; nothing reissued the piece's facts, so a
   * revision could not keep the client's own correction as support. The
   * server now sends the piece's facts on every prepare, and the executor
   * binds them.
   */
  const FACT = "our programme is the Thursday evening intensive";
  const WITH_FACT = {
    ...CONTEXT_V2,
    task_assertions: [{ handle: "TA1", text: FACT }],
    selected_draft: {
      variant_id: "66666666-6666-4666-8666-666666666666",
      version_no: 1,
      body: `Big news: ${FACT}.`,
      body_digest: "c".repeat(64),
      citations: [{ handle: "TA1", claim_text: FACT }],
    },
  };
  const DRAFT = {
    body: `News: ${FACT}.`,
    title: "Membership price", // INPUT CORRECTED: main's Library title is required (C4 merged main)
    cited_atom_ids: [{ handle: "TA1", quoted_span: FACT, claim_text: FACT }],
    agent_text: "Shorter.",
  };

  async function submitting() {
    const product = await import("@/lib/product");
    vi.spyOn(product, "createChatBasis").mockResolvedValue({
      basis_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    } as never);
    return vi.spyOn(product, "submitChatDraft").mockResolvedValue({
      variants: [],
      payload: { outcome: "verified", variant_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" },
    } as never);
  }

  it("keeps a fact citation on a revise turn, without a re-read", async () => {
    vi.mocked(createChatContext).mockResolvedValue(WITH_FACT as never);
    const submit = await submitting();
    const { executor: run } = executor("c4");

    const prepared = await run("prepare_generation", { ...ARGS, operation: "revise" });
    const outcome = await run("submit_draft", DRAFT);

    expect(JSON.stringify(prepared)).toContain('<fact handle=\\"TA1\\">');
    expect(outcome.kind).toBe("ok");
    const claims = (submit.mock.calls[0][2] as { claims: { bases: { basis_kind: string; handle: string }[] }[] }).claims;
    expect(claims[0].bases[0]).toMatchObject({ basis_kind: "task_assertion", handle: "TA1" });
  });

  it("never tells the model to inspect a fact, which has no read", async () => {
    vi.mocked(createChatContext).mockResolvedValue(WITH_FACT as never);
    const { executor: run } = executor("c4");

    const prepared = await run("prepare_generation", { ...ARGS, operation: "revise" });

    expect(JSON.stringify(prepared)).not.toContain("inspect");
  });

  it("still holds a fact the server did not send", async () => {
    vi.mocked(createChatContext).mockResolvedValue({ ...WITH_FACT, task_assertions: [] } as never);
    const submit = await submitting();
    const { executor: run } = executor("c4");

    await run("prepare_generation", { ...ARGS, operation: "revise" });
    const outcome = await run("submit_draft", DRAFT);

    expect(outcome.kind).toBe("rejected");
    expect(submit).not.toHaveBeenCalled();
  });
});

describe("an unquoted citation reaches the server as a null quote", () => {
  // §7.2's null-quote path, through the LIVE executor rather than the
  // builder alone: contracts section 5 permits attributed paraphrase, and
  // preflight used to refuse it before the builder ever ran.
  it("stores a paraphrase cited without a quote", async () => {
    const product = await import("@/lib/product");
    vi.spyOn(product, "createChatBasis").mockResolvedValue({
      basis_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    } as never);
    const submit = vi.spyOn(product, "submitChatDraft").mockResolvedValue({
      variants: [],
      payload: { outcome: "verified", variant_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" },
    } as never);
    const { state, executor: run } = executor("c4");
    await run("prepare_generation", ARGS);
    state.namespace.set("K1", {
      atom_id: "K1",
      atom_type: "knowledge",
      text: "Membership costs 49.00 USD per month.",
      trust: "untrusted",
    });
    state.handles = state.namespace.asMap();

    const outcome = await run("submit_draft", {
      body: "Joining is 49 dollars a month.",
      title: "Membership price", // INPUT CORRECTED: main's Library title is required (C4 merged main)
      cited_atom_ids: [{ handle: "K1", quoted_span: "", claim_text: "Joining is 49 dollars a month." }],
      agent_text: "Here it is.",
    });

    expect(outcome.kind).toBe("ok");
    const claims = (submit.mock.calls[0][2] as { claims: { bases: { quoted_text: string | null }[] }[] }).claims;
    expect(claims[0].bases[0].quoted_text).toBeNull();
  });
});
