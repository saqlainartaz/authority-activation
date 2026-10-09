import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Cycle 5 P5.1: `/api/client/writing-settings` -> `/v1/clients/me/writing-settings`
 * (spec 6, D06, A16). The real route and the real `lib/product` client; only the
 * session cookie and the backend (`fetch`) are faked. The rules:
 * - GET, PUT and DELETE forward with the session's own credential;
 * - only `text` and the two `expected_*` values cross from the browser, so a
 *   client id, an actor, a perspective or anything else in the body or query
 *   never reaches the backend (one general text, D06: separate guidance per
 *   voice was removed as over-engineered, 2026-10-08);
 * - a 409 `stale_revision` keeps its status and its `detail` object;
 * - no session is a 401 without a backend call.
 */

const session = vi.hoisted(() => ({ token: "session-token" as string | null }));

vi.mock("@/lib/client-session", () => ({
  clientToken: async () => session.token,
}));

type Sent = { url: string; method: string; headers: Record<string, string>; body: string | undefined };

function backend(status: number, body: unknown) {
  const sent: Sent[] = [];
  const fetch = vi.fn(async (url: string | URL, init: RequestInit = {}) => {
    sent.push({
      url: String(url),
      method: init.method ?? "GET",
      headers: { ...(init.headers as Record<string, string>) },
      body: typeof init.body === "string" ? init.body : undefined,
    });
    return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  });
  return { sent, fetch };
}

const SAVED = {
  perspective_mode: "neutral",
  guideline_id: "6f1c1f8e-0000-4000-8000-000000000001",
  revision: 2,
  text_digest: "d".repeat(64),
  text: "- Short paragraphs\n- Plain words",
};
const CREDENTIALS = { "X-API-Key": "service-key", "X-Onboarding-Token": "session-token" };
const BACKEND = "https://engine.test/v1/clients/me/writing-settings";

async function route() {
  return import("@/app/api/client/writing-settings/route");
}

