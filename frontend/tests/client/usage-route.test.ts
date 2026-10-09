import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Cycle 5 P2.6: `GET /api/client/usage` -> `GET /v1/usage`. The real route and
 * the real `lib/product` client; only the session cookie and the backend
 * (`fetch`) are faked. The rules (spec 10A.4, A47):
 * - the session's own credential is forwarded, and nothing from the browser;
 * - `{"engine": "m1"}` passes through unchanged;
 * - a backend 503 (`usage_unavailable`) stays a 503, never zeros.
 */

const session = vi.hoisted(() => ({ token: "session-token" as string | null }));

vi.mock("@/lib/client-session", () => ({
  clientToken: async () => session.token,
}));

type Sent = { url: string; headers: Record<string, string> };

function backend(status: number, body: unknown) {
  const sent: Sent[] = [];
  const fetch = vi.fn(async (url: string | URL, init: RequestInit = {}) => {
    sent.push({ url: String(url), headers: { ...(init.headers as Record<string, string>) } });
    return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  });
  return { sent, fetch };
}

const KE = {
  engine: "ke",
  uploads: { month: "2026-10", base: 20, extra: 10, used: 18, remaining: 12, unlimited: false, resets_at: "2026-11-01T00:00:00+00:00" },
  writing: {
    today: { used_fraction: 0.42, available: true, resets_at: "2026-10-06T00:00:00+00:00" },
    month: { used_fraction: 0.18, available: true, resets_at: "2026-11-01T00:00:00+00:00" },
  },
  documents: { today: { used_fraction: 0.05, available: true, resets_at: "2026-10-06T00:00:00+00:00" } },
};

async function route() {
  return (await import("@/app/api/client/usage/route")).GET as unknown as (request?: Request) => Promise<Response>;
}

describe("GET /api/client/usage", () => {
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

  it("forwards the session's own credential to /v1/usage and returns the figures", async () => {
    const stub = backend(200, KE);
    vi.stubGlobal("fetch", stub.fetch);

    const response = await (await route())();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(KE);
    expect(stub.sent).toEqual([{
      url: "https://engine.test/v1/usage",
      headers: { "X-API-Key": "service-key", "X-Onboarding-Token": "session-token" },
    }]);
  });

  it("passes the M1 answer through unchanged", async () => {
    vi.stubGlobal("fetch", backend(200, { engine: "m1" }).fetch);

    const response = await (await route())();

    expect(response.status).toBe(200);
    expect(await response.text()).toBe('{"engine":"m1"}');
  });

  it("keeps a backend 503 a 503, with no figures in the body", async () => {
    vi.stubGlobal("fetch", backend(503, { detail: "usage_unavailable" }).fetch);

    const response = await (await route())();

    expect(response.status).toBe(503);
    const body = await response.json();
    expect(Object.keys(body)).toEqual(["error"]);
    expect(JSON.stringify(body)).not.toMatch(/used|fraction|remaining|\b0\b/);
  });

  it("never forwards a client id from the browser", async () => {
    const stub = backend(200, KE);
    vi.stubGlobal("fetch", stub.fetch);
    const GET = await route();

    await GET(new Request("https://app.test/api/client/usage?client_id=someone-else", {
      headers: { "x-client-id": "someone-else", cookie: "client_id=someone-else" },
    }));

    expect(stub.sent).toHaveLength(1);
    expect(stub.sent[0].url).toBe("https://engine.test/v1/usage");
    expect(JSON.stringify(stub.sent[0])).not.toContain("someone-else");
  });

  it("answers 401 without calling the backend when there is no session", async () => {
    session.token = null;
    const stub = backend(200, KE);
    vi.stubGlobal("fetch", stub.fetch);

    const response = await (await route())();

    expect(response.status).toBe(401);
    expect(stub.fetch).not.toHaveBeenCalled();
  });
});

describe("GET /api/client/engine (A47: the engine is known before Usage reads anything)", () => {
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

  const engineRoute = async () => (await import("@/app/api/client/engine/route")).GET;
  const ME = { client_id: "c-1", user_id: "u-1", onboarding_complete: true };

  it.each([
    ["ke", { ...ME, knowledge_engine: "ke" }, "ke", false],
    ["m1", { ...ME, knowledge_engine: "m1" }, "m1", false],
    ["an older backend", ME, "m1", false],
    // Cycle 5 P8.3: whether the credential is a signed-in session (Delete file is offered then).
    ["a signed-in member", { ...ME, knowledge_engine: "ke", signed_in: true }, "ke", true],
  ])("answers the engine for %s with the session's own credential, and nothing else from /v1/me", async (_name, me, engine, signedIn) => {
    const stub = backend(200, me);
    vi.stubGlobal("fetch", stub.fetch);

    const response = await (await engineRoute())();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ knowledge_engine: engine, signed_in: signedIn });
    expect(stub.sent).toEqual([{
      url: "https://engine.test/v1/me",
      headers: { "X-API-Key": "service-key", "X-Onboarding-Token": "session-token" },
    }]);
  });

  it("answers 401 without calling the backend when there is no session", async () => {
    session.token = null;
    const stub = backend(200, ME);
    vi.stubGlobal("fetch", stub.fetch);

    expect((await (await engineRoute())()).status).toBe(401);
    expect(stub.fetch).not.toHaveBeenCalled();
  });
});
