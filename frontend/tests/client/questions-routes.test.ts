import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Cycle 5 P6.5/P6.6: the question BFF routes and the operator's Ready to
 * onboard. Real route handlers and the real `lib/product` / `lib/engine`
 * clients; only the session cookie and the backend (`fetch`) are faked. The
 * rules under test:
 * - the client is the session's own: nothing from the browser names one;
 * - an answer's `idempotency_key` is the browser's, forwarded unchanged, and a
 *   retry sends the same key; an answer without one is refused before the
 *   backend is called; only the three answer fields are forwarded;
 * - Ready to onboard is passcode-first and rehaul-only, and forwards nothing
 *   but the client in the path.
 */

const session = vi.hoisted(() => ({ token: "session-token" as string | null }));

vi.mock("@/lib/client-session", () => ({
  clientToken: async () => session.token,
}));

type Sent = { url: string; method: string; headers: Record<string, string>; body: unknown };

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

function backend(answer: (path: string, method: string) => Response, engine: "ke" | "m1" = "ke") {
  const sent: Sent[] = [];
  const fetch = vi.fn(async (url: string | URL, init: RequestInit = {}) => {
    const path = String(url).replace("https://engine.test", "");
    if (path === "/v2/engine") return json({ knowledge_engine: engine });
    const method = init.method ?? "GET";
    sent.push({ url: path, method, headers: { ...(init.headers as Record<string, string>) }, body: init.body ? JSON.parse(String(init.body)) : undefined });
    return answer(path, method);
  });
  return { sent, fetch };
}

const QUESTION = "11111111-1111-4111-8111-111111111111";
const DOCUMENT = "22222222-2222-4222-8222-222222222222";
const KEY = "0b7f3a52-5d0e-4c1f-9d55-2b3c4a5e6f70";
const ANSWER = { id: "a-1", question_id: QUESTION, disposition: "answer", payload: { option: "b" }, application_state: "applied", effects: [], application_note: null, what_changed: "Added.", question_status: "answered", created_at: "2026-10-08T12:00:00Z", replayed: false };

const routes = {
  list: () => import("@/app/api/client/questions/route"),
  answer: () => import("@/app/api/client/questions/[questionId]/answers/route"),
  read: () => import("@/app/api/client/questions/answers/[answerId]/route"),
  state: () => import("@/app/api/client/onboarding/state/route"),
  ready: () => import("@/app/api/internal/clients/[clientId]/onboarding-ready/route"),
};

const post = (body: unknown) => new Request("https://app.test/api/client/questions/x/answers", {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
});
const questionParams = { params: Promise.resolve({ questionId: QUESTION }) } as never;

