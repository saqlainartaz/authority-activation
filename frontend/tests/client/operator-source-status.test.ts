import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { keepsPollingDetail, operatorStatusLabel, operatorStatusText } from "@/app/internal/source-status";

/**
 * Cycle 5 P2.7 fix round 1 (review I2): under the rehaul engine the operator's
 * Sources panel shows each document's §7.2 status, so a failed, parked or paused
 * document no longer reads "uploaded", and its open detail stops polling once it
 * is no longer processing. Under M1 nothing changes.
 */

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("the operator's reading of a source", () => {
  const ke = (label: string, tone: string, detail?: string) =>
    ({ status: "uploaded", knowledge: { label, tone, ...(detail ? { detail } : {}) } });

  it("shows the §7.2 label under ke, never the old three-way word", () => {
    expect(operatorStatusLabel(ke("Processing delayed", "waiting", "Waiting for our team before it continues."))).toBe("Processing delayed");
    expect(operatorStatusText(ke("Processing delayed", "waiting", "Waiting for our team before it continues.")))
      .toBe("Processing delayed · Waiting for our team before it continues.");
    expect(operatorStatusText(ke("Available", "ready"))).toBe("Available");
  });

  it("keeps M1's raw status", () => {
    expect(operatorStatusLabel({ status: "atomised" })).toBe("atomised");
    expect(operatorStatusText({ status: "parsed" })).toBe("parsed");
  });

  it("polls an open ke detail only while it is processing", () => {
    expect(keepsPollingDetail(ke("Processing", "working"))).toBe(true);
    for (const [label, tone] of [["Processing delayed", "waiting"], ["Paused · daily spending limit", "waiting"],
      ["Needs your help", "action"], ["Not in use", "off"], ["Available", "ready"]] as const) {
      expect(keepsPollingDetail(ke(label, tone))).toBe(false);
    }
  });

  it("keeps M1's poll rule", () => {
    expect(keepsPollingDetail({ status: "uploaded" })).toBe(true);
    expect(keepsPollingDetail({ status: "parsed" })).toBe(true);
    expect(keepsPollingDetail({ status: "atomised" })).toBe(false);
    expect(keepsPollingDetail({ status: "failed" })).toBe(false);
  });
});

describe("the internal detail route", () => {
  const PASS = { "x-internal-passcode": "letmein" };
  const params = { params: Promise.resolve({ clientId: "c1", documentId: "d1" }) } as never;

  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("ENGINE_URL", "https://engine.test");
    vi.stubEnv("ENGINE_SERVICE_KEY", "service-key");
    vi.stubEnv("INTERNAL_PASSCODE", "letmein");
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

  it("sends the §7.2 status under ke, so a held document is not 'uploaded'", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      const path = url.replace("https://engine.test", "");
      if (path === "/v2/engine") return json({ knowledge_engine: "ke" });
      if (path === "/v2/clients/c1/documents/d1") return json({ id: "d1", state: "failed_beyond_repair", source_filename: "a.txt",
        created_at: "2026-10-06T09:00:00Z", stage_runs: [], paused_reason: null, next_eligible_at: null, open_queue_items: [] });
      if (path === "/v2/clients/c1/documents/d1/evidence?limit=1") return json({ detail: "Evidence release not found" }, 404);
      throw new Error(`unexpected ${path}`);
    }));
    const { GET } = await import("@/app/api/internal/clients/[clientId]/documents/[documentId]/route");

    const body = await (await GET(new Request("https://app.test", { headers: PASS }), params)).json();

    expect(body.knowledge).toEqual({ label: "Processing delayed", tone: "waiting", detail: "Waiting for our team before it continues." });
    expect(operatorStatusLabel(body)).toBe("Processing delayed");
    expect(keepsPollingDetail(body)).toBe(false);
  });

  it("sends no knowledge under M1", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      const path = url.replace("https://engine.test", "");
      if (path === "/v2/engine") return json({ knowledge_engine: "m1" });
      if (path === "/v1/clients/c1/documents/d1") return json({ id: "d1", source_type: "brand_doc", source_authority: "CLIENT",
        status: "parsed", pipeline_version: 1, created_at: "2026-10-06T09:00:00Z", atom_count: 0, pipeline_stages: [] });
      throw new Error(`unexpected ${path}`);
    }));
    const { GET } = await import("@/app/api/internal/clients/[clientId]/documents/[documentId]/route");

    const body = await (await GET(new Request("https://app.test", { headers: PASS }), params)).json();

    expect(body).not.toHaveProperty("knowledge");
    expect(body.status).toBe("parsed");
  });
});
