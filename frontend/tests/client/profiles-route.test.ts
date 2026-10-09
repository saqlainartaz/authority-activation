import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Cycle 5 P9.3/P9.4: `/api/client/profiles` -> `/v1/profiles` and
 * `/api/client/profiles/{id}/dna` -> `/v1/profiles/{id}/dna`. The real routes and
 * `lib/product` client; only the session cookie and the backend are faked.
 */

const session = vi.hoisted(() => ({ token: "session-token" as string | null }));

vi.mock("@/lib/client-session", () => ({
  clientToken: async () => session.token,
}));

const PROFILE_ID = "11111111-1111-4111-8111-111111111111";
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const params = (profileId: string) => ({ params: Promise.resolve({ profileId }) });

describe("/api/client/profiles", () => {
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

  it("lists the permitted profiles with the session's own credential", async () => {
    const sent: Array<{ url: string; init: RequestInit }> = [];
    const body = { profiles: [{ id: "account", name: "Acme", kind: "account" }] };
    vi.stubGlobal("fetch", vi.fn(async (url: string | URL, init: RequestInit = {}) => {
      sent.push({ url: String(url), init });
      return json(body);
    }));

    const response = await (await import("@/app/api/client/profiles/route")).GET();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(body);
    expect(sent.map(call => call.url)).toEqual(["https://engine.test/v1/profiles"]);
    expect(sent[0].init.headers).toEqual({ "X-API-Key": "service-key", "X-Onboarding-Token": "session-token" });
  });

  it("reads one profile's DNA, and keeps the backend's 404 for one no longer permitted", async () => {
    const sent: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string | URL) => {
      sent.push(String(url));
      return String(url).endsWith("/account/dna")
        ? json({ profile: { id: "account", name: "Acme", kind: "account" }, sections: [], relationships: [], empty: true })
        : json({ detail: "profile_not_found" }, 404);
    }));
    const { GET } = await import("@/app/api/client/profiles/[profileId]/dna/route");

    expect((await GET(new Request("http://x"), params("account"))).status).toBe(200);
    const revoked = await GET(new Request("http://x"), params(PROFILE_ID));
    expect(revoked.status).toBe(404);
    expect((await revoked.json()).detail).toBe("profile_not_found");
    expect(sent).toEqual([
      "https://engine.test/v1/profiles/account/dna", `https://engine.test/v1/profiles/${PROFILE_ID}/dna`]);
  });

  it("answers 404 for an id that is neither a profile id nor the account, without calling the backend", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const { GET } = await import("@/app/api/client/profiles/[profileId]/dna/route");

    for (const bad of ["../v1/me", "account%2F..", "not-an-id"]) {
      expect((await GET(new Request("http://x"), params(bad))).status).toBe(404);
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it("answers 401 without calling the backend when there is no session", async () => {
    session.token = null;
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);

    expect((await (await import("@/app/api/client/profiles/route")).GET()).status).toBe(401);
    const { GET } = await import("@/app/api/client/profiles/[profileId]/dna/route");
    expect((await GET(new Request("http://x"), params("account"))).status).toBe(401);
    expect(fetch).not.toHaveBeenCalled();
  });
});
