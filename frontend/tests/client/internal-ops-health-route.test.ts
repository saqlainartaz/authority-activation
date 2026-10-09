import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { opsHealth } from "./ops-health-fixture";
import { json } from "./limits-backend-stub";

/**
 * Cycle 5 P3.3: the operator System health BFF route, `GET /api/internal/ops/health`.
 * The real route handler; only the backend (`fetch`) is faked. The rules under test:
 * - the passcode is checked first: without it, 401 and the backend is never called;
 * - the backend is called with the service key, at `GET /v2/ops/health`;
 * - under M1 the backend's 404 `not_available` passes through;
 * - a backend 5xx keeps its status with a safe sentence; a lost backend is 502.
 */
const PASS = { "x-internal-passcode": "letmein" };
const route = () => import("@/app/api/internal/ops/health/route");

describe("operator System health BFF route", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("ENGINE_URL", "https://engine.test");
    vi.stubEnv("ENGINE_SERVICE_KEY", "service-key");
    vi.stubEnv("INTERNAL_PASSCODE", "letmein");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("checks the passcode first: a missing or wrong one is 401 and the backend is never called", async () => {
    const backend = vi.fn(async () => json(opsHealth()));
    vi.stubGlobal("fetch", backend);
    const { GET } = await route();

    const missing = await GET(new Request("https://app.test/api/internal/ops/health"));
    const wrong = await GET(new Request("https://app.test/api/internal/ops/health", { headers: { "x-internal-passcode": "nope" } }));

    expect([missing.status, wrong.status]).toEqual([401, 401]);
    expect(backend).not.toHaveBeenCalled();
  });

  it("reads GET /v2/ops/health with the service key and passes the reply through", async () => {
    const backend = vi.fn(async (_url: string, _init?: RequestInit) => json(opsHealth()));
    vi.stubGlobal("fetch", backend);
    const { GET } = await route();

    const response = await GET(new Request("https://app.test/api/internal/ops/health", { headers: PASS }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(opsHealth());
    expect(backend).toHaveBeenCalledTimes(1);
    const [url, init] = backend.mock.calls[0];
    expect(url).toBe("https://engine.test/v2/ops/health");
    expect((init?.headers as Record<string, string>)["X-API-Key"]).toBe("service-key");
    expect(init?.method ?? "GET").toBe("GET");
    // The browser's passcode is never forwarded to the backend.
    expect(JSON.stringify(init?.headers)).not.toContain("letmein");
  });

  it("passes M1's 404 not_available through", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ detail: "not_available" }, 404)));
    const { GET } = await route();

    const response = await GET(new Request("https://app.test/api/internal/ops/health", { headers: PASS }));

    expect(response.status).toBe(404);
    expect((await response.json()).detail).toBe("not_available");
  });

  it("forwards a backend 5xx with its status and a safe sentence, never the backend's text", async () => {
    for (const status of [500, 503]) {
      vi.stubGlobal("fetch", vi.fn(async () => json({ detail: "ops_health_unavailable: secret internals" }, status)));
      const { GET } = await route();

      const response = await GET(new Request("https://app.test/api/internal/ops/health", { headers: PASS }));

      expect(response.status).toBe(status);
      const body = await response.json();
      expect(body.error).toBe("Something broke on our side. Nothing was saved — try again.");
      expect(JSON.stringify(body)).not.toContain("secret internals");
      vi.resetModules();
    }
  });

  it("answers 502 when the backend cannot be reached", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("fetch failed"); }));
    const { GET } = await route();

    const response = await GET(new Request("https://app.test/api/internal/ops/health", { headers: PASS }));

    expect(response.status).toBe(502);
  });
});
