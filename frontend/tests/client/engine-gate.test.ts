import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Task P0.3: `lib/engine-gate.ts` is the single import point later Cycle 5
 * tasks use to ask "does this deployment run the rehaul engine?" — delegating
 * to the two switches that already exist rather than repeating either check.
 * `rehaulEnabledForClient` asks `GET /v1/me` (client identity, via
 * `lib/product.ts`'s `usesKnowledgeEngine`/`getMe`); `rehaulEnabledForOperator`
 * asks `GET /v2/engine` (service key only, via `lib/engine.ts`'s
 * `deploymentUsesKnowledgeEngine`, which treats a 404 as M1). Both env vars are
 * read at module scope by `product.ts`/`engine.ts`, hence the stub before a
 * dynamic import — same pattern as `tests/client/internal-knowledge-switch.test.ts`.
 */
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("engine-gate: the single rehaul-switch import point", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("ENGINE_URL", "https://engine.test");
    vi.stubEnv("ENGINE_SERVICE_KEY", "service-key");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  describe("rehaulEnabledForClient", () => {
    it("is true when /v1/me says ke", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () =>
          json({ client_id: "c1", user_id: "u1", onboarding_complete: true, knowledge_engine: "ke" }),
        ),
      );
      const { rehaulEnabledForClient } = await import("@/lib/engine-gate");

      expect(await rehaulEnabledForClient("tok")).toBe(true);
    });

    it("is false when /v1/me says m1", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () =>
          json({ client_id: "c1", user_id: "u1", onboarding_complete: true, knowledge_engine: "m1" }),
        ),
      );
      const { rehaulEnabledForClient } = await import("@/lib/engine-gate");

      expect(await rehaulEnabledForClient("tok")).toBe(false);
    });

    it("is false when /v1/me omits the field (an older backend)", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => json({ client_id: "c1", user_id: "u1", onboarding_complete: true })),
      );
      const { rehaulEnabledForClient } = await import("@/lib/engine-gate");

      expect(await rehaulEnabledForClient("tok")).toBe(false);
    });
  });

  describe("rehaulEnabledForOperator", () => {
    it("is true when /v2/engine says ke", async () => {
      vi.stubGlobal("fetch", vi.fn(async () => json({ knowledge_engine: "ke" })));
      const { rehaulEnabledForOperator } = await import("@/lib/engine-gate");

      expect(await rehaulEnabledForOperator()).toBe(true);
    });

    it("is false when /v2/engine says m1", async () => {
      vi.stubGlobal("fetch", vi.fn(async () => json({ knowledge_engine: "m1" })));
      const { rehaulEnabledForOperator } = await import("@/lib/engine-gate");

      expect(await rehaulEnabledForOperator()).toBe(false);
    });

    it("is false when /v2/engine 404s (an older backend)", async () => {
      vi.stubGlobal("fetch", vi.fn(async () => json({ detail: "Not Found" }, 404)));
      const { rehaulEnabledForOperator } = await import("@/lib/engine-gate");

      expect(await rehaulEnabledForOperator()).toBe(false);
    });
  });
});