describe("client question BFF routes", () => {
  beforeEach(() => {
    vi.resetModules();
    session.token = "session-token";
    vi.stubEnv("ENGINE_URL", "https://engine.test");
    vi.stubEnv("ENGINE_SERVICE_KEY", "service-key");
    vi.stubEnv("INTERNAL_PASSCODE", "letmein");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("lists a surface with the session's own credential, and only the three surface shapes", async () => {
    const stub = backend(() => json({ surface: "questions", questions: [] }));
    vi.stubGlobal("fetch", stub.fetch);
    const { GET } = await routes.list();

    for (const surface of ["questions", "onboarding", `source:${DOCUMENT}`]) {
      const response = await GET(new Request(`https://app.test/api/client/questions?surface=${encodeURIComponent(surface)}&client_id=other`));
      expect(response.status, surface).toBe(200);
    }
    expect(stub.sent.map((call) => call.url)).toEqual([
      "/v1/questions?surface=questions", "/v1/questions?surface=onboarding", `/v1/questions?surface=source%3A${DOCUMENT}`,
    ]);
    expect(stub.sent[0].headers).toEqual({ "X-API-Key": "service-key", "X-Onboarding-Token": "session-token" });

    for (const surface of ["", "everything", "source:not-a-uuid"]) {
      const response = await GET(new Request(`https://app.test/api/client/questions?surface=${surface}`));
      expect(response.status, surface).toBe(400);
    }
    expect(stub.sent).toHaveLength(3);
  });

  it("forwards the browser's intent key unchanged, the same key on a retry, and only the answer fields", async () => {
    const stub = backend(() => json(ANSWER, 201));
    vi.stubGlobal("fetch", stub.fetch);
    const { POST } = await routes.answer();
    const body = { idempotency_key: KEY, disposition: "answer", payload: { option: "b" }, client_id: "other", actor: "x" };

    const first = await POST(post(body), questionParams);
    const retry = await POST(post(body), questionParams);

    expect([first.status, retry.status]).toEqual([200, 200]);
    expect(await first.json()).toMatchObject({ id: "a-1", what_changed: "Added." });
    expect(stub.sent.map((call) => [call.method, call.url, call.body])).toEqual([
      ["POST", `/v1/questions/${QUESTION}/answers`, { idempotency_key: KEY, disposition: "answer", payload: { option: "b" } }],
      ["POST", `/v1/questions/${QUESTION}/answers`, { idempotency_key: KEY, disposition: "answer", payload: { option: "b" } }],
    ]);
  });

  it("forwards skip, later and not sure without a payload", async () => {
    const stub = backend(() => json(ANSWER, 201));
    vi.stubGlobal("fetch", stub.fetch);
    const { POST } = await routes.answer();
    for (const disposition of ["skip", "defer", "unknown"]) {
      expect((await POST(post({ idempotency_key: `${KEY}-${disposition}`, disposition }), questionParams)).status).toBe(200);
    }
    expect(stub.sent.map((call) => call.body)).toEqual([
      { idempotency_key: `${KEY}-skip`, disposition: "skip" },
      { idempotency_key: `${KEY}-defer`, disposition: "defer" },
      { idempotency_key: `${KEY}-unknown`, disposition: "unknown" },
    ]);
  });

  it("refuses an answer without an intent key or with no disposition, and never calls the backend", async () => {
    const stub = backend(() => json(ANSWER, 201));
    vi.stubGlobal("fetch", stub.fetch);
    const { POST } = await routes.answer();
    for (const body of [{ disposition: "skip" }, { idempotency_key: "", disposition: "skip" }, { idempotency_key: "   ", disposition: "skip" },
      { idempotency_key: 42, disposition: "skip" }, { idempotency_key: KEY }, { idempotency_key: KEY, disposition: "delete" }]) {
      expect((await POST(post(body), questionParams)).status, JSON.stringify(body)).toBe(400);
    }
    expect(stub.fetch).not.toHaveBeenCalled();
  });

  it("passes the backend's refusals through: 409 for an answered question, 404 under M1", async () => {
    vi.stubGlobal("fetch", backend(() => json({ detail: { code: "question_not_open", status: "answered" } }, 409)).fetch);
    const { POST } = await routes.answer();
    const refused = await POST(post({ idempotency_key: KEY, disposition: "skip" }), questionParams);
    expect(refused.status).toBe(409);

    vi.stubGlobal("fetch", backend(() => json({ detail: "not_available" }, 404)).fetch);
    const { GET } = await routes.list();
    expect((await GET(new Request("https://app.test/api/client/questions?surface=questions"))).status).toBe(404);
  });

  it("reads an answer's what-changed and the onboarding state with the session's credential", async () => {
    const stub = backend((path) => path.startsWith("/v1/questions/answers/")
      ? json(ANSWER)
      : json({ state: "ready", packet_id: "p-1", total: 7, remaining: 5 }));
    vi.stubGlobal("fetch", stub.fetch);
    const [{ GET: read }, { GET: state }] = await Promise.all([routes.read(), routes.state()]);

    const answer = await read(new Request("https://app.test"), { params: Promise.resolve({ answerId: "a-1" }) } as never);
    const onboarding = await state();

    expect(await answer.json()).toMatchObject({ what_changed: "Added." });
    expect(await onboarding.json()).toEqual({ state: "ready", packet_id: "p-1", total: 7, remaining: 5 });
    expect(stub.sent.map((call) => call.url)).toEqual(["/v1/questions/answers/a-1", "/v1/onboarding/state"]);
    expect(stub.sent.every((call) => call.headers["X-Onboarding-Token"] === "session-token")).toBe(true);
  });

  it("answers 401 without a session, and calls nothing", async () => {
    session.token = null;
    const stub = backend(() => json({}));
    vi.stubGlobal("fetch", stub.fetch);
    const [{ GET: list }, { POST: answer }, { GET: state }] = await Promise.all([routes.list(), routes.answer(), routes.state()]);

    expect((await list(new Request("https://app.test/api/client/questions?surface=questions"))).status).toBe(401);
    expect((await answer(post({ idempotency_key: KEY, disposition: "skip" }), questionParams)).status).toBe(401);
    expect((await state()).status).toBe(401);
    expect(stub.fetch).not.toHaveBeenCalled();
  });
});

describe("operator Ready to onboard route", () => {
  const PASS = { "x-internal-passcode": "letmein" };
  const params = { params: Promise.resolve({ clientId: "c1" }) } as never;
  const PACKET = { state: "generating", packet_id: "p-1", total: 0, remaining: 0, created: true, enqueued: true, retried: false, monthly_started: true };

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

  it("starts onboarding with the service key, forwarding nothing but the client", async () => {
    const stub = backend(() => json(PACKET));
    vi.stubGlobal("fetch", stub.fetch);
    const { GET, POST } = await routes.ready();

    const started = await POST(new Request("https://app.test", { method: "POST", headers: PASS, body: JSON.stringify({ client_id: "other", intent_key: KEY }) }), params);
    const read = await GET(new Request("https://app.test", { headers: PASS }), params);

    expect(started.status).toBe(200);
    expect(await started.json()).toEqual(PACKET);
    expect(read.status).toBe(200);
    expect(stub.sent.map((call) => [call.method, call.url, call.body])).toEqual([
      ["POST", "/v1/clients/c1/onboarding-packet", undefined],
      ["GET", "/v1/clients/c1/onboarding-packet", undefined],
    ]);
    expect(stub.sent[0].headers).toEqual({ "X-API-Key": "service-key" });
  });

  it("refuses without the passcode, and is not available under M1", async () => {
    const stub = backend(() => json(PACKET));
    vi.stubGlobal("fetch", stub.fetch);
    const { GET, POST } = await routes.ready();
    expect((await POST(new Request("https://app.test", { method: "POST", headers: { "x-internal-passcode": "wrong" } }), params)).status).toBe(401);
    expect((await GET(new Request("https://app.test"), params)).status).toBe(401);
    expect(stub.fetch).not.toHaveBeenCalled();

    const m1 = backend(() => json(PACKET), "m1");
    vi.stubGlobal("fetch", m1.fetch);
    const refused = await POST(new Request("https://app.test", { method: "POST", headers: PASS }), params);
    expect(refused.status).toBe(404);
    expect(m1.sent).toEqual([]);
  });
});
