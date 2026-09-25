import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Clients created from /internal start in America/New_York. The operator
 * screen has no timezone field, and the backend's own default is
 * Europe/London, so createClient states the zone explicitly. `ENGINE_URL` is
 * read at module scope, hence the env stub before a dynamic import.
 */
describe("createClient default timezone", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("ENGINE_URL", "https://engine.test");
    vi.stubEnv("ENGINE_SERVICE_KEY", "service-key");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("sends America/New_York with the new client's name", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ id: "c1", name: "Rudy Mawer", timezone: "America/New_York" }), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const { createClient, DEFAULT_CLIENT_TIMEZONE } = await import("@/lib/engine");

    await createClient("Rudy Mawer");

    expect(DEFAULT_CLIENT_TIMEZONE).toBe("America/New_York");
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://engine.test/v1/clients");
    expect(JSON.parse(String(init.body))).toEqual({ name: "Rudy Mawer", timezone: "America/New_York" });
  });
});
