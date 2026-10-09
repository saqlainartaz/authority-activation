import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DUPLICATE_UPLOAD_COPY, IN_PROGRESS_COPY, TOO_LARGE_COPY, UNSUPPORTED_TYPE_COPY, uploadErrorCopy } from "@/lib/upload-errors";

/**
 * Cycle 5 P2.7 (spec §7.2-7.4, A18, A26, A27, A47): the client's Knowledge BFF
 * routes follow the backend's one switch. Under the rehaul engine:
 * - the list and detail carry each source's §7.2 status;
 * - a refused upload says which limit and when it resets, never a raw code;
 * - there is no delete and no reprocess, and asking for one calls nothing.
 * Under M1 every route calls exactly what it always called.
 * The real route handlers and `lib/engine`; only the session and `fetch` are faked.
 */

const session = vi.hoisted(() => ({ token: "session-token" as string | null }));
vi.mock("@/lib/client-session", () => ({
  clientToken: async () => session.token,
  resolveClientId: async () => "c1",
}));

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

type Handler = (init?: RequestInit) => Response;

function backend(engine: "ke" | "m1", routes: Record<string, Handler>) {
  const calls: string[] = [];
  const fetch = vi.fn(async (url: string | URL, init?: RequestInit) => {
    const path = String(url).replace("https://engine.test", "");
    const key = `${init?.method ?? "GET"} ${path}`;
    calls.push(key);
    if (key === "GET /v1/me") {
      return json({ client_id: "c1", user_id: "u1", onboarding_complete: true, knowledge_engine: engine });
    }
    // P7.2: under ke the list and detail also read labels and switch states; none by default.
    const handler = routes[key] ?? (engine === "ke" && key === "GET /v1/sources" ? () => json({ sources: [] }) : undefined);
    if (!handler) throw new Error(`unexpected call ${key}`);
    return handler(init);
  });
  return { fetch, calls };
}

const params = (documentId: string) => ({ params: Promise.resolve({ documentId }) }) as never;

function uploadRequest(name = "pack.pdf") {
  const form = new FormData();
  form.set("file", new File(["%PDF-1.7"], name));
  return new Request("https://app.test/api/client/documents", { method: "POST", body: form });
}

const MONTHLY = {
  detail: "monthly_upload_limit",
  limit: {
    meter: "uploads_monthly", period: "month", used: 30, allowed: 30, used_fraction: 1,
    resets_at: "2026-11-01T00:00:00+00:00", reason: "monthly_upload_limit",
  },
};

