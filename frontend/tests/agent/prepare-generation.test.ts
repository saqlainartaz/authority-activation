import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ToolContext } from "@/agent/lib/backend";

/**
 * C1 (final whole-branch review). `prepareGeneration` used to call
 * `engineJson`, which sends only `X-API-Key` (the SERVICE credential) —
 * against `/v1/chat/sessions/{id}/context`, guarded by
 * `require_onboarding_identity` (`src/product/api/chat.py:1306`), the CLIENT
 * credential (`X-API-Key` AND `X-Onboarding-Token`). `auth.py:330-331`
 * refuses outright on a missing token, so every real turn died at the FIRST
 * tool call. It now calls `createChatContext` (`lib/product.ts`), via
 * `clientJson`, which sends both headers.
 *
 * No test file existed for this tool before this fix — this is the one this
 * branch was missing, mirroring `submit-draft.test.ts`'s own new
 * header-asserting case for the sibling tool that shipped with the identical
 * defect.
 *
 * `ENGINE_URL` / `ENGINE_SERVICE_KEY` are read at module scope by
 * `@/lib/product`, so they must be set before that module is imported —
 * `vi.stubEnv` + `vi.resetModules` + a dynamic `import()` inside the test is
 * what makes that ordering hold under vitest.
 */
describe("prepareGeneration — sends the client credential, not the service one", () => {
  const context: ToolContext = {
    sessionId: "session-1",
    turnId: "turn-1",
    handles: new Map(),
    token: "onboarding-token-xyz",
    // Unread by this tool — only submit-draft.ts reads skillVersions.
    skillVersions: [],
  };

  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("ENGINE_URL", "https://engine.example");
    vi.stubEnv("ENGINE_SERVICE_KEY", "test-key");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("sends BOTH X-API-Key AND X-Onboarding-Token — never just the service key", async () => {
    let capturedHeaders: HeadersInit | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        capturedHeaders = init?.headers;
        return new Response(
          JSON.stringify({
            contract_version: "context.v1",
            snapshot_id: "snap-1",
            platform: "linkedin",
            status: "ready",
            question: null,
            subject: null,
            task: "write a post",
            voice: { tone: [], audience: null, do_phrases: [], avoid_phrases: [] },
            material: [],
            background: [],
            banned_phrases: [],
            gaps: [],
            conflicts: [],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }),
    );

    const { prepareGeneration } = await import("@/agent/tools/prepare-generation");
    const result = await prepareGeneration({ message: "write a post", operation: "generate" }, context);

    const headers = new Headers(capturedHeaders);
    expect(headers.get("X-API-Key")).toBe("test-key");
    expect(headers.get("X-Onboarding-Token")).toBe("onboarding-token-xyz");
    expect(result.snapshot_id).toBe("snap-1");
  });

  it("maps a resume message to the backend's explicit clarification field", async () => {
    let capturedBody = "";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        capturedBody = String(init?.body ?? "");
        return new Response(JSON.stringify({
          contract_version: "context.v1",
          snapshot_id: "snap-2",
          platform: "linkedin",
          status: "ready",
          question: null,
          subject: "the cohort result",
          task: "write a post",
          voice: { tone: [], audience: null, do_phrases: [], avoid_phrases: [] },
          material: [],
          background: [],
          banned_phrases: [],
          gaps: [],
          conflicts: [],
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }),
    );

    const { prepareGeneration } = await import("@/agent/tools/prepare-generation");
    await prepareGeneration({ message: "the cohort result", operation: "resume" }, context);

    expect(JSON.parse(capturedBody)).toMatchObject({
      message: "the cohort result",
      operation: "resume",
      clarification: "the cohort result",
    });
  });
});
