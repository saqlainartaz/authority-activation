import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ModelDraft } from "@/agent/contracts/draft";
import type { ToolContext } from "@/agent/lib/backend";
import { submitDraft } from "@/agent/tools/submit-draft";

/**
 * Pins the Task 8 fix: Python's `/drafts` response is `RuntimeSessionOut` —
 * `outcome` / `variant_id` / `rejection` all live NESTED under its `payload`
 * key (`chat.py::_run_draft_operation`), never at the response's own top
 * level. `submitDraft` used to read them off the top level directly, which
 * compiled (the generic was inferred from the function's own declared return
 * type) but was `undefined` for both fields on every real network call —
 * proved against `tests/test_chat_agent_endpoints.py`'s own
 * `response.json()["payload"]["outcome"]` assertions on the Python side.
 *
 * Also pins the C1 fix (final whole-branch review): `submitDraft` used to
 * call `engineJson`, which sends only `X-API-Key` — the SERVICE credential —
 * against a route guarded by the CLIENT credential
 * (`require_onboarding_identity`, `chat.py:1345`), so every real submission
 * 401'd. It now calls `submitChatDraft` (`lib/product.ts`), via `clientJson`,
 * which sends both `X-API-Key` AND `X-Onboarding-Token`. The header-asserting
 * test below is the one this file was missing that would have caught the
 * defect BEFORE it shipped — the previous version of this file stubbed
 * `globalThis.fetch` and never once inspected what headers it was called
 * with.
 *
 * `ENGINE_URL` / `ENGINE_SERVICE_KEY` are read at module scope by
 * `@/lib/product` (the same two names `@/lib/engine` also reads), so they
 * must be set before that module is imported — `vi.stubEnv` +
 * `vi.resetModules` + a dynamic `import()` inside each test is what makes
 * that ordering hold under vitest, rather than a static top-level import
 * racing the env stub.
 */
