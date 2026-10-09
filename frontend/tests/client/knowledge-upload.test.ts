import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 2026-09-28: when the backend runs the new engine (`GET /v1/me` says
 * `knowledge_engine: "ke"`, from its one switch `KE_ENGINE`), a client's upload
 * goes into the knowledge engine, and its documents are shown in the Knowledge
 * screen's own shape. Otherwise nothing changes: the M1 route. `ENGINE_URL` is
 * read at module scope, hence the env stub before a dynamic import.
 */
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("knowledge-engine uploads", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("ENGINE_URL", "https://engine.test");
    vi.stubEnv("ENGINE_SERVICE_KEY", "service-key");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("follows the backend: the new engine only when /v1/me says ke", async () => {
    const { usesKnowledgeEngine } = await import("@/lib/product");
    const me = { client_id: "c1", user_id: "u1", onboarding_complete: true };
    expect(usesKnowledgeEngine({ ...me, knowledge_engine: "ke" })).toBe(true);
    expect(usesKnowledgeEngine({ ...me, knowledge_engine: "m1" })).toBe(false);
    // An older backend that does not publish it is M1.
    expect(usesKnowledgeEngine(me)).toBe(false);
  });

  it("uploads to the v2 route as the client, declaring nothing triage decides", async () => {
    const fetchMock = vi.fn(async () => json({ document_id: "d1", state: "received" }, 202));
    vi.stubGlobal("fetch", fetchMock);
    const { uploadKnowledgeDocument } = await import("@/lib/engine");

    const shown = await uploadKnowledgeDocument("c1", new File(["hello"], "interview.txt"));

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://engine.test/v2/clients/c1/documents");
    const form = init.body as FormData;
    expect(form.get("uploader_role")).toBe("client");
    expect(form.has("source_type")).toBe(false);
    expect(shown).toMatchObject({ id: "d1", status: "uploaded", source_type: "interview.txt" });
  });

  it("gives each source its own status (P2.7), keeping the three-way status for older readers", async () => {
    // Replaces the 2026-09-28 collapse, which showed every stopped state as "failed"
    // (a document paused by a spending limit included).
    const at = "2026-09-28T10:00:00Z";
    const detail = (id: string, state: string, extra: Record<string, unknown> = {}) =>
      json({ id, state, source_filename: `${id}.txt`, created_at: at, stage_runs: [], open_queue_items: [],
        paused_reason: null, next_eligible_at: null, ...extra });
    const documents = [
      { id: "ready-released", state: "ready", source_filename: "a.txt", created_at: at },
      { id: "ready-extracting", state: "ready", source_filename: "b.txt", created_at: at },
      { id: "cleaning", state: "cleaning", source_filename: "c.txt", created_at: at },
      { id: "stopped", state: "failed_clean", source_filename: "d.txt", created_at: at },
      { id: "paused", state: "budget_paused", source_filename: "e.txt", created_at: at },
      { id: "withdrawn", state: "withdrawn", source_filename: "f.txt", created_at: at },
    ];
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith("/v2/clients/c1/documents")) return json(documents);
      if (url.includes("/ready-released/evidence/status")) return json({ state: "active" });
      if (url.includes("/ready-extracting/evidence/status")) return json({ detail: "Evidence release not found" }, 404);
      if (url.endsWith("/documents/ready-extracting")) return detail("ready-extracting", "ready");
      if (url.endsWith("/documents/cleaning")) return detail("cleaning", "cleaning");
      if (url.endsWith("/documents/stopped")) return detail("stopped", "failed_clean");
      if (url.endsWith("/documents/paused")) return detail("paused", "budget_paused", { paused_reason: "other" });
      throw new Error(`unexpected ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const { listKnowledgeDocuments } = await import("@/lib/engine");

    const shown = await listKnowledgeDocuments("c1");

    expect(shown.map(document => [document.id, document.status, document.knowledge?.label])).toEqual([
      ["ready-released", "atomised", "Available"],
      ["ready-extracting", "uploaded", "Processing"],
      ["cleaning", "uploaded", "Processing"],
      ["stopped", "uploaded", "Processing delayed"],
      ["paused", "uploaded", "Processing delayed"],
      ["withdrawn", "failed", "Not in use"],
    ]);
    // A usable source and a closed one cost no detail read.
    const read = (fetchMock.mock.calls as unknown as [string][]).map(([url]) => url);
    expect(read.some(url => url.endsWith("/documents/ready-released"))).toBe(false);
    expect(read.some(url => url.includes("/documents/withdrawn"))).toBe(false);
  });
});
