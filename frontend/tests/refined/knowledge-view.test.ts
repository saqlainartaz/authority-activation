import { describe, expect, it } from "vitest";

import { deletingStatus } from "@/lib/knowledge-status";

import {
  coverageCards, filterSources, finishedDeleting, knowledgeRefreshDelay, markDeleting, matchesSourceSearch,
  offersSourceActions, showsKnowledgeStatus,
  showsSourceList, sourceDialogDescription, sourceLabelNames, sourceName, sourceRowView, sourceStatusText,
  sourceTypeAndDate, uploadNote, type ServerDocument,
} from "@/refined/knowledge-view";

/**
 * Cycle 5 P2.7 (spec §7.1-7.3, A47): the Knowledge screen's display rules. The
 * §7.2 status shows only when the app knows it runs the rehaul engine; under M1,
 * and while the engine is unknown, every rule gives what the screen always showed.
 */

const M1_DOC: ServerDocument = {
  id: "0123456789ab", source_type: "brand_doc", source_authority: "CONVERSATIONAL", status: "atomised",
  created_at: "2026-10-01T10:00:00Z",
};
const KE_DOC: ServerDocument = {
  id: "abcdef012345", source_type: "board_pack.pdf", source_authority: "CLIENT", status: "uploaded",
  created_at: "2026-10-06T09:00:00Z",
  knowledge: { label: "Paused · daily spending limit", tone: "waiting", detail: "Continues after 00:01 UTC on 7 October",
    resumes_at: "2026-10-07T00:01:00.000Z" },
};

describe("which rendering a source gets", () => {
  it("shows the §7.2 status only under ke", () => {
    expect(showsKnowledgeStatus("ke", KE_DOC)).toBe(true);
    expect(showsKnowledgeStatus(null, KE_DOC)).toBe(false);
    expect(showsKnowledgeStatus("m1", KE_DOC)).toBe(false);
    expect(showsKnowledgeStatus("ke", M1_DOC)).toBe(false);
  });

  it("offers Remove and Reprocess only for an M1 source", () => {
    expect(offersSourceActions("m1", M1_DOC)).toBe(true);
    // Engine still unknown: an M1 source keeps its controls (A47) ...
    expect(offersSourceActions(null, M1_DOC)).toBe(true);
    // ... and a rehaul source never gets them, known engine or not.
    expect(offersSourceActions(null, KE_DOC)).toBe(false);
    expect(offersSourceActions("ke", KE_DOC)).toBe(false);
  });
});

describe("the row and the popup", () => {
  it("print the label and its detail under ke", () => {
    const row = sourceRowView(KE_DOC, "ke");
    expect(row.title).toBe("board pack.pdf");
    expect(row.meta).toBe("Paused · daily spending limit");
    expect(row.tone).toBe("waiting");
    expect(row.detail).toMatch(/ · Continues after 00:01 UTC on 7 October$/);
    expect(sourceDialogDescription(KE_DOC, "ke")).toBe("Paused · daily spending limit · Continues after 00:01 UTC on 7 October");
    expect(sourceStatusText(KE_DOC, "ke")).toBe("Paused · daily spending limit");
  });

  it("print exactly the old copy under M1", () => {
    expect(sourceRowView(M1_DOC, "m1")).toEqual({ title: "brand doc", detail: "01234567 · atomised", meta: "Learned" });
    expect(sourceRowView({ ...M1_DOC, status: "failed" }, "m1").meta).toBe("Failed");
    expect(sourceRowView({ ...M1_DOC, status: "parsed" }, "m1").meta).toBe("Processing");
    expect(sourceDialogDescription(M1_DOC, "m1"))
      .toBe("Persisted source · atomised. Original-file download is not exposed by the previous backend.");
    expect(sourceStatusText(M1_DOC, "m1")).toBe("atomised");
    expect(uploadNote("m1")).toBe("Uploads are persisted by the connected engine. “Learned” appears only after atomisation completes.");
  });

  it("never flash the new labels while the engine is unknown", () => {
    expect(sourceRowView(KE_DOC, null).meta).toBe("Processing");
    expect(sourceStatusText(KE_DOC, null)).toBe("uploaded");
    expect(uploadNote(null)).toBe(uploadNote("m1"));
    expect(coverageCards([KE_DOC], null)[1][0]).toBe("Learned");
  });
});

describe("the summary cards", () => {
  it("count available and needs-your-help sources under ke", () => {
    const docs: ServerDocument[] = [
      { ...KE_DOC, id: "1", knowledge: { label: "Available", tone: "ready" } },
      { ...KE_DOC, id: "2", knowledge: { label: "Processed · no usable information", tone: "ready" } },
      { ...KE_DOC, id: "3", knowledge: { label: "Needs your help", tone: "action", detail: "x" } },
      KE_DOC,
    ];
    expect(coverageCards(docs, "ke")).toEqual([
      ["Sources", "4 total", 100], ["Available", "1 available", 25], ["Needs your help", "1 source", 25],
    ]);
    expect(coverageCards([], "ke")[2]).toEqual(["Needs your help", "Nothing needs your help", 0]);
  });

  it("keep M1's three cards", () => {
    expect(coverageCards([M1_DOC, { ...M1_DOC, id: "x", status: "failed" }], "m1")).toEqual([
      ["Sources", "2 total", 100], ["Learned", "1 atomised", 50], ["Needs attention", "1 failed", 50],
    ]);
  });
});

