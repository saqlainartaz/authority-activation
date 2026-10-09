import { beforeEach, describe, expect, it, vi } from "vitest";

import { buildDraftPayloadV2 } from "@/agent/contracts/draft";
import type { ToolContext } from "@/agent/lib/backend";
import type { HandleMap } from "@/agent/render";

vi.mock("@/lib/product", () => ({
  createChatBasis: vi.fn(),
  submitChatDraft: vi.fn(),
  ProductHttpError: class extends Error {},
  safeProductSentence: () => "",
}));

const { createChatBasis, submitChatDraft } = await import("@/lib/product");
const { submitDraft, submitDraftC4 } = await import("@/agent/tools/submit-draft");

/**
 * The `c4-submit-1` submission, and the two things it must not do.
 *
 * It must not substitute a uuid for a handle: the server resolves handles
 * against the view that issued them, and a runtime-chosen uuid would name a
 * record the view may never have exposed.
 *
 * It must not submit before the basis exists. The basis is what the fence
 * rechecks; minting it after the draft would let the exposure set be written
 * by the thing it is supposed to constrain.
 */

// Declared separately and typed, rather than folded into an `as never`
// context: these tests pass the map to `buildDraftPayloadV2` directly, and
// `never` there means the compiler checks nothing about the one argument
// whose shape the whole file is about.
const HANDLES: HandleMap = new Map([
  ["K1", { atom_id: "K1", atom_type: "knowledge", text: "Membership costs 49.", trust: "untrusted" as const }],
  ["TA1", { atom_id: "TA1", atom_type: "task_assertion", text: "we moved to Thursday", trust: "untrusted" as const }],
]);

const CONTEXT = {
  sessionId: "11111111-1111-4111-8111-111111111111",
  turnId: "22222222-2222-4222-8222-222222222222",
  token: "token",
  handles: HANDLES,
  skillVersions: [],
} as unknown as ToolContext;

const USAGE = {
  inputTokens: 1,
  outputTokens: 1,
  cacheReadInputTokens: null,
  cacheCreationInputTokens: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(createChatBasis).mockResolvedValue({
    basis_id: "33333333-3333-4333-8333-333333333333",
    read_view: "c4v_abc",
    exposed_handles: ["K1", "TA1"],
  });
  vi.mocked(submitChatDraft).mockResolvedValue({
    payload: { outcome: "verified", variant_id: "44444444-4444-4444-8444-444444444444" },
  } as never);
});

describe("building the c4 payload", () => {
  const draft = {
    body: "Membership costs 49 a month.",
    cited_atom_ids: [
      { handle: "K1", quoted_span: "Membership costs 49.", claim_text: "Membership costs 49 a month" },
    ],
  };

  it("keeps the handle as a handle", () => {
    const payload = buildDraftPayloadV2(draft, HANDLES, {
      basisId: "b",
      agentText: "here you go",
      idempotencyKey: "k",
    });

    expect(payload.claims[0].bases[0].handle).toBe("K1");
    expect(JSON.stringify(payload)).not.toContain("atom_id");
    expect(payload.schema).toBe("c4-submit-1");
  });

  it("derives the basis kind from the material, not from the model", () => {
    // A model that could choose `read` for a task assertion would route its
    // own supplied fact through an eligibility fence that has nothing to
    // check it against.
    const payload = buildDraftPayloadV2(
      {
        body: "b",
        cited_atom_ids: [
          { handle: "K1", quoted_span: "x", claim_text: "a" },
          { handle: "TA1", quoted_span: "y", claim_text: "b" },
        ],
      },
      HANDLES,
      { basisId: "b", agentText: "t", idempotencyKey: "k" },
    );

    expect(payload.claims[0].bases[0].basis_kind).toBe("read");
    expect(payload.claims[1].bases[0].basis_kind).toBe("task_assertion");
  });

  it("sends a null quote rather than an empty string", () => {
    // Contracts section 5: a null quote permits attributed paraphrase. An
    // empty string would be a quote of nothing, which is a different claim.
    const payload = buildDraftPayloadV2(
      { body: "b", cited_atom_ids: [{ handle: "K1", quoted_span: "", claim_text: "a" }] },
      HANDLES,
      { basisId: "b", agentText: "t", idempotencyKey: "k" },
    );

    expect(payload.claims[0].bases[0].quoted_text).toBeNull();
  });

  it("throws on a handle this turn never held", () => {
    // Dropping it would send Python a draft with fewer claims than the model
    // made, and the fence would check a narrower set than was written from.
    expect(() =>
      buildDraftPayloadV2(
        { body: "b", cited_atom_ids: [{ handle: "K9", quoted_span: "x", claim_text: "a" }] },
        HANDLES,
        { basisId: "b", agentText: "t", idempotencyKey: "k" },
      ),
    ).toThrow(/K9/);
  });
});

