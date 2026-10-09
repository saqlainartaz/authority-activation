import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Cycle 5 P6.8 (review I-4): the contribution BFF routes. Real route handlers
 * and the real `lib/product` client; only the session cookie and the backend
 * (`fetch`) are faked.
 * - the client is the session's own: nothing from the browser names one;
 * - the browser's `intent_key` is forwarded unchanged (the same key on a retry),
 *   and a message without one is refused before the backend is called;
 * - only `intent_key`, `text` and `kind` (`fact` by default, or `writing`) are
 *   forwarded; a note is one item of at most 500 characters (2026-10-08);
 * - the proposals read forwards nothing but the session's credential.
 */

const session = vi.hoisted(() => ({ token: "session-token" as string | null }));

vi.mock("@/lib/client-session", () => ({
  clientToken: async () => session.token,
}));

type Sent = { url: string; method: string; headers: Record<string, string>; body: unknown };

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

function backend(answer: (path: string, method: string) => Response) {
  const sent: Sent[] = [];
  const fetch = vi.fn(async (url: string | URL, init: RequestInit = {}) => {
    const path = String(url).replace("https://engine.test", "");
    const method = init.method ?? "GET";
    sent.push({ url: path, method, headers: { ...(init.headers as Record<string, string>) }, body: init.body ? JSON.parse(String(init.body)) : undefined });
    return answer(path, method);
  });
  return { sent, fetch };
}

const KEY = "0b7f3a52-5d0e-4c1f-9d55-2b3c4a5e6f70";
const REPLY = {
  id: "c-1", text: "Don't name Sam.", kind: "writing", application_state: "applied", pending_reason: null,
  effects: [{ kind: "guidance", change: "proposed", instruction: "Never name Sam.", summary: "Suggested." }],
  application_note: null, what_changed: "Suggested.", created_at: "2026-10-08T12:00:00Z", replayed: false,
};

const routes = {
  contribute: () => import("@/app/api/client/contributions/route"),
  proposals: () => import("@/app/api/client/contributions/proposals/route"),
};

const post = (body: unknown) => new Request("https://app.test/api/client/contributions", {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
});

describe("contribution BFF routes", () => {
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

  it("forwards the browser's intent key, text and kind only, the same key on a retry", async () => {
    const stub = backend(() => json(REPLY, 201));
    vi.stubGlobal("fetch", stub.fetch);
    const { POST } = await routes.contribute();
    const body = { intent_key: KEY, text: "Don't name Sam.", kind: "writing", client_id: "other", actor: "x" };

    const first = await POST(post(body));
    const retry = await POST(post(body));
    const plain = await POST(post({ intent_key: KEY, text: "We now serve teams." }));

    expect([first.status, retry.status, plain.status]).toEqual([200, 200, 200]);
    expect(await first.json()).toMatchObject({ id: "c-1", kind: "writing" });
    expect(stub.sent.map((call) => [call.method, call.url, call.body])).toEqual([
      ["POST", "/v1/contributions", { intent_key: KEY, text: "Don't name Sam.", kind: "writing" }],
      ["POST", "/v1/contributions", { intent_key: KEY, text: "Don't name Sam.", kind: "writing" }],
      // No kind from the browser: something about me or my business.
      ["POST", "/v1/contributions", { intent_key: KEY, text: "We now serve teams.", kind: "fact" }],
    ]);
    expect(stub.sent[0].headers).toMatchObject({ "X-API-Key": "service-key", "X-Onboarding-Token": "session-token" });
  });

  it("forwards the Business DNA section a note was sent from, and refuses one that takes no note", async () => {
    const stub = backend(() => json(REPLY, 201));
    vi.stubGlobal("fetch", stub.fetch);
    const { POST } = await routes.contribute();

    expect((await POST(post({ intent_key: KEY, text: "Office workers.", kind: "fact", section: "audience" }))).status).toBe(200);
    for (const section of ["voice", "nowhere", 3]) {
      expect((await POST(post({ intent_key: KEY, text: "hi", section }))).status).toBe(400);
    }
    expect(stub.sent.map((call) => call.body)).toEqual([
      { intent_key: KEY, text: "Office workers.", kind: "fact", section: "audience" }]);
  });

  it("refuses a message without an intent key or text, and never calls the backend", async () => {
    const stub = backend(() => json(REPLY, 201));
    vi.stubGlobal("fetch", stub.fetch);
    const { POST } = await routes.contribute();
    for (const body of [{ text: "hi" }, { intent_key: "", text: "hi" }, { intent_key: "  ", text: "hi" }, { intent_key: 7, text: "hi" },
      { intent_key: KEY }, { intent_key: KEY, text: "   " }, { intent_key: KEY, text: "x".repeat(501) },
      { intent_key: KEY, text: "hi", kind: "instruction" }, { intent_key: KEY, text: "hi", kind: 3 }]) {
      expect((await POST(post(body))).status, JSON.stringify(body).slice(0, 60)).toBe(400);
    }
    expect(stub.fetch).not.toHaveBeenCalled();
  });

  it("reads the proposed lines with the session's credential, and passes refusals through", async () => {
    const stub = backend(() => json({ proposals: [{ instruction: "Never name Sam.", source: "contribution", source_id: "c-1", created_at: "2026-10-08T12:00:00Z" }] }));
    vi.stubGlobal("fetch", stub.fetch);
    const { GET } = await routes.proposals();

    const response = await GET();

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ proposals: [{ instruction: "Never name Sam." }] });
    expect(stub.sent.map((call) => [call.method, call.url])).toEqual([["GET", "/v1/contributions/proposals"]]);

    vi.stubGlobal("fetch", backend(() => json({ detail: "not_available" }, 404)).fetch);
    expect((await (await routes.proposals()).GET()).status).toBe(404);
  });

  it("is the session's own: no session, no call", async () => {
    session.token = null;
    const stub = backend(() => json(REPLY, 201));
    vi.stubGlobal("fetch", stub.fetch);
    const [{ POST }, { GET }] = await Promise.all([routes.contribute(), routes.proposals()]);
    expect((await POST(post({ intent_key: KEY, text: "hi" }))).status).toBe(401);
    expect((await GET()).status).toBe(401);
    expect(stub.fetch).not.toHaveBeenCalled();
  });
});
