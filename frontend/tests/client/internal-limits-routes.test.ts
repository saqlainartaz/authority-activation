import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { json, limitsBackend } from "./limits-backend-stub";

/**
 * Cycle 5 P2.5: the operator Limits BFF routes. Real route handlers; only the
 * backend (`fetch`) is faked. The rules under test (plan §3.2):
 * - extra uploads: the browser's `intent_key` is forwarded unchanged, and a retry
 *   with the same key sends the same key; the BFF never makes one up; a grant
 *   without a key is refused with 400 before the backend is called;
 * - a limits edit (PUT) is plain: no key is needed and none is forwarded (the edit
 *   replay was removed as over-engineered, 2026-10-08);
 * - `changed_by`/`granted_by` never reach the backend (it stamps its principal);
 * - the passcode gates every route; under M1 the routes answer 404.
 */
const PASS = { "x-internal-passcode": "letmein" };
const KEY = "0b7f3a52-5d0e-4c1f-9d55-2b3c4a5e6f70";
const params = { params: Promise.resolve({ clientId: "c1" }) } as never;

const routes = {
  limits: () => import("@/app/api/internal/clients/[clientId]/limits/route"),
  extra: () => import("@/app/api/internal/clients/[clientId]/limits/extra-uploads/route"),
  changes: () => import("@/app/api/internal/clients/[clientId]/limits/changes/route"),
  engine: () => import("@/app/api/internal/engine/route"),
};

const jsonRequest = (method: string, body: unknown, headers: Record<string, string> = PASS) =>
  new Request("https://app.test/api/internal/clients/c1/limits", {
    method, headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify(body),
  });

const extraBody = { extra_uploads: 10, reason: "Big onboarding pack" };
const editBody = { daily_limit_usd: 20, reason: "Bigger documents", expected_revision: 3 };

type Mutation = {
  name: string; call: (body: unknown) => Promise<Response>; body: Record<string, unknown>; path: string; keyed: boolean;
};

async function mutations(): Promise<Mutation[]> {
  const [limits, extra] = await Promise.all([routes.limits(), routes.extra()]);
  return [
    { name: "PUT limits", call: (body) => limits.PUT(jsonRequest("PUT", body), params), body: editBody, path: "/v2/clients/c1/limits", keyed: false },
    { name: "POST extra-uploads", call: (body) => extra.POST(jsonRequest("POST", body), params), body: extraBody, path: "/v2/clients/c1/limits/extra-uploads", keyed: true },
  ];
}

