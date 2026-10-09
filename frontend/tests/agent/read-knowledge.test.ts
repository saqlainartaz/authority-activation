import { beforeEach, describe, expect, it, vi } from "vitest";

import { inputSchemaFor } from "@/agent/lib/tool-schemas";

vi.mock("@/lib/product", () => ({
  createChatRead: vi.fn(),
  ProductHttpError: class extends Error {},
  safeProductSentence: () => "",
}));

const { createChatRead } = await import("@/lib/product");
const { readKnowledge, ReadKnowledgeArgumentError } = await import(
  "@/agent/tools/read-knowledge"
);

/**
 * `read_knowledge`: what the model may ask for, and what it structurally cannot.
 *
 * The negative assertions carry most of the weight. A model that could supply
 * `read_view` could name someone else's view; one that could supply
 * `client_id` could name another tenant. Neither is prevented by a validator
 * here — they are prevented by there being nowhere to put them, which is the
 * guarantee §3 asks for and the one that survives a refactor.
 */

const CONTEXT = {
  sessionId: "11111111-1111-4111-8111-111111111111",
  turnId: "22222222-2222-4222-8222-222222222222",
  token: "token",
  handles: new Map(),
  skillVersions: [],
} as never;

beforeEach(() => {
  // Cleared between tests, because every assertion below reads
  // `mock.calls[0]` — without this, one test reads another's request and the
  // failure points at the wrong place.
  vi.clearAllMocks();
});

function result(overrides: Record<string, unknown> = {}) {
  return {
    schema: "c4-tool-1",
    read_view: "c4v_abc",
    receipt: "R1",
    items: [],
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
    ...overrides,
  };
}

describe("the read_knowledge tool schema", () => {
  it("gives the model no way to name a view, a tenant or a budget", () => {
    const shape = Object.keys(
      (inputSchemaFor("read_knowledge") as never as { shape: object }).shape,
    );

    expect(shape).not.toContain("read_view");
    expect(shape).not.toContain("client_id");
    expect(shape).not.toContain("idempotency_key");
    expect(shape).not.toContain("budget");
  });

  it("accepts the four selectors and nothing else", () => {
    const schema = inputSchemaFor("read_knowledge");
    for (const selector of ["orient", "find", "inspect", "exact"]) {
      expect(schema.safeParse({ selector, purpose: "write a post" }).success).toBe(true);
    }
    expect(schema.safeParse({ selector: "browse", purpose: "x" }).success).toBe(false);
  });
});

describe("building the request", () => {
  it("sends an orient read", async () => {
    vi.mocked(createChatRead).mockResolvedValueOnce(result());

    await readKnowledge({ selector: "orient", purpose: "orient first" }, CONTEXT);

    const [, , body] = vi.mocked(createChatRead).mock.calls[0];
    expect(body.request.selector).toEqual({ kind: "orient" });
    expect(body.request.scope.purpose).toBe("orient first");
    expect(body.idempotency_key).toBeTruthy();
  });

  it("never sends a read_view, because the server injects it", async () => {
    vi.mocked(createChatRead).mockResolvedValueOnce(result());

    await readKnowledge({ selector: "orient", purpose: "p" }, CONTEXT);

    const [, , body] = vi.mocked(createChatRead).mock.calls[0];
    expect(body.request).not.toHaveProperty("read_view");
  });

  it("sends empty subjects, meaning every AUTHORIZED subject, never every tenant", async () => {
    vi.mocked(createChatRead).mockResolvedValueOnce(result());

    await readKnowledge({ selector: "orient", purpose: "p" }, CONTEXT);

    const [, , body] = vi.mocked(createChatRead).mock.calls[0];
    expect(body.request.scope.subjects).toEqual([]);
  });

  it("refuses a find with no query, naming the missing field", async () => {
    // A bare 422 from Python tells the model nothing it can act on.
    await expect(
      readKnowledge({ selector: "find", purpose: "p" }, CONTEXT),
    ).rejects.toThrow(ReadKnowledgeArgumentError);
  });

  it("refuses an exact with no meaning_id", async () => {
    await expect(
      readKnowledge({ selector: "exact", purpose: "p" }, CONTEXT),
    ).rejects.toThrow(/meaning_id/);
  });

  it("refuses a find narrowed by a meaning it cannot apply, and says to use exact", async () => {
    // find searches source text, which carries no meanings; the server now
    // refuses the combination (final outside sign-off). Said before the round
    // trip, in words the model can act on.
    await expect(
      readKnowledge(
        { selector: "find", purpose: "p", query: "price", meaning_id: "offering.price" },
        CONTEXT,
      ),
    ).rejects.toThrow(/use exact/);
    expect(createChatRead).not.toHaveBeenCalled();
  });

  it("refuses an inspect with no refs", async () => {
    await expect(
      readKnowledge({ selector: "inspect", purpose: "p", refs: [] }, CONTEXT),
    ).rejects.toThrow(/at least one ref/);
  });

  it("defaults find to focused breadth", async () => {
    vi.mocked(createChatRead).mockResolvedValueOnce(result());

    await readKnowledge({ selector: "find", purpose: "p", query: "pricing" }, CONTEXT);

    const [, , body] = vi.mocked(createChatRead).mock.calls[0];
    expect(body.request.selector).toMatchObject({ kind: "find", breadth: "focused" });
  });
});