describe("client Knowledge routes", () => {
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

  describe("the document detail", () => {
    it("reads the v2 detail under ke and returns the source with its status", async () => {
      const stub = backend("ke", {
        "GET /v2/clients/c1/documents/d1": () => json({
          id: "d1", state: "parsed", source_filename: "board_pack.pdf", created_at: "2026-10-06T09:00:00Z",
          stage_runs: [], open_queue_items: [], paused_reason: "daily_spending_limit",
          next_eligible_at: "2099-01-02T00:01:00+00:00",
        }),
      });
      vi.stubGlobal("fetch", stub.fetch);
      const { GET } = await import("@/app/api/client/documents/[documentId]/route");

      const response = await GET(new Request("https://app.test"), params("d1"));

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body).toMatchObject({
        id: "d1", source_type: "board_pack.pdf", status: "uploaded", pipeline_version: 2,
        knowledge: {
          label: "Paused · daily spending limit", tone: "waiting",
          detail: "Continues after 00:01 UTC on 2 January", resumes_at: "2099-01-02T00:01:00.000Z",
        },
      });
      // Nothing offers to delete or reprocess it.
      expect(JSON.stringify(body)).not.toMatch(/delete|reprocess|remove/i);
      // Plus, since P7.2, the one read of labels and switch states.
      expect(stub.calls).toEqual(["GET /v1/me", "GET /v2/clients/c1/documents/d1", "GET /v1/sources"]);
    });

    it("shows a withdrawn source as not in use, never deleted", async () => {
      vi.stubGlobal("fetch", backend("ke", {
        "GET /v2/clients/c1/documents/d1": () => json({
          id: "d1", state: "withdrawn", source_filename: "a.txt", created_at: "2026-10-06T09:00:00Z", stage_runs: [],
          paused_reason: null, next_eligible_at: null,
        }),
      }).fetch);
      const { GET } = await import("@/app/api/client/documents/[documentId]/route");

      const body = await (await GET(new Request("https://app.test"), params("d1"))).json();

      expect(body.knowledge.label).toBe("Not in use");
      expect(JSON.stringify(body)).not.toMatch(/delet/i);
    });

    it("keeps the M1 detail route unchanged", async () => {
      const m1 = { id: "d1", status: "atomised", atom_count: 3, pipeline_stages: [] };
      const stub = backend("m1", { "GET /v1/clients/c1/documents/d1": () => json(m1) });
      vi.stubGlobal("fetch", stub.fetch);
      const { GET } = await import("@/app/api/client/documents/[documentId]/route");

      const response = await GET(new Request("https://app.test"), params("d1"));

      expect(await response.json()).toEqual(m1);
      expect(stub.calls).toEqual(["GET /v1/me", "GET /v1/clients/c1/documents/d1"]);
    });

    it.each(["POST", "DELETE"] as const)("offers no %s under ke and calls nothing", async (method) => {
      const stub = backend("ke", {});
      vi.stubGlobal("fetch", stub.fetch);
      const route = await import("@/app/api/client/documents/[documentId]/route");

      const response = await route[method](new Request("https://app.test", { method }), params("d1"));

      expect(response.status).toBe(409);
      expect((await response.json()).error).toBe("Removing or reprocessing a file isn't available yet.");
      expect(stub.calls).toEqual(["GET /v1/me"]);
    });

    it("keeps M1's reprocess and remove", async () => {
      const stub = backend("m1", {
        "POST /v1/clients/c1/documents/d1/reprocess": () => json({ status: "queued" }, 202),
        "DELETE /v1/clients/c1/documents/d1": () => new Response(null, { status: 204 }),
      });
      vi.stubGlobal("fetch", stub.fetch);
      const route = await import("@/app/api/client/documents/[documentId]/route");

      expect((await route.POST(new Request("https://app.test", { method: "POST" }), params("d1"))).status).toBe(202);
      expect((await route.DELETE(new Request("https://app.test", { method: "DELETE" }), params("d1"))).status).toBe(204);
      expect(stub.calls).toEqual([
        "GET /v1/me", "POST /v1/clients/c1/documents/d1/reprocess",
        "GET /v1/me", "DELETE /v1/clients/c1/documents/d1",
      ]);
    });
  });

  describe("the list", () => {
    it("reads the detail only for sources still moving or waiting, and sends each status", async () => {
      const at = "2026-10-06T09:00:00Z";
      const stub = backend("ke", {
        "GET /v2/clients/c1/documents": () => json([
          { id: "available", state: "ready", source_filename: "a.txt", created_at: at },
          { id: "empty", state: "ready", source_filename: "b.txt", created_at: at },
          { id: "extracting", state: "ready", source_filename: "c.txt", created_at: at },
          { id: "paused", state: "parsed", source_filename: "d.txt", created_at: at },
          { id: "too-long", state: "parsed", source_filename: "e.txt", created_at: at },
        ]),
        "GET /v2/clients/c1/documents/available/evidence/status": () => json({ state: "active", yield: "evidence" }),
        "GET /v2/clients/c1/documents/empty/evidence/status": () => json({ state: "active", yield: "empty" }),
        "GET /v2/clients/c1/documents/extracting/evidence/status": () => json({ detail: "Evidence release not found" }, 404),
        "GET /v2/clients/c1/documents/extracting": () => json({ id: "extracting", state: "ready", source_filename: "c.txt",
          created_at: at, stage_runs: [], paused_reason: null, next_eligible_at: null, open_queue_items: [] }),
        "GET /v2/clients/c1/documents/paused": () => json({ id: "paused", state: "parsed", source_filename: "d.txt",
          created_at: at, stage_runs: [], paused_reason: "deployment_limit", next_eligible_at: null, open_queue_items: [] }),
        "GET /v2/clients/c1/documents/too-long": () => json({ id: "too-long", state: "parsed", source_filename: "e.txt",
          created_at: at, stage_runs: [], lane: "document", paused_reason: null, next_eligible_at: null,
          open_queue_items: [{ id: "q1", kind: "source_size_rejected" }] }),
      });
      vi.stubGlobal("fetch", stub.fetch);
      const { GET } = await import("@/app/api/client/documents/route");

      const listed = await (await GET()).json();

      expect(listed.map((document: { id: string; status: string; knowledge: { label: string } }) =>
        [document.id, document.status, document.knowledge.label])).toEqual([
        ["available", "atomised", "Available"],
        ["empty", "atomised", "Processed · no usable information"],
        ["extracting", "uploaded", "Processing"],
        ["paused", "uploaded", "Processing delayed"],
        ["too-long", "failed", "Needs your help"],
      ]);
      expect(stub.calls).not.toContain("GET /v2/clients/c1/documents/available");
      expect(stub.calls).not.toContain("GET /v2/clients/c1/documents/empty");
    });
  });

  describe("one source's failed status read (P2 milestone review M4)", () => {
    it("shows that source as status unavailable and keeps every other row current", async () => {
      const at = "2026-10-06T09:00:00Z";
      const stub = backend("ke", {
        "GET /v2/clients/c1/documents": () => json([
          { id: "gone", state: "parsed", source_filename: "a.txt", created_at: at },
          { id: "broken", state: "ready", source_filename: "b.txt", created_at: at },
          { id: "paused", state: "parsed", source_filename: "c.txt", created_at: at },
        ]),
        // Deleted between the list and its detail read (a 404 race), and a 500 on one document.
        "GET /v2/clients/c1/documents/gone": () => json({ detail: "Document not found" }, 404),
        "GET /v2/clients/c1/documents/broken/evidence/status": () => json({ detail: "boom" }, 500),
        "GET /v2/clients/c1/documents/paused": () => json({ id: "paused", state: "parsed", source_filename: "c.txt",
          created_at: at, stage_runs: [], paused_reason: "daily_spending_limit",
          next_eligible_at: "2099-01-02T00:01:00+00:00", open_queue_items: [] }),
      });
      vi.stubGlobal("fetch", stub.fetch);
      const { GET } = await import("@/app/api/client/documents/route");
      const { STATUS_UNAVAILABLE } = await import("@/lib/knowledge-status");

      const response = await GET();
      expect(response.status).toBe(200);
      const listed = await response.json();

      const unavailable = { label: "Processing delayed", tone: "waiting", detail: STATUS_UNAVAILABLE, recheck: true };
      expect(listed.map((document: { id: string; status: string; knowledge: unknown }) =>
        [document.id, document.status, document.knowledge])).toEqual([
        ["gone", "uploaded", unavailable],
        ["broken", "uploaded", unavailable],
        ["paused", "uploaded", expect.objectContaining({ label: "Paused · daily spending limit", usage_limited: true })],
      ]);
    });

    it("still fails the whole read when the list itself cannot be read", async () => {
      const stub = backend("ke", { "GET /v2/clients/c1/documents": () => json({ detail: "boom" }, 500) });
      vi.stubGlobal("fetch", stub.fetch);
      const { GET } = await import("@/app/api/client/documents/route");

      expect((await GET()).status).not.toBe(200);
    });
  });

  describe("the list's read volume (fix round 1, review M4)", () => {
    it("reads at most four documents' status at a time, in order", async () => {
      const at = "2026-10-06T09:00:00Z";
      const ids = Array.from({ length: 10 }, (_, index) => `d${index}`);
      let active = 0; let peak = 0;
      vi.stubGlobal("fetch", vi.fn(async (url: string) => {
        const path = String(url).replace("https://engine.test", "");
        if (path === "/v1/me") return json({ client_id: "c1", user_id: "u1", onboarding_complete: true, knowledge_engine: "ke" });
        if (path === "/v2/clients/c1/documents") return json(ids.map(id => ({ id, state: "parsed", source_filename: `${id}.txt`, created_at: at })));
        if (path === "/v1/sources") return json({ sources: [] });
        const id = path.split("/").pop()!;
        active += 1; peak = Math.max(peak, active);
        await new Promise(resolve => setTimeout(resolve, 5));
        active -= 1;
        return json({ id, state: "parsed", source_filename: `${id}.txt`, created_at: at, stage_runs: [], open_queue_items: [],
          paused_reason: null, next_eligible_at: null });
      }));
      const { GET } = await import("@/app/api/client/documents/route");

      const listed = await (await GET()).json();

      expect(listed.map((document: { id: string }) => document.id)).toEqual(ids);
      expect(peak).toBe(4);
    });
  });

  describe("uploads", () => {
    const refusals: [string, number, unknown, string][] = [
      ["monthly upload limit, with used/allowed and the reset date", 429, MONTHLY,
        "Not accepted. 30 of 30 uploads used this month. This month's upload limit is reached. It resets on 1 November at 00:00 UTC."],
      ["monthly upload limit without a readable limit", 429, { detail: "monthly_upload_limit" },
        "Not accepted. This month's upload limit is reached."],
      ["the documents daily budget, with its reset", 429, { detail: "daily_spend_cap" },
        "Not accepted. Today's document processing limit is reached. It resets at 00:00 UTC."],
      ["the deployment's daily limit, neutrally", 429, { detail: "global_daily_cap" },
        "Not accepted. Processing is paused for everyone until 00:00 UTC."],
      ["the deployment's storage, neutrally", 429, { detail: "global_watermark" },
        "Not accepted. The service can't take more files right now. Please contact support."],
      ["the account's storage", 429, { detail: "retained_bytes_cap" },
        "Not accepted. This account's file storage is full. Please contact support."],
      ["too many at once", 429, { detail: "in_flight_cap" },
        "Not accepted. Too many files are being processed at once. Add it again when one of them is finished."],
      ["no limits set", 503, { detail: "policy_missing" },
        "Not accepted. Uploads aren't set up for this account yet. Please contact support."],
      ["spend to reconcile", 503, { detail: "reconciliation_required" },
        "Not accepted. Uploads are on hold for this account until our team checks it. Please contact support."],
      ["a breached bound", 429, { detail: "bound_breached" },
        "Not accepted. Uploads are on hold for this account until our team checks it. Please contact support."],
      ["too large", 413, { detail: "File is too large to upload; the limit is 209715200 bytes." }, TOO_LARGE_COPY],
      ["an unsupported type", 415, { detail: "Unsupported media type" }, UNSUPPORTED_TYPE_COPY],
      ["the same bytes being admitted", 409, { detail: "upload_in_progress" }, IN_PROGRESS_COPY],
      ["an admission race", 409, { detail: "upload_admission_changed" }, IN_PROGRESS_COPY],
      ["any other limit", 429, { detail: "something_new" },
        "Not accepted. An upload limit for this account is reached. Please contact support."],
    ];

    it.each(refusals)("maps %s", async (_name, status, body, copy) => {
      vi.stubGlobal("fetch", backend("ke", { "POST /v2/clients/c1/documents": () => json(body, status) }).fetch);
      const { POST } = await import("@/app/api/client/documents/route");

      const response = await POST(uploadRequest());

      expect(response.status).toBe(status);
      const answer = await response.json();
      expect(answer.error).toBe(copy);
      expect(uploadErrorCopy(status, body)).toBe(copy);
      // A limit is never "try again shortly", and no raw code reaches the sentence.
      expect(answer.error).not.toMatch(/shortly|_/);
    });

    it("passes the monthly limit through beside the sentence", async () => {
      vi.stubGlobal("fetch", backend("ke", { "POST /v2/clients/c1/documents": () => json(MONTHLY, 429) }).fetch);
      const { POST } = await import("@/app/api/client/documents/route");

      const answer = await (await POST(uploadRequest())).json();

      expect(answer.limit).toEqual(MONTHLY.limit);
      expect(answer.detail).toBe("monthly_upload_limit");
    });

    it("recognises a duplicate as the same source, not a new one (A18)", async () => {
      vi.stubGlobal("fetch", backend("ke", {
        "POST /v2/clients/c1/documents": () => json({ document_id: "d1", state: "parsed", duplicate_of: "d1" }, 200),
      }).fetch);
      const { POST } = await import("@/app/api/client/documents/route");

      const response = await POST(uploadRequest());

      expect(response.status).toBe(201);
      expect(await response.json()).toMatchObject({ id: "d1", duplicate_of: "d1", knowledge: { label: "Processing" } });
      expect(DUPLICATE_UPLOAD_COPY).toBe("Already in your sources. It was not added or counted again.");
    });

    it("keeps a server error's safe sentence", async () => {
      vi.stubGlobal("fetch", backend("ke", { "POST /v2/clients/c1/documents": () => json({ detail: "boom" }, 500) }).fetch);
      const { POST } = await import("@/app/api/client/documents/route");

      const response = await POST(uploadRequest());

      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({ error: "Something broke on our side. Nothing was saved — try again." });
    });

    it("keeps M1's upload errors exactly as they were", async () => {
      vi.stubGlobal("fetch", backend("m1", {
        "POST /v1/clients/c1/documents": () => json({ detail: "monthly_upload_limit" }, 429),
      }).fetch);
      const { POST } = await import("@/app/api/client/documents/route");

      const response = await POST(uploadRequest());

      expect(response.status).toBe(429);
      expect(await response.json()).toEqual({ error: "monthly_upload_limit", detail: "monthly_upload_limit" });
    });
  });
});
