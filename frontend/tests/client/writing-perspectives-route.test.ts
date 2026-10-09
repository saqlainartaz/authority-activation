import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Cycle 5 P5.3 (Ruling 68): `/api/client/writing-perspectives` ->
 * `/v1/clients/me/writing-perspectives`, the voice card's picker. The real route
 * and `lib/product` client; only the session cookie and the backend are faked.
 */

const session = vi.hoisted(() => ({ token: "session-token" as string | null }));

vi.mock("@/lib/client-session", () => ({
  clientToken: async () => session.token,
}));

const OPTIONS = {
  authors: [{ ref: { kind: "entity", id: "8b1c1f8e-0000-4000-8000-000000000007", revision: 1 }, label: "Ada Lovelace" }],
  brands: [],
};

describe("/api/client/writing-perspectives", () => {
  beforeEach(() => {
    vi.resetModules();
    session.token = "session-token";
    vi.stubEnv("ENGINE_URL", "https://engine.test");
    vi.stubEnv("ENGINE_SERVICE_KEY", "service-key");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("forwards the session's own credential and nothing else, and returns the options", async () => {
    const sent: Array<{ url: string; init: RequestInit }> = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string | URL, init: RequestInit = {}) => {
      sent.push({ url: String(url), init });
      return new Response(JSON.stringify(OPTIONS), { status: 200, headers: { "Content-Type": "application/json" } });
    }));

    const response = await (await import("@/app/api/client/writing-perspectives/route")).GET();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(OPTIONS);
    expect(sent).toHaveLength(1);
    expect(sent[0].url).toBe("https://engine.test/v1/clients/me/writing-perspectives");
    expect(sent[0].init.headers).toEqual({ "X-API-Key": "service-key", "X-Onboarding-Token": "session-token" });
  });

  it("answers 401 without calling the backend when there is no session", async () => {
    session.token = null;
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);

    const response = await (await import("@/app/api/client/writing-perspectives/route")).GET();

    expect(response.status).toBe(401);
    expect(fetch).not.toHaveBeenCalled();
  });
});