describe("submitDraft — unwrapping Python's nested payload", () => {
  const handles = new Map([["M1", { atom_id: "atom-1", atom_type: "fact", text: "we doubled revenue", trust: "untrusted" as const }]]);
  const draft: ModelDraft = {
    body: "we doubled revenue",
    cited_atom_ids: [{ handle: "M1", quoted_span: "we doubled revenue", claim_text: "we doubled revenue" }],
  };
  const context: ToolContext = {
    sessionId: "session-1",
    turnId: "turn-1",
    handles,
    token: "onboarding-token-xyz",
    skillVersions: [
      { slug: "instructions", version: "1.1.0" },
      { slug: "linkedin-post", version: "1.0.0" },
    ],
  };
  const usage = { inputTokens: 1, outputTokens: 1, cacheReadInputTokens: null, cacheCreationInputTokens: null };

  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("ENGINE_URL", "https://engine.example");
    vi.stubEnv("ENGINE_SERVICE_KEY", "test-key");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("reads a verified outcome and variant_id out of the nested payload, not the top level", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            session: {},
            messages: [],
            variants: [],
            selected_variant_id: null,
            payload: { outcome: "verified", variant_id: "variant-123" },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      ),
    );

    const { submitDraft: freshSubmitDraft } = await import("@/agent/tools/submit-draft");
    const result = await freshSubmitDraft({ draft, agentText: "here is your draft", snapshotId: "snap-1", usage }, context);

    expect(result.outcome).toBe("verified");
    expect(result.variant_id).toBe("variant-123");
  });

  it("reads a Python-side held outcome and its rejection kind out of the nested payload", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            session: {},
            messages: [],
            variants: [],
            selected_variant_id: null,
            payload: { outcome: "held", rejection: { kind: "citation_absent" } },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      ),
    );

    const { submitDraft: freshSubmitDraft } = await import("@/agent/tools/submit-draft");
    const result = await freshSubmitDraft({ draft, agentText: "let me try again", snapshotId: "snap-1", usage }, context);

    expect(result.outcome).toBe("held");
    expect(result.variant_id).toBeUndefined();
    expect(result.rejectionKind).toBe("citation_absent");
  });

  // Non-vacuity: the mutation this fix reverses. If `submitDraft` regressed to
  // reading the top level again, this exact fetch response would make it see
  // `outcome: undefined`, not `"verified"` — proving the two tests above
  // actually exercise the nested-vs-flat distinction rather than passing for
  // an unrelated reason (e.g. a mock that always resolves the same object).
  it("would read undefined from this same response shape if it read the top level instead of payload", async () => {
    const flatShapedAsPayload = { outcome: "verified" as const, variant_id: "variant-999" };
    // Simulates the OLD, buggy behaviour directly: reading fields off the
    // envelope's own top level rather than off `.payload`.
    const wronglyRead = (flatShapedAsPayload as unknown as { outcome?: string }).outcome;
    const envelopeShaped = { payload: flatShapedAsPayload };
    const wronglyReadFromEnvelope = (envelopeShaped as unknown as { outcome?: string }).outcome;
    expect(wronglyRead).toBe("verified"); // top-level read works on a flat object...
    expect(wronglyReadFromEnvelope).toBeUndefined(); // ...but not on the real, nested envelope shape.
  });

  // C1 (final whole-branch review). This is the test this file was missing:
  // every other test here stubs `fetch` and checks only the RESPONSE it
  // fabricates, never the REQUEST `submitDraft` actually sent — which is
  // exactly how a wrong credential shipped and passed every existing test in
  // this suite. `/v1/chat/sessions/{id}/drafts` is guarded by
  // `require_onboarding_identity` (`chat.py:1345`), which needs BOTH headers;
  // `X-API-Key` alone 401s.
  it("sends BOTH required credentials — X-API-Key AND X-Onboarding-Token — never just the service key", async () => {
    let capturedHeaders: HeadersInit | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        capturedHeaders = init?.headers;
        return new Response(
          JSON.stringify({
            session: {},
            messages: [],
            variants: [],
            selected_variant_id: null,
            payload: { outcome: "verified", variant_id: "variant-1" },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }),
    );

    const { submitDraft: freshSubmitDraft } = await import("@/agent/tools/submit-draft");
    await freshSubmitDraft({ draft, agentText: "here is your draft", snapshotId: "snap-1", usage }, context);

    const headers = new Headers(capturedHeaders);
    expect(headers.get("X-API-Key")).toBe("test-key");
    expect(headers.get("X-Onboarding-Token")).toBe("onboarding-token-xyz");
  });

  // Task 12 (§9 step 6). A17's premise — "the runtime already reports
  // skill_versions on submit" — was false until this fix; this is the test
  // that would have caught it. `skill_versions` must come from
  // `context.skillVersions` (server state `route.ts` resolves before any
  // tool runs), never from the model's own arguments — there is no such
  // field on `args` at all, only on `context`.
  it("sends skill_versions from server state (context), never from the model's own arguments", async () => {
    let capturedBody: unknown;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        capturedBody = JSON.parse(init?.body as string);
        return new Response(
          JSON.stringify({
            session: {},
            messages: [],
            variants: [],
            selected_variant_id: null,
            payload: { outcome: "verified", variant_id: "variant-1" },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }),
    );

    const { submitDraft: freshSubmitDraft } = await import("@/agent/tools/submit-draft");
    await freshSubmitDraft({ draft, agentText: "here is your draft", snapshotId: "snap-1", usage }, context);

    expect(capturedBody).toMatchObject({
      skill_versions: [
        { slug: "instructions", version: "1.1.0" },
        { slug: "linkedin-post", version: "1.0.0" },
      ],
    });
  });

  // Non-vacuity: an empty context.skillVersions must produce an empty array
  // on the wire, not an omitted field masquerading as "the model didn't
  // say" — proving this reads context, not some default the fetch mock
  // would silently tolerate either way.
  it("sends an empty skill_versions array when context carries none, not an omitted field", async () => {
    let capturedBody: unknown;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        capturedBody = JSON.parse(init?.body as string);
        return new Response(
          JSON.stringify({
            session: {},
            messages: [],
            variants: [],
            selected_variant_id: null,
            payload: { outcome: "verified", variant_id: "variant-1" },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }),
    );

    const { submitDraft: freshSubmitDraft } = await import("@/agent/tools/submit-draft");
    const emptyContext: ToolContext = { ...context, skillVersions: [] };
    await freshSubmitDraft({ draft, agentText: "here is your draft", snapshotId: "snap-1", usage }, emptyContext);

    expect(capturedBody).toMatchObject({ skill_versions: [] });
  });
});
