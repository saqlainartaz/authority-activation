import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Cycle 5 Ruling 93: System health's Retry delete BFF route. The real route
 * handler and the real `lib/engine` client; only the backend (`fetch`) is faked.
 * - passcode first, rehaul only;
 * - it calls staff's Delete file route with the service key, a fresh intent key
 *   and a revision no source reaches, forwarding nothing from the browser but the
 *   client and the source in the path;
 * - the backend's `409 source_deleting` (the purge was queued again) is success;
 *   any other answer is forwarded as a refusal, so it can never start a new delete.
 */

type Sent = { url: string; method: string; headers: Record<string, string>; body: Record<string, unknown> | undefined };

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

function backend(answer: () => Response, engine: "ke" | "m1" = "ke") {
  const sent: Sent[] = [];
  const fetch = vi.fn(async (url: string | URL, init: RequestInit = {}) => {
    const path = String(url).replace("https://engine.test", "");
    if (path === "/v2/engine") return json({ knowledge_engine: engine });
    sent.push({ url: path, method: init.method ?? "GET", headers: { ...(init.headers as Record<string, string>) },
      body: init.body ? JSON.parse(String(init.body)) : undefined });
    return answer();
  });
  return { sent, fetch };
}

const PASS = { "x-internal-passcode": "letmein" };
const params = { params: Promise.resolve({ clientId: "c1", documentId: "d1" }) } as never;
const route = () => import("@/app/api/internal/clients/[clientId]/sources/[documentId]/retry-delete/route");
const post = (headers: Record<string, string> = PASS) => new Request("https://app.test", {
  method: "POST", headers, body: JSON.stringify({ intent_key: "browser", expected_lifecycle_revision: 0 }),
});

describe("operator Retry delete route", () => {
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

  it("re-queues the purge through staff's Delete file: the backend's 409 source_deleting is success", async () => {
    const stub = backend(() => json({ detail: "source_deleting" }, 409));
    vi.stubGlobal("fetch", stub.fetch);
    const { POST } = await route();

    const response = await POST(post(), params);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ restarted: true });
    expect(stub.sent).toHaveLength(1);
    const [call] = stub.sent;
    expect([call.method, call.url]).toEqual(["POST", "/v2/clients/c1/sources/d1/lifecycle"]);
    expect(call.headers["X-API-Key"]).toBe("service-key");
    expect(call.body?.operation).toBe("delete");
    expect(call.body?.expected_lifecycle_revision).toBe(2_147_483_647);
    expect(String(call.body?.intent_key)).toMatch(/^retry-delete:d1:[0-9a-f-]{36}$/);
  });

  it("forwards any other answer as a refusal, so a source not being deleted is never deleted", async () => {
    const stub = backend(() => json({ detail: "stale_source_state" }, 409));
    vi.stubGlobal("fetch", stub.fetch);
    const { POST } = await route();
    const response = await POST(post(), params);
    expect(response.status).toBe(409);
    expect((await response.json()).detail).toBe("stale_source_state");

    const recorded = backend(() => json({ request: {}, source: {}, replayed: false }, 201));
    vi.stubGlobal("fetch", recorded.fetch);
    const odd = await POST(post(), params);
    expect(odd.status).toBe(409);
    expect((await odd.json()).detail).toBe("source_not_deleting");
  });

  it("refuses without the passcode, and is not available under M1", async () => {
    const stub = backend(() => json({ detail: "source_deleting" }, 409));
    vi.stubGlobal("fetch", stub.fetch);
    const { POST } = await route();
    expect((await POST(post({ "x-internal-passcode": "wrong" }), params)).status).toBe(401);
    expect(stub.fetch).not.toHaveBeenCalled();

    const m1 = backend(() => json({ detail: "source_deleting" }, 409), "m1");
    vi.stubGlobal("fetch", m1.fetch);
    expect((await POST(post(), params)).status).toBe(404);
    expect(m1.sent).toEqual([]);
  });
});
