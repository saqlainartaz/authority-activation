import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { NOT_IN_USE_DETAIL, SWITCHED_OFF_DETAIL, TURNING_OFF_DETAIL } from "@/lib/knowledge-status";
import { SWITCH_REFUSALS } from "@/lib/source-switch";
import { LEGACY_OFFICE_COPY, TOO_LARGE_COPY, UNSUPPORTED_TYPE_COPY } from "@/lib/upload-contract";

/**
 * Cycle 5 P7.2/P7.3: the Knowledge BFF on the rehaul engine.
 * - The list and the detail carry each source's business labels and "Use this
 *   source" state from ONE `GET /v1/sources` read; an off source reads "Not in
 *   use" in the client's words, and a withdrawn source keeps the operator's.
 * - The switch routes forward the browser's intent key and the revision it read,
 *   and nothing else; the client is the session's own.
 * - The upload route enforces the D08 contract before the backend is called.
 * Real route handlers and `lib/product` / `lib/engine`; only the session and
 * `fetch` are faked.
 */

const session = vi.hoisted(() => ({ token: "session-token" as string | null }));
vi.mock("@/lib/client-session", () => ({
  clientToken: async () => session.token,
  resolveClientId: async () => "c1",
}));

type Sent = { key: string; headers: Record<string, string>; body: unknown };

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

function backend(engine: "ke" | "m1", routes: Record<string, (init?: RequestInit) => Response>) {
  const sent: Sent[] = [];
  const fetch = vi.fn(async (url: string | URL, init: RequestInit = {}) => {
    const path = String(url).replace("https://engine.test", "");
    const key = `${init.method ?? "GET"} ${path}`;
    let body: unknown;
    if (typeof init.body === "string") body = JSON.parse(init.body);
    sent.push({ key, headers: { ...(init.headers as Record<string, string>) }, body });
    if (key === "GET /v1/me") return json({ client_id: "c1", user_id: "u1", onboarding_complete: true, knowledge_engine: engine });
    const handler = routes[key];
    if (!handler) throw new Error(`unexpected call ${key}`);
    return handler(init);
  });
  return { fetch, sent, calls: () => sent.map(item => item.key) };
}

const DOC = "22222222-2222-4222-8222-222222222222";
const OFF_DOC = "33333333-3333-4333-8333-333333333333";
const GONE_DOC = "44444444-4444-4444-8444-444444444444";
const PENDING_DOC = "55555555-5555-4555-8555-555555555555";
const AT = "2026-10-06T09:00:00Z";
const ready = (id: string, name: string) => ({ id, state: "ready", source_filename: name, created_at: AT });
const use = (id: string, state: "on" | "off" | "pending", revision: number, requested: "on" | "off" | null = null) =>
  ({ document_id: id, state, requested, revision });

const params = (documentId: string) => ({ params: Promise.resolve({ documentId }) }) as never;
const lifecycle = () => import("@/app/api/client/sources/[documentId]/lifecycle/route");
const post = (body: unknown) => new Request("https://app.test/api/client/sources/x/lifecycle", {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
});