function put(body: unknown, url = "https://app.test/api/client/writing-settings") {
  return new Request(url, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
}

describe("/api/client/writing-settings", () => {
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

  it("GET forwards the session's own credential and returns the setting", async () => {
    const stub = backend(200, SAVED);
    vi.stubGlobal("fetch", stub.fetch);

    const response = await (await route()).GET();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(SAVED);
    expect(stub.sent).toEqual([{ url: BACKEND, method: "GET", headers: CREDENTIALS, body: undefined }]);
  });

  it("GET passes 'none saved' through as null, not as an empty setting", async () => {
    vi.stubGlobal("fetch", backend(200, null).fetch);

    const response = await (await route()).GET();

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("null");
  });

  it("PUT forwards the text and the version read, and nothing else from the body", async () => {
    const stub = backend(200, { ...SAVED, revision: 3 });
    vi.stubGlobal("fetch", stub.fetch);

    const response = await (await route()).PUT(put({
      text: "- Short paragraphs\n- Plain words",
      expected_revision: 2,
      expected_guideline_id: SAVED.guideline_id,
      client_id: "someone-else",
      perspective_mode: "brand",
      perspective_brand_id: "7a1c1f8e-0000-4000-8000-000000000009",
      actor_id: "someone-else",
      effective: true,
    }, "https://app.test/api/client/writing-settings?client_id=someone-else"));

    expect(response.status).toBe(200);
    expect((await response.json()).revision).toBe(3);
    expect(stub.sent).toHaveLength(1);
    expect(stub.sent[0].url).toBe(BACKEND);
    expect(stub.sent[0].method).toBe("PUT");
    expect(stub.sent[0].headers).toEqual({ ...CREDENTIALS, "Content-Type": "application/json" });
    // No perspective crosses: there is one general text.
    expect(JSON.parse(stub.sent[0].body!)).toEqual({
      text: "- Short paragraphs\n- Plain words",
      expected_revision: 2,
      expected_guideline_id: SAVED.guideline_id,
    });
    expect(JSON.stringify(stub.sent[0])).not.toContain("someone-else");
    expect(JSON.stringify(stub.sent[0])).not.toContain("perspective");
    expect(JSON.stringify(stub.sent[0])).not.toContain("effective");
  });

  it("PUT sends both versions as null for a first save", async () => {
    const stub = backend(200, { ...SAVED, revision: 1 });
    vi.stubGlobal("fetch", stub.fetch);

    await (await route()).PUT(put({ text: "Plain words." }));

    expect(JSON.parse(stub.sent[0].body!)).toEqual({ text: "Plain words.", expected_revision: null, expected_guideline_id: null });
  });

  it("DELETE forwards only the version as the query", async () => {
    const stub = backend(200, { cleared: true });
    vi.stubGlobal("fetch", stub.fetch);

    const response = await (await route()).DELETE(new Request(
      `https://app.test/api/client/writing-settings?expected_revision=2&expected_guideline_id=${SAVED.guideline_id}&client_id=someone-else`,
      { method: "DELETE" },
    ));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ cleared: true });
    expect(stub.sent).toEqual([{
      url: `${BACKEND}?expected_revision=2&expected_guideline_id=${SAVED.guideline_id}`,
      method: "DELETE",
      headers: CREDENTIALS,
      body: undefined,
    }]);
  });

  it("DELETE drops a perspective in the query: only the version is forwarded", async () => {
    const stub = backend(200, { cleared: true });
    vi.stubGlobal("fetch", stub.fetch);
    const brand = "7a1c1f8e-0000-4000-8000-000000000009";

    await (await route()).DELETE(new Request(
      `https://app.test/api/client/writing-settings?expected_revision=2&expected_guideline_id=${SAVED.guideline_id}&perspective_mode=brand&perspective_brand_id=${brand}&client_id=someone-else`,
      { method: "DELETE" },
    ));

    expect(stub.sent[0].url).toBe(`${BACKEND}?expected_revision=2&expected_guideline_id=${SAVED.guideline_id}`);
  });

  it("DELETE without a version is refused here, without a backend call", async () => {
    const stub = backend(200, { cleared: true });
    vi.stubGlobal("fetch", stub.fetch);

    const response = await (await route()).DELETE(new Request("https://app.test/api/client/writing-settings?expected_revision=2", { method: "DELETE" }));

    expect(response.status).toBe(422);
    expect(stub.fetch).not.toHaveBeenCalled();
  });

  it.each(["PUT", "DELETE"] as const)("%s passes a 409 stale_revision through with its detail intact", async (method) => {
    vi.stubGlobal("fetch", backend(409, { detail: { code: "stale_revision", current_revision: 4 } }).fetch);
    const handlers = await route();

    const response = method === "PUT"
      ? await handlers.PUT(put({ text: "Mine.", expected_revision: 2, expected_guideline_id: SAVED.guideline_id }))
      : await handlers.DELETE(new Request(`https://app.test/api/client/writing-settings?expected_revision=2&expected_guideline_id=${SAVED.guideline_id}`, { method: "DELETE" }));

    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.detail).toEqual({ code: "stale_revision", current_revision: 4 });
    expect(typeof body.error).toBe("string");
  });

  it.each(["GET", "PUT", "DELETE"] as const)("%s answers 401 without calling the backend when there is no session", async (method) => {
    session.token = null;
    const stub = backend(200, SAVED);
    vi.stubGlobal("fetch", stub.fetch);
    const handlers = await route();

    const response = method === "GET"
      ? await handlers.GET()
      : method === "PUT"
        ? await handlers.PUT(put({ text: "Mine." }))
        : await handlers.DELETE(new Request(`https://app.test/api/client/writing-settings?expected_revision=1&expected_guideline_id=${SAVED.guideline_id}`, { method: "DELETE" }));

    expect(response.status).toBe(401);
    expect(stub.fetch).not.toHaveBeenCalled();
  });

  it("turns a backend 401 into the one signed-out answer", async () => {
    vi.stubGlobal("fetch", backend(401, { detail: "Invalid or expired onboarding token" }).fetch);

    const response = await (await route()).GET();

    expect(response.status).toBe(401);
    expect(JSON.stringify(await response.json())).not.toContain("onboarding token");
  });
});
