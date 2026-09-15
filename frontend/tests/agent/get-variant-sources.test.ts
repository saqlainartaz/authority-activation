import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ToolContext } from "@/agent/lib/backend";

/**
 * FIXED 2026-08-26, §9 step 6, task 13. From task 2 of this same step
 * (2026-08-25) to this task, `getVariantSources` threw unconditionally — the
 * `show_sources` command kind it posted to `/commands` was retired the same
 * step this tool was created, and no replacement route existed on the Python
 * side for six tasks and a day (see the tool's own file header for the full
 * account, and `get-variant-sources.test.ts`'s git history for the version of
 * this file that pinned the throw).
 *
 * The fix is `GET /v1/chat/sessions/{id}/variants/{variant_id}/sources`
 * (`src/product/api/chat.py::read_variant_sources`), and this pins the tool's
 * side of it: it calls `getChatVariantSources` (`@/lib/product`) with the
 * CLIENT credential — the same `clientJson`-not-`engineJson` defect class
 * `prepare-generation.test.ts` and `submit-draft.test.ts` already guard for
 * their own routes — and returns the sources verbatim, an empty list
 * included, without throwing.
 *
 * `ENGINE_URL` / `ENGINE_SERVICE_KEY` are read at module scope by
 * `@/lib/product`, so they must be set before that module is imported —
 * `vi.stubEnv` + `vi.resetModules` + a dynamic `import()` inside each test,
 * the same ordering `prepare-generation.test.ts` establishes.
 */
describe("getVariantSources — calls the real route and never stubs", () => {
  const context: ToolContext = {
    sessionId: "session-1",
    turnId: "turn-1",
    handles: new Map(),
    token: "onboarding-token-xyz",
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
    let capturedUrl = "";
    let capturedHeaders: HeadersInit | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        capturedUrl = url;
        capturedHeaders = init?.headers;
        return new Response(JSON.stringify({ sources: [{ source_label: "your interview" }] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }),
    );

    const { getVariantSources } = await import("@/agent/tools/get-variant-sources");
    const result = await getVariantSources({ variantId: "variant-1" }, context);

    const headers = new Headers(capturedHeaders);
    expect(headers.get("X-API-Key")).toBe("test-key");
    expect(headers.get("X-Onboarding-Token")).toBe("onboarding-token-xyz");
    expect(capturedUrl).toContain("/v1/chat/sessions/session-1/variants/variant-1/sources");
    expect(result).toEqual({ sources: [{ source_label: "your interview" }] });
  });

  it("returns an empty list as a real result, not as a thrown error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ sources: [] }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
      ),
    );

    const { getVariantSources } = await import("@/agent/tools/get-variant-sources");
    await expect(getVariantSources({ variantId: "variant-1" }, context)).resolves.toEqual({
      sources: [],
    });
  });

  it("returns ONLY { sources }, never a passthrough of the whole backend envelope", async () => {
    // The actual PROV-01 enforcement — no field a locator could ride — is a
    // Python-side property of `VariantSourceOut`, pinned there by
    // `test_the_runtime_source_route_discloses_labels_and_never_a_locator`.
    // This test covers the frontend's own, narrower obligation: the tool's
    // return statement is `{ sources: result.sources }`, not `result` itself,
    // so a backend response that grew an extra top-level key (a diagnostic
    // field, a request id) would not silently ride into the model's tool
    // result alongside it.
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              sources: [{ source_label: "your interview" }],
              request_id: "should never reach the model",
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
      ),
    );

    const { getVariantSources } = await import("@/agent/tools/get-variant-sources");
    const result = await getVariantSources({ variantId: "variant-1" }, context);
    expect(Object.keys(result)).toEqual(["sources"]);
  });
});