describe("the Knowledge BFF on the rehaul engine (P7.2, P7.3)", () => {
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

  describe("the list (A17, A21)", () => {
    it("carries each source's name, labels and switch state, and an off source reads Not in use", async () => {
      const stub = backend("ke", {
        "GET /v2/clients/c1/documents": () => json([
          ready(DOC, "Acme_and_Beta brief.pdf"), ready(OFF_DOC, "old pricing.docx"),
          { ...ready(GONE_DOC, "stopped.txt"), state: "withdrawn" }, ready(PENDING_DOC, "notes.md"),
        ]),
        [`GET /v2/clients/c1/documents/${DOC}/evidence/status`]: () => json({ state: "active", yield: "evidence" }),
        [`GET /v2/clients/c1/documents/${OFF_DOC}/evidence/status`]: () => json({ state: "active", yield: "evidence" }),
        [`GET /v2/clients/c1/documents/${PENDING_DOC}/evidence/status`]: () => json({ state: "active", yield: "evidence" }),
        "GET /v1/sources": () => json({ sources: [
          { document_id: DOC, labels: [{ label: "Acme Physio", kind: "organization" }, { label: "Beta Fitness", kind: "brand" }], use: use(DOC, "on", 2) },
          { document_id: OFF_DOC, labels: [], use: use(OFF_DOC, "off", 1) },
          // The operator stopped this one; whatever the switch says, it is not the switch's.
          { document_id: GONE_DOC, labels: [{ label: "Acme Physio", kind: "organization" }], use: use(GONE_DOC, "off", 1) },
          { document_id: PENDING_DOC, labels: [], use: use(PENDING_DOC, "pending", 3, "off") },
        ] }),
      });
      vi.stubGlobal("fetch", stub.fetch);
      const { GET } = await import("@/app/api/client/documents/route");

      const response = await GET();
      expect(response.status).toBe(200);
      const listed = await response.json() as Array<Record<string, unknown> & { knowledge: Record<string, unknown> }>;
      const byId = Object.fromEntries(listed.map(document => [document.id, document]));

      expect(byId[DOC]).toMatchObject({
        filename: "Acme_and_Beta brief.pdf", closed: false,
        labels: [{ label: "Acme Physio", kind: "organization" }, { label: "Beta Fitness", kind: "brand" }],
        use: { state: "on", requested: null, revision: 2 }, knowledge: { label: "Available", tone: "ready" },
      });
      expect(byId[OFF_DOC]).toMatchObject({
        use: { state: "off", revision: 1 }, status: "failed",
        knowledge: { label: "Not in use", tone: "off", detail: SWITCHED_OFF_DETAIL },
      });
      // Withdrawn by the operator: its own wording, and no switch at all.
      expect(byId[GONE_DOC]).toMatchObject({
        closed: true, use: null, labels: [{ label: "Acme Physio", kind: "organization" }],
        knowledge: { label: "Not in use", tone: "off", detail: NOT_IN_USE_DETAIL },
      });
      expect(byId[PENDING_DOC]).toMatchObject({
        use: { state: "pending", requested: "off", revision: 3 },
        knowledge: { label: "Available", detail: TURNING_OFF_DETAIL, recheck: true },
      });
      // The labels and states are the session's own: read with its credential, once.
      const reads = stub.sent.filter(item => item.key === "GET /v1/sources");
      expect(reads).toHaveLength(1);
      expect(reads[0].headers["X-Onboarding-Token"]).toBe("session-token");
    });

    it("shows a file being deleted as Deleting, closed, with no switch, and reads nothing more about it (P8.3)", async () => {
      const stub = backend("ke", {
        "GET /v2/clients/c1/documents": () => json([{ ...ready(GONE_DOC, "pricing notes.pdf"), state: "withdrawn", deleting: true }]),
        "GET /v1/sources": () => json({ sources: [{ document_id: GONE_DOC, labels: [], use: use(GONE_DOC, "off", 1) }] }),
      });
      vi.stubGlobal("fetch", stub.fetch);
      const { GET } = await import("@/app/api/client/documents/route");

      const [listed] = await (await GET()).json() as Array<Record<string, unknown>>;
      expect(listed).toMatchObject({
        id: GONE_DOC, filename: "pricing notes.pdf", closed: true, deleting: true, use: null,
        knowledge: { label: "Deleting", tone: "working", recheck: true },
      });
      expect(stub.calls()).toEqual(["GET /v1/me", "GET /v2/clients/c1/documents", "GET /v1/sources"]);
    });

    it("shows a source the overview does not list as on, at revision 0, with no labels", async () => {
      vi.stubGlobal("fetch", backend("ke", {
        "GET /v2/clients/c1/documents": () => json([ready(DOC, "a.pdf")]),
        [`GET /v2/clients/c1/documents/${DOC}/evidence/status`]: () => json({ state: "active" }),
        "GET /v1/sources": () => json({ sources: [] }),
      }).fetch);
      const { GET } = await import("@/app/api/client/documents/route");

      const [document] = await (await GET()).json();
      expect(document).toMatchObject({ labels: [], use: { state: "on", requested: null, revision: 0 }, knowledge: { label: "Available" } });
    });

    it("fails the read rather than show a switched-off source as Available when the switch states cannot be read", async () => {
      vi.stubGlobal("fetch", backend("ke", {
        "GET /v2/clients/c1/documents": () => json([ready(DOC, "a.pdf")]),
        [`GET /v2/clients/c1/documents/${DOC}/evidence/status`]: () => json({ state: "active" }),
        "GET /v1/sources": () => json({ detail: "boom" }, 503),
      }).fetch);
      const { GET } = await import("@/app/api/client/documents/route");

      const response = await GET();
      expect(response.status).not.toBe(200);
      expect(JSON.stringify(await response.json())).not.toContain("Available");
    });

    it("gives the opened source the same labels and switch state", async () => {
      const stub = backend("ke", {
        [`GET /v2/clients/c1/documents/${OFF_DOC}`]: () => json({ ...ready(OFF_DOC, "old pricing.docx"), stage_runs: [], open_queue_items: [] }),
        [`GET /v2/clients/c1/documents/${OFF_DOC}/evidence/status`]: () => json({ state: "active" }),
        "GET /v1/sources": () => json({ sources: [{ document_id: OFF_DOC, labels: [{ label: "Acme Physio", kind: "organization" }], use: use(OFF_DOC, "off", 1) }] }),
      });
      vi.stubGlobal("fetch", stub.fetch);
      const { GET } = await import("@/app/api/client/documents/[documentId]/route");

      const body = await (await GET(new Request("https://app.test"), params(OFF_DOC))).json();
      expect(body).toMatchObject({ labels: [{ label: "Acme Physio" }], use: { state: "off" }, knowledge: { label: "Not in use", detail: SWITCHED_OFF_DETAIL } });
    });

    it("reads no overview under M1", async () => {
      const stub = backend("m1", { "GET /v1/clients/c1/documents": () => json([]) });
      vi.stubGlobal("fetch", stub.fetch);
      const { GET } = await import("@/app/api/client/documents/route");

      expect(await (await GET()).json()).toEqual([]);
      expect(stub.calls()).toEqual(["GET /v1/me", "GET /v1/clients/c1/documents"]);
    });
  });

  describe("Use this source (A21)", () => {
    it("reads the switch with the session's own credential", async () => {
      const stub = backend("ke", { [`GET /v1/sources/${DOC}/lifecycle`]: () => json(use(DOC, "off", 4)) });
      vi.stubGlobal("fetch", stub.fetch);
      const { GET } = await lifecycle();

      const response = await GET(new Request("https://app.test"), params(DOC));
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual(use(DOC, "off", 4));
      expect(stub.sent[0].headers["X-Onboarding-Token"]).toBe("session-token");
    });

    it("forwards the browser's intent key, the operation and the revision it read, and nothing else", async () => {
      const answer = { request: { id: "r1", operation: "disable", lifecycle_revision: 5, request_state: "pending", outcome: null },
        source: use(DOC, "pending", 5, "off"), replayed: false };
      const stub = backend("ke", { [`POST /v1/sources/${DOC}/lifecycle`]: () => json(answer, 201) });
      vi.stubGlobal("fetch", stub.fetch);
      const { POST } = await lifecycle();

      const response = await POST(post({
        intent_key: "browser-key-1", operation: "disable", expected_lifecycle_revision: 4,
        client_id: "someone-else", actor: "operator",
      }), params(DOC));

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual(answer);
      expect(stub.sent).toHaveLength(1);
      expect(stub.sent[0].body).toEqual({ intent_key: "browser-key-1", operation: "disable", expected_lifecycle_revision: 4 });
      expect(stub.sent[0].headers["X-Onboarding-Token"]).toBe("session-token");
    });

    it.each([
      ["no intent key", { operation: "disable", expected_lifecycle_revision: 0 }, "intent_key_required"],
      ["no revision", { intent_key: "k", operation: "disable" }, "revision_required"],
      ["a revision that is not a count", { intent_key: "k", operation: "disable", expected_lifecycle_revision: "1" }, "revision_required"],
      ["an unknown operation", { intent_key: "k", operation: "purge", expected_lifecycle_revision: 0 }, "operation_invalid"],
    ])("refuses a change with %s before the backend is called", async (_name, body, detail) => {
      const stub = backend("ke", {});
      vi.stubGlobal("fetch", stub.fetch);
      const { POST } = await lifecycle();

      const response = await POST(post(body), params(DOC));
      expect(response.status).toBe(400);
      expect((await response.json()).detail).toBe(detail);
      expect(stub.sent).toEqual([]);
    });

    it.each(["stale_source_state", "intent_key_reused", "source_not_controllable"])(
      "keeps the backend's 409 %s, with a sentence to show", async detail => {
        vi.stubGlobal("fetch", backend("ke", { [`POST /v1/sources/${DOC}/lifecycle`]: () => json({ detail }, 409) }).fetch);
        const { POST } = await lifecycle();

        const response = await POST(post({ intent_key: "k", operation: "re_enable", expected_lifecycle_revision: 1 }), params(DOC));
        expect(response.status).toBe(409);
        expect(await response.json()).toEqual({ error: SWITCH_REFUSALS[detail], detail });
      },
    );

    it("forwards Delete file like the switch: the browser's key and the revision it read (P8.3)", async () => {
      const answer = { request: { id: "r2", operation: "delete", lifecycle_revision: 5, request_state: "complete",
        outcome: { deleted: true } }, source: use(DOC, "on", 5), replayed: false };
      const stub = backend("ke", { [`POST /v1/sources/${DOC}/lifecycle`]: () => json(answer, 201) });
      vi.stubGlobal("fetch", stub.fetch);
      const { POST } = await lifecycle();

      const response = await POST(post({ intent_key: "browser-key-2", operation: "delete", expected_lifecycle_revision: 4 }),
        params(DOC));

      expect(response.status).toBe(200);
      expect(stub.sent[0].body).toEqual({ intent_key: "browser-key-2", operation: "delete", expected_lifecycle_revision: 4 });
      expect(stub.sent[0].headers["X-Onboarding-Token"]).toBe("session-token");
    });

    it.each([
      ["source_deleting", 409],
      ["delete_requires_sign_in", 403],
    ])("keeps the backend's %s, with a sentence to show (P8.3)", async (detail, status) => {
      vi.stubGlobal("fetch", backend("ke", { [`POST /v1/sources/${DOC}/lifecycle`]: () => json({ detail }, status) }).fetch);
      const { POST } = await lifecycle();

      const response = await POST(post({ intent_key: "k", operation: "delete", expected_lifecycle_revision: 1 }), params(DOC));
      expect(response.status).toBe(status);
      expect(await response.json()).toEqual({ error: SWITCH_REFUSALS[detail], detail });
    });

    it("needs a session, a source id, and the rehaul engine", async () => {
      const stub = backend("m1", { [`GET /v1/sources/${DOC}/lifecycle`]: () => json({ detail: "not_available" }, 404) });
      vi.stubGlobal("fetch", stub.fetch);
      const { GET, POST } = await lifecycle();

      expect((await GET(new Request("https://app.test"), params(DOC))).status).toBe(404);
      expect((await POST(post({ intent_key: "k", operation: "disable", expected_lifecycle_revision: 0 }), params("not-an-id"))).status).toBe(404);
      session.token = null;
      expect((await GET(new Request("https://app.test"), params(DOC))).status).toBe(401);
      expect(stub.sent.map(item => item.key)).toEqual([`GET /v1/sources/${DOC}/lifecycle`]);
    });
  });

  describe("the upload contract at the BFF (P7.3)", () => {
    const upload = (name: string, size = 64, type = "") => {
      const form = new FormData();
      form.set("file", new File([new Uint8Array(size)], name, { type }));
      return new Request("https://app.test/api/client/documents", { method: "POST", body: form });
    };

    it.each([
      ["old.doc", 64, "application/msword", 415, LEGACY_OFFICE_COPY, "legacy_office"],
      ["photo.heic", 64, "image/heic", 415, UNSUPPORTED_TYPE_COPY, "unsupported_type"],
      ["huge.pdf", 20 * 1024 * 1024 + 1, "application/pdf", 413, TOO_LARGE_COPY, "too_large"],
    ])("refuses %s before the backend is called", async (name, size, type, status, error, detail) => {
      const stub = backend("ke", {});
      vi.stubGlobal("fetch", stub.fetch);
      const { POST } = await import("@/app/api/client/documents/route");

      const response = await POST(upload(name, size, type));
      expect(response.status).toBe(status);
      expect(await response.json()).toEqual({ error, detail });
      expect(stub.calls()).toEqual(["GET /v1/me"]);
    });

    it("forwards a file the contract accepts", async () => {
      const stub = backend("ke", {
        "POST /v2/clients/c1/documents": () => json({ document_id: DOC, state: "received" }, 201),
      });
      vi.stubGlobal("fetch", stub.fetch);
      const { POST } = await import("@/app/api/client/documents/route");

      const response = await POST(upload("good.docx", 64, "application/vnd.openxmlformats-officedocument.wordprocessingml.document"));
      expect(response.status).toBe(201);
      expect(await response.json()).toMatchObject({ id: DOC, filename: "good.docx" });
    });

    it("leaves M1 uploads exactly as they were", async () => {
      const stub = backend("m1", { "POST /v1/clients/c1/documents": () => json({ id: "m1doc", status: "uploaded" }, 201) });
      vi.stubGlobal("fetch", stub.fetch);
      const { POST } = await import("@/app/api/client/documents/route");

      expect((await POST(upload("old.doc", 64, "application/msword"))).status).toBe(201);
      expect(stub.calls()).toEqual(["GET /v1/me", "POST /v1/clients/c1/documents"]);
    });
  });
});