describe("submitting under c4", () => {
  const args = {
    draft: {
      body: "Membership costs 49 a month.",
      cited_atom_ids: [
        { handle: "K1", quoted_span: "Membership costs 49.", claim_text: "Membership costs 49 a month" },
      ],
    },
    agentText: "Here is a draft grounded in your pricing.",
    usage: USAGE,
  };

  it("mints the basis before it submits", async () => {
    await submitDraftC4(args, CONTEXT);

    expect(createChatBasis).toHaveBeenCalledTimes(1);
    expect(submitChatDraft).toHaveBeenCalledTimes(1);
    const basisOrder = vi.mocked(createChatBasis).mock.invocationCallOrder[0];
    const submitOrder = vi.mocked(submitChatDraft).mock.invocationCallOrder[0];
    expect(basisOrder).toBeLessThan(submitOrder);
  });

  it("submits against the basis the server minted", async () => {
    await submitDraftC4(args, CONTEXT);

    const [, , body] = vi.mocked(submitChatDraft).mock.calls[0];
    expect(body).toMatchObject({
      schema: "c4-submit-1",
      basis_id: "33333333-3333-4333-8333-333333333333",
    });
  });

  it("never sends a snapshot id", async () => {
    // A c4 submission names a basis. A snapshot id riding along would give
    // Python two answers to "what was this written from".
    await submitDraftC4(args, CONTEXT);

    const [, , body] = vi.mocked(submitChatDraft).mock.calls[0];
    expect(JSON.stringify(body)).not.toContain("snapshot_id");
  });

  it("does not list the exposed handles itself", async () => {
    // The server reads them from its own view. A runtime that could list
    // them could widen its own basis with a handle it was never issued.
    await submitDraftC4(args, CONTEXT);

    const [, , basisBody] = vi.mocked(createChatBasis).mock.calls[0];
    expect(basisBody).not.toHaveProperty("exposed_handles");
    expect(basisBody).not.toHaveProperty("read_view");
  });

  it("holds locally on a citation the turn never held, with no round trip", async () => {
    const held = await submitDraftC4(
      {
        ...args,
        draft: { body: "b", cited_atom_ids: [{ handle: "K9", quoted_span: "xxxxxxxxx", claim_text: "a" }] },
      },
      CONTEXT,
    );

    expect(held.outcome).toBe("held");
    expect(createChatBasis).not.toHaveBeenCalled();
    expect(submitChatDraft).not.toHaveBeenCalled();
  });
});

describe("the v1 path is untouched", () => {
  it("still sends a snapshot id and real atom ids", async () => {
    const handles = new Map([
      ["M1", { atom_id: "55555555-5555-4555-8555-555555555555", atom_type: "insight", text: "Membership costs 49.", trust: "untrusted" }],
    ]) as unknown as HandleMap;

    await submitDraft(
      {
        draft: {
          body: "Membership costs 49 a month.",
          cited_atom_ids: [
            { handle: "M1", quoted_span: "Membership costs 49.", claim_text: "Membership costs 49 a month" },
          ],
        },
        // INPUT CORRECTED (C4 merged main): main's v1 submit requires a
        // Library title.
        title: "Membership price",
        agentText: "here you go",
        snapshotId: "66666666-6666-4666-8666-666666666666",
        usage: USAGE,
      },
      { ...CONTEXT, handles } as unknown as ToolContext,
    );

    const [, , body] = vi.mocked(submitChatDraft).mock.calls[0];
    expect(body).toMatchObject({ snapshot_id: "66666666-6666-4666-8666-666666666666" });
    expect(JSON.stringify(body)).toContain("55555555-5555-4555-8555-555555555555");
    expect(JSON.stringify(body)).not.toContain("c4-submit-1");
    expect(createChatBasis).not.toHaveBeenCalled();
  });
});

describe("a c4 draft carries its Library title (main's library lifecycle)", () => {
  const draft = {
    body: "Membership costs 49 a month.",
    cited_atom_ids: [{ handle: "K1", quoted_span: "Membership costs 49.", claim_text: "Membership costs 49 a month" }],
  };

  it("sends the title when there is one", () => {
    const payload = buildDraftPayloadV2(draft, HANDLES, {
      basisId: "b", agentText: "here you go", idempotencyKey: "k", title: "Membership price",
    });
    expect(payload.title).toBe("Membership price");
  });

  it("sends no title key at all when there is none, so old requests fingerprint as before", () => {
    const payload = buildDraftPayloadV2(draft, HANDLES, { basisId: "b", agentText: "here you go", idempotencyKey: "k" });
    expect(Object.keys(payload)).not.toContain("title");
  });
});