describe("when the rehaul list is read again", () => {
  const NOW = Date.parse("2026-10-06T23:00:00Z");
  const at = (label: "Processing" | "Available" | "Processing delayed", tone: "working" | "ready" | "waiting", resumes?: string): ServerDocument =>
    ({ ...KE_DOC, knowledge: { label, tone, ...(resumes ? { resumes_at: resumes } : {}) } });

  it("soon while a source is processing", () => {
    expect(knowledgeRefreshDelay([at("Available", "ready"), at("Processing", "working")], NOW)).toBe(5_000);
  });

  it("at the time a paused source continues", () => {
    expect(knowledgeRefreshDelay([KE_DOC], NOW)).toBe(Date.parse("2026-10-07T00:01:00Z") - NOW);
  });

  it("slowly for a source waiting for a person, and not at all when all are settled", () => {
    expect(knowledgeRefreshDelay([at("Processing delayed", "waiting"), at("Available", "ready")], NOW)).toBe(60_000);
    expect(knowledgeRefreshDelay([at("Available", "ready")], NOW)).toBeNull();
    expect(knowledgeRefreshDelay([M1_DOC], NOW)).toBeNull();
  });

  it("on the normal cadence for a failed stage the engine may retry by itself", () => {
    const failed: ServerDocument = { ...KE_DOC, knowledge: { label: "Processing delayed", tone: "waiting", detail: "No retry is scheduled yet.", recheck: true } };
    expect(knowledgeRefreshDelay([KE_DOC, failed], NOW)).toBe(5_000);
  });
});

// ---- Cycle 5 P7.2 (spec §7.1, A17) ------------------------------------------

describe("the rehaul list: names, labels and name search (A17)", () => {
  const source = (id: string, filename: string, labels: string[] = []): ServerDocument => ({
    ...KE_DOC, id, filename, created_at: "2026-10-06T23:30:00Z",
    knowledge: { label: "Available", tone: "ready" }, labels: labels.map(label => ({ label, kind: "organization" })),
  });
  const MIXED = source("1", "Acme_and_Beta joint brief.pdf", ["Acme Physio", "Beta Fitness"]);
  const PRICING = source("2", "pricing 2026.DOCX", ["Acme Physio"]);
  const CALL = source("3", "Discovery call.vtt");
  const ALL = [MIXED, PRICING, CALL];

  it("shows the file name as given, its type and UTC date, the status, and every label", () => {
    expect(sourceName(MIXED)).toBe("Acme_and_Beta joint brief.pdf");
    expect(sourceTypeAndDate(MIXED)).toBe("PDF · 6 Oct 2026");
    expect(sourceTypeAndDate(PRICING)).toBe("DOCX · 6 Oct 2026");
    expect(sourceLabelNames(MIXED)).toEqual(["Acme Physio", "Beta Fitness"]);
    expect(sourceRowView(MIXED, "ke")).toEqual({
      title: "Acme_and_Beta joint brief.pdf", detail: "PDF · 6 Oct 2026", meta: "Available", tone: "ready",
      labels: ["Acme Physio", "Beta Fitness"],
    });
    // A source with no label gets none invented.
    expect(sourceRowView(CALL, "ke").labels).toEqual([]);
  });

  it("filters by name, ignoring case, and an empty or cleared search restores the list", () => {
    expect(filterSources(ALL, "acme").map(document => document.id)).toEqual(["1"]);
    expect(filterSources(ALL, "  PRICING ").map(document => document.id)).toEqual(["2"]);
    // Labels are not names: a label alone does not match.
    expect(filterSources(ALL, "Beta Fitness")).toEqual([]);
    expect(filterSources(ALL, "invoice")).toEqual([]);
    expect(filterSources(ALL, "")).toEqual(ALL);
    expect(matchesSourceSearch(CALL, "call")).toBe(true);
  });

  it("applies only on the rehaul engine, outside the demo", () => {
    expect(showsSourceList("ke", false)).toBe(true);
    expect(showsSourceList("ke", true)).toBe(false);
    expect(showsSourceList("m1", false)).toBe(false);
    expect(showsSourceList(null, false)).toBe(false);
  });
});

describe("Delete file in the list (P8.3)", () => {
  const live = { ...KE_DOC, id: "a", knowledge: { label: "Available" as const, tone: "ready" as const } };
  const other = { ...live, id: "b" };

  it("shows a file as Deleting at once, closed and with no switch, and reads the list again soon", () => {
    const [a, b] = markDeleting([live, other], new Set(["a"]), deletingStatus());
    expect(a).toMatchObject({ id: "a", deleting: true, closed: true, use: null, knowledge: { label: "Deleting", recheck: true } });
    expect(b).toBe(other);
    expect(knowledgeRefreshDelay([a], Date.now())).not.toBeNull();
  });

  it("names the files whose purge finished: Deleting before, gone now", () => {
    const [deleting] = markDeleting([live], new Set(["a"]), deletingStatus());
    expect(finishedDeleting([deleting, other], [other])).toEqual(["a"]);
    expect(finishedDeleting([deleting, other], [deleting, other])).toEqual([]);
    // A file that simply left the list without being deleted here is not announced.
    expect(finishedDeleting([live, other], [other])).toEqual([]);
  });
});