describe("operator Limits BFF routes", () => {
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

  it("reads the client's limits from the backend", async () => {
    const backend = limitsBackend();
    vi.stubGlobal("fetch", backend.fetch);
    const { GET } = await routes.limits();

    const response = await GET(new Request("https://app.test", { headers: PASS }), params);

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ revision: 3, monthly_uploads: 20, meters: { writing_monthly: { limit_usd: 50 } } });
  });

  it("forwards the browser's extra-uploads intent key unchanged, and the same key again on a retry", async () => {
    for (const mutation of (await mutations()).filter((each) => each.keyed)) {
      const backend = limitsBackend();
      vi.stubGlobal("fetch", backend.fetch);

      const first = await mutation.call({ ...mutation.body, intent_key: KEY });
      const retry = await mutation.call({ ...mutation.body, intent_key: KEY });

      expect(first.status, mutation.name).toBe(200);
      expect(retry.status, mutation.name).toBe(200);
      const sent = backend.state.calls.filter((call) => call.path === mutation.path);
      expect(sent.map((call) => call.body?.intent_key), mutation.name).toEqual([KEY, KEY]);
    }
  });

  it("refuses an extra-uploads grant without an intent key with 400, and never calls the backend", async () => {
    for (const mutation of (await mutations()).filter((each) => each.keyed)) {
      const backend = limitsBackend();
      vi.stubGlobal("fetch", backend.fetch);

      for (const key of [undefined, "", "   ", 42, "not-a-uuid"]) {
        const response = await mutation.call(key === undefined ? mutation.body : { ...mutation.body, intent_key: key });
        expect(response.status, `${mutation.name} with ${String(key)}`).toBe(400);
        expect((await response.json()).detail).toBe("intent_key_required");
      }
      expect(backend.fetch, mutation.name).not.toHaveBeenCalled();
    }
  });

  it("sends a limits edit with no intent key, and drops one the browser sends", async () => {
    const backend = limitsBackend();
    vi.stubGlobal("fetch", backend.fetch);
    const { PUT } = await routes.limits();

    const plain = await PUT(jsonRequest("PUT", editBody), params);
    const keyed = await PUT(jsonRequest("PUT", { ...editBody, expected_revision: 4, intent_key: KEY }), params);

    expect([plain.status, keyed.status]).toEqual([200, 200]);
    const sent = backend.state.calls.filter((call) => call.method === "PUT").map((call) => call.body);
    expect(sent).toEqual([editBody, { ...editBody, expected_revision: 4 }]);
  });

  it("refuses every route without the passcode with 401, and never calls the backend", async () => {
    const backend = limitsBackend();
    vi.stubGlobal("fetch", backend.fetch);
    const noPass = { "x-internal-passcode": "wrong" };
    const [limits, extra, changes, engine] = await Promise.all([
      routes.limits(), routes.extra(), routes.changes(), routes.engine(),
    ]);

    const responses = await Promise.all([
      limits.GET(new Request("https://app.test"), params),
      limits.PUT(jsonRequest("PUT", editBody, noPass), params),
      extra.POST(jsonRequest("POST", { ...extraBody, intent_key: KEY }, noPass), params),
      extra.POST(jsonRequest("POST", { ...extraBody, intent_key: KEY }, {}), params),
      changes.GET(new Request("https://app.test/x?limit=5", { headers: noPass }), params),
      engine.GET(new Request("https://app.test")),
    ]);

    expect(responses.map((response) => response.status)).toEqual([401, 401, 401, 401, 401, 401]);
    expect(backend.fetch).not.toHaveBeenCalled();
  });

  it("never sends changed_by or granted_by, even when the browser does", async () => {
    for (const mutation of await mutations()) {
      const backend = limitsBackend();
      vi.stubGlobal("fetch", backend.fetch);

      const key = mutation.keyed ? { intent_key: KEY } : {};
      const response = await mutation.call({
        ...mutation.body, ...key, changed_by: "Forged Name", granted_by: "Forged Name", actor: "Forged Name",
      });

      expect(response.status, mutation.name).toBe(200);
      const sent = backend.state.calls.find((call) => call.path === mutation.path)!.body!;
      expect(sent, mutation.name).toEqual({ ...mutation.body, ...key });
      expect(JSON.stringify(sent)).not.toContain("Forged Name");
    }
  });

  it("forwards only the settings an edit sent, keeping null for no monthly limit", async () => {
    const backend = limitsBackend();
    vi.stubGlobal("fetch", backend.fetch);
    const { PUT } = await routes.limits();

    await PUT(jsonRequest("PUT", { monthly_uploads: null, reason: "Unlimited for the pilot", expected_revision: 3 }), params);

    const sent = backend.state.calls.find((call) => call.method === "PUT")!.body!;
    expect(sent).toEqual({ monthly_uploads: null, reason: "Unlimited for the pilot", expected_revision: 3 });
    expect(Object.keys(sent)).not.toContain("daily_limit_usd");
  });

  it("passes the history page's before and limit through as they came", async () => {
    const backend = limitsBackend();
    vi.stubGlobal("fetch", backend.fetch);
    const { GET } = await routes.changes();
    const cursor = "MjAyNi0xMC0wNVQxMDowMDowMCswMDowMHwx==";

    const paged = await GET(new Request(`https://app.test/x?before=${encodeURIComponent(cursor)}&limit=5`, { headers: PASS }), params);
    const first = await GET(new Request("https://app.test/x", { headers: PASS }), params);

    expect(paged.status).toBe(200);
    expect(first.status).toBe(200);
    const paths = backend.state.calls.map((call) => call.path);
    expect(paths[0]).toBe(`/v2/clients/c1/limits/changes?before=${encodeURIComponent(cursor)}&limit=5`);
    expect(new URL(`https://x${paths[0]}`).searchParams.get("before")).toBe(cursor);
    expect(paths[1]).toBe("/v2/clients/c1/limits/changes");
  });

  it("passes a refusal's code through for the panel to explain", async () => {
    const backend = limitsBackend();
    vi.stubGlobal("fetch", backend.fetch);
    const { PUT } = await routes.limits();

    const response = await PUT(jsonRequest("PUT", { ...editBody, expected_revision: 2 }), params);

    expect(response.status).toBe(409);
    expect((await response.json()).detail).toBe("stale_limits");
  });

  it("is absent under M1: every route answers 404 and the backend's limits are never called", async () => {
    const backend = limitsBackend({ engine: "m1" });
    vi.stubGlobal("fetch", backend.fetch);
    const [limits, extra, changes, engine] = await Promise.all([
      routes.limits(), routes.extra(), routes.changes(), routes.engine(),
    ]);

    const responses = await Promise.all([
      limits.GET(new Request("https://app.test", { headers: PASS }), params),
      limits.PUT(jsonRequest("PUT", editBody), params),
      extra.POST(jsonRequest("POST", { ...extraBody, intent_key: KEY }), params),
      changes.GET(new Request("https://app.test/x", { headers: PASS }), params),
    ]);

    expect(responses.map((response) => response.status)).toEqual([404, 404, 404, 404]);
    expect(backend.state.calls).toEqual([]);
    expect(await (await engine.GET(new Request("https://app.test", { headers: PASS }))).json()).toEqual({ knowledge_engine: "m1" });
  });

  it("tells the console which engine runs, treating a backend without the switch as M1", async () => {
    vi.stubGlobal("fetch", limitsBackend({ engine: "ke" }).fetch);
    const ke = await routes.engine();
    expect(await (await ke.GET(new Request("https://app.test", { headers: PASS }))).json()).toEqual({ knowledge_engine: "ke" });

    vi.resetModules();
    vi.stubGlobal("fetch", vi.fn(async () => json({ detail: "Not Found" }, 404)));
    const missing = await routes.engine();
    expect(await (await missing.GET(new Request("https://app.test", { headers: PASS }))).json()).toEqual({ knowledge_engine: "m1" });
  });
});