describe("the result is validated, not trusted", () => {
  it("parses a well-formed result", async () => {
    vi.mocked(createChatRead).mockResolvedValueOnce(result());

    const parsed = await readKnowledge({ selector: "orient", purpose: "p" }, CONTEXT);

    expect(parsed.read_view).toBe("c4v_abc");
    expect(parsed.coverage.extent).toBe("selected");
  });

  it("rejects a result claiming exhaustive coverage while paging", async () => {
    // The reason parsing matters rather than casting: the agent reads
    // `extent` to decide whether to search again, and a malformed envelope
    // would let it read a completeness claim the server never made.
    vi.mocked(createChatRead).mockResolvedValueOnce(
      result({
        coverage: {
          extent: "exhaustive",
          truncated: false,
          processing: "ready",
          retrieval: "ok",
          index_pending: false,
        },
        next_cursor: "page-2",
      }),
    );

    await expect(
      readKnowledge({ selector: "orient", purpose: "p" }, CONTEXT),
    ).rejects.toThrow();
  });

  it("rejects a result carrying an unknown field", async () => {
    vi.mocked(createChatRead).mockResolvedValueOnce(result({ surprise: true }));

    await expect(
      readKnowledge({ selector: "orient", purpose: "p" }, CONTEXT),
    ).rejects.toThrow();
  });
});

describe("continuing a search", () => {
  /**
   * The final outside review: a truncated `find` returned `next_cursor`, the
   * model received it, and this tool hard-wired `cursor: null` with no field to
   * send it back in -- so every "there is more" was a dead end.
   */
  it("offers the model a cursor field", () => {
    const shape = Object.keys(
      (inputSchemaFor("read_knowledge") as never as { shape: object }).shape,
    );
    expect(shape).toContain("cursor");
  });

  it("sends the cursor the model was given", async () => {
    vi.mocked(createChatRead).mockResolvedValueOnce(result());

    await readKnowledge(
      { selector: "find", purpose: "more pricing", query: "pricing", cursor: "o=12.abcdef012345" },
      CONTEXT,
    );

    const [, , body] = vi.mocked(createChatRead).mock.calls[0];
    expect(body.request.cursor).toBe("o=12.abcdef012345");
  });

  it("sends no cursor when the model gave none", async () => {
    vi.mocked(createChatRead).mockResolvedValueOnce(result());

    await readKnowledge({ selector: "find", purpose: "pricing", query: "pricing" }, CONTEXT);

    const [, , body] = vi.mocked(createChatRead).mock.calls[0];
    expect(body.request.cursor).toBeNull();
  });
});
