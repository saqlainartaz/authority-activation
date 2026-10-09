import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 2026-10-02: the operator's internal documents panel follows the backend's one
 * switch, as the client's Knowledge screen does. `GET /v2/engine` says which
 * engine runs (`KE_ENGINE=live` -> "ke"); the panel then lists, uploads, shows
 * and removes through that engine. Real route handlers; only `fetch` is faked.
 */
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

type Call = [string, RequestInit | undefined];

function backend(engine: "m1" | "ke" | "missing", routes: Record<string, (init?: RequestInit) => Response>) {
  return vi.fn(async (url: string, init?: RequestInit) => {
    const path = url.replace("https://engine.test", "");
    if (path === "/v2/engine") {
      return engine === "missing" ? json({ detail: "Not Found" }, 404) : json({ knowledge_engine: engine });
    }
    const key = `${init?.method ?? "GET"} ${path}`;
    const handler = routes[key];
    if (!handler) throw new Error(`unexpected call ${key}`);
    return handler(init);
  });
}

const PASS = { "x-internal-passcode": "letmein" };
const params = (clientId: string, documentId?: string) =>
  ({ params: Promise.resolve(documentId ? { clientId, documentId } : { clientId }) }) as never;

describe("the internal panel follows the engine switch", () => {
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

  it("uploads to the new engine as the operator when the backend says ke", async () => {
    const fetchMock = backend("ke", {
      "POST /v2/clients/c1/documents": () => json({ document_id: "d1", state: "received" }, 202),
    });
    vi.stubGlobal("fetch", fetchMock);
    const { POST } = await import("@/app/api/internal/clients/[clientId]/documents/route");
    const form = new FormData();
    form.set("file", new File(["hello"], "pack.txt"));
    form.set("source_type", "brand_doc");

    const response = await POST(new Request("https://app.test", { method: "POST", headers: PASS, body: form }),
      params("c1"));

    expect(response.status).toBe(201);
    const sent = (fetchMock.mock.calls as unknown as Call[]).find(([url]) => url.endsWith("/v2/clients/c1/documents"));
    const body = sent![1]!.body as FormData;
    expect(body.get("uploader_role")).toBe("operator");
    expect(body.has("source_type")).toBe(false);
    expect((await response.json()).pipeline_version).toBe(2);
  });

  it.each(["m1", "missing"] as const)("keeps the M1 route when the backend says %s", async (engine) => {
    const fetchMock = backend(engine, {
      "POST /v1/clients/c1/documents": () => json({ id: "d1", status: "uploaded", pipeline_version: 1 }, 201),
      "GET /v1/clients/c1/documents": () => json([]),
    });
    vi.stubGlobal("fetch", fetchMock);
    const { GET, POST } = await import("@/app/api/internal/clients/[clientId]/documents/route");
    const form = new FormData();
    form.set("file", new File(["hello"], "pack.txt"));

    expect((await POST(new Request("https://app.test", { method: "POST", headers: PASS, body: form }),
      params("c1"))).status).toBe(201);
    expect((await GET(new Request("https://app.test", { headers: PASS }), params("c1"))).status).toBe(200);
    const paths = (fetchMock.mock.calls as unknown as Call[]).map(([url]) => url);
    expect(paths.some((url) => url.includes("/v2/clients/"))).toBe(false);
  });

  it("lists, shows and removes through the new engine", async () => {
    const fetchMock = backend("ke", {
      "GET /v2/clients/c1/documents": () => json([{ id: "d1", state: "ready", source_filename: "pack.txt",
        created_at: "2026-10-02T10:00:00Z" }]),
      "GET /v2/clients/c1/documents/d1/evidence/status": () => json({ state: "active" }),
      "GET /v2/clients/c1/documents/d1": () => json({ id: "d1", state: "ready", source_filename: "pack.txt",
        created_at: "2026-10-02T10:00:00Z", stage_runs: [
          { stage: "parse", status: "failed", finished_at: "2026-10-02T10:01:00Z" },
          { stage: "parse", status: "succeeded", finished_at: "2026-10-02T10:02:00Z" },
          { stage: "clean", status: "succeeded", finished_at: "2026-10-02T10:03:00Z" },
          { stage: "extraction", status: "succeeded", finished_at: "2026-10-02T10:04:00Z" },
          { stage: "comprehend", status: "succeeded", finished_at: "2026-10-02T10:05:00Z" },
          // Failed and never succeeded: not shown as done.
          { stage: "evidence_index", status: "failed", finished_at: "2026-10-02T10:06:00Z" },
        ] }),
      "GET /v2/clients/c1/documents/d1/evidence?limit=1": () => json({ total: 7 }),
      "POST /v2/clients/c1/documents/d1/transitions": () => json({ job_id: "j1" }, 202),
    });
    vi.stubGlobal("fetch", fetchMock);
    const list = await import("@/app/api/internal/clients/[clientId]/documents/route");
    const one = await import("@/app/api/internal/clients/[clientId]/documents/[documentId]/route");

    const listed = await (await list.GET(new Request("https://app.test", { headers: PASS }), params("c1"))).json();
    expect(listed).toMatchObject([{ id: "d1", status: "atomised", pipeline_version: 2 }]);

    const detail = await (await one.GET(new Request("https://app.test", { headers: PASS }), params("c1", "d1"))).json();
    expect(detail.atom_count).toBe(7);
    expect(detail.pipeline_stages).toEqual([
      { stage: "parse", actor: "knowledge engine", completed_at: "2026-10-02T10:02:00Z" },
      { stage: "clean", actor: "knowledge engine", completed_at: "2026-10-02T10:03:00Z" },
      { stage: "atomise", actor: "knowledge engine", completed_at: "2026-10-02T10:04:00Z" },
    ]);

    const removed = await one.DELETE(new Request("https://app.test", { method: "DELETE", headers: PASS }),
      params("c1", "d1"));
    expect(removed.status).toBe(204);
    const withdraw = (fetchMock.mock.calls as unknown as Call[]).find(([url]) => url.endsWith("/d1/transitions"));
    expect(JSON.parse(String(withdraw![1]!.body))).toEqual({ event: "withdraw", actor_role: "operator" });
  });

  it("says plainly that the new engine has no reprocess, and calls nothing", async () => {
    const fetchMock = backend("ke", {});
    vi.stubGlobal("fetch", fetchMock);
    const one = await import("@/app/api/internal/clients/[clientId]/documents/[documentId]/route");

    const response = await one.POST(new Request("https://app.test", { method: "POST", headers: PASS }),
      params("c1", "d1"));

    expect(response.status).toBe(409);
    expect((await response.json()).error).toContain("not available for the new engine");
    expect((fetchMock.mock.calls as unknown as Call[]).map(([url]) => url)).toEqual(["https://engine.test/v2/engine"]);
  });

  it("counts nothing extracted when no evidence is released yet", async () => {
    vi.stubGlobal("fetch", backend("ke", {
      "GET /v2/clients/c1/documents/d1": () => json({ id: "d1", state: "cleaning", source_filename: "pack.txt",
        created_at: "2026-10-02T10:00:00Z", stage_runs: [] }),
      "GET /v2/clients/c1/documents/d1/evidence?limit=1": () => json({ detail: "Evidence release not found" }, 404),
    }));
    const one = await import("@/app/api/internal/clients/[clientId]/documents/[documentId]/route");

    const detail = await (await one.GET(new Request("https://app.test", { headers: PASS }), params("c1", "d1"))).json();
    expect(detail.atom_count).toBe(0);
    expect(detail.status).toBe("uploaded");
  });
});
