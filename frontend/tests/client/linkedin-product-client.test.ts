import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const TOKEN = "synthetic-session-token";
const KEY = "synthetic-service-key";

describe("LinkedIn product client wire boundary", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("ENGINE_URL", "https://engine.example.test");
    vi.stubEnv("ENGINE_SERVICE_KEY", KEY);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("sends both server-only credentials on OAuth start and exact callback", async () => {
    const fetchMock = vi.fn(async () => Response.json({
      authorization_url: "https://www.linkedin.com/oauth/v2/authorization?state=opaque",
      expires_at: "2026-09-23T12:10:00Z",
    }));
    vi.stubGlobal("fetch", fetchMock);
    const product = await import("@/lib/product");

    await product.startLinkedInOAuth(TOKEN);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://engine.example.test/v1/social/linkedin/oauth/start",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ "X-API-Key": KEY, "X-Onboarding-Token": TOKEN }),
        cache: "no-store",
      }),
    );

    fetchMock.mockResolvedValueOnce(Response.json({ id: "account-id" }));
    await product.completeLinkedInOAuth(TOKEN, "one-use-code", "one-use-state");
    expect(fetchMock).toHaveBeenLastCalledWith(
      "https://engine.example.test/v1/social/linkedin/oauth/callback",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "X-API-Key": KEY,
          "X-Onboarding-Token": TOKEN,
          "Content-Type": "application/json",
        }),
        body: JSON.stringify({ code: "one-use-code", state: "one-use-state" }),
        cache: "no-store",
      }),
    );
  });

  it("maps publish-now to the version-bound backend route with one idempotency key", async () => {
    const fetchMock = vi.fn(async () => Response.json({ id: "publication-id", status: "queued" }));
    vi.stubGlobal("fetch", fetchMock);
    const product = await import("@/lib/product");

    await product.publishContentItemNow(TOKEN, "e927cf12-1699-4690-8775-7c4761c88449", "click-12345678");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://engine.example.test/v1/content-items/e927cf12-1699-4690-8775-7c4761c88449/publish",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ "X-API-Key": KEY, "X-Onboarding-Token": TOKEN }),
        body: JSON.stringify({ idempotency_key: "click-12345678" }),
        cache: "no-store",
      }),
    );
  });

  it("changes auto-publish through the server-only account route", async () => {
    const fetchMock = vi.fn(async () => Response.json({ id: "account-id", auto_publish_enabled: false }));
    vi.stubGlobal("fetch", fetchMock);
    const product = await import("@/lib/product");
    await product.setSocialAutoPublish(TOKEN, "account-id", false);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://engine.example.test/v1/social/accounts/account-id/auto-publish",
      expect.objectContaining({
        method: "PATCH",
        headers: expect.objectContaining({ "X-API-Key": KEY, "X-Onboarding-Token": TOKEN }),
        body: JSON.stringify({ enabled: false }),
        cache: "no-store",
      }),
    );
  });
});
