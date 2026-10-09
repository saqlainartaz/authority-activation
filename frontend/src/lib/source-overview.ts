// A knowledge-engine source's business labels and "Use this source" state, put
// onto the document the Knowledge screen shows (Cycle 5 P7.2; spec §7.1-7.3,
// A17, A21). Client-safe and pure: the BFF reads `GET /v1/sources` once per list
// (or detail) and calls `applySourceOverview`; the screen only prints the result.
//
// - `labels`: the visible managed profiles the source is about, as the backend
//   chose them (`visible_profiles`); none is ever invented here.
// - `use`: the client's switch. A source the overview does not list is on at
//   revision 0 (the backend's own reading). An off source reads "Not in use"
//   with the CLIENT's wording; a pending one keeps its status and says what is
//   pending.
// - A withdrawn or superseded source (`closed`: the operator's Stop processing,
//   or a newer upload) has NO switch (`use: null`) and keeps its own status:
//   the switch cannot act on it and must never be confused with it.

import { legacyStatus, withSourceUse, type KnowledgeStatus, type SourceUse } from "./knowledge-status";

export type SourceLabel = { label: string; kind: string };

export type SourceOverviewEntry = {
  document_id: string;
  labels: SourceLabel[];
  /** `deleting`/`deleted` (P8.2): a deleted file; the list shows it as Deleting, never switchable. */
  use: { state: SourceUse["state"] | "deleting" | "deleted"; requested: SourceUse["requested"]; revision: number };
};

/** A source never switched: on, at revision 0. */
export const SOURCE_ON: SourceUse = { state: "on", requested: null, revision: 0 };

type Overviewed = {
  id: string;
  status: string;
  closed?: boolean;
  knowledge?: KnowledgeStatus;
  labels?: SourceLabel[];
  use?: SourceUse | null;
};

export function applySourceOverview<T extends Overviewed>(documents: T[], overview: SourceOverviewEntry[]): T[] {
  const byId = new Map(overview.map(entry => [entry.document_id, entry]));
  return documents.map(document => {
    const entry = byId.get(document.id);
    const labels = (entry?.labels ?? []).map(({ label, kind }) => ({ label, kind }));
    if (document.closed) return { ...document, labels, use: null };
    // A deleted file the list still calls live (the two reads raced) is at least not in use.
    const raw = entry?.use.state;
    const state: SourceUse["state"] | undefined = raw === "deleting" || raw === "deleted" ? "off" : raw;
    const use: SourceUse = entry && state
      ? { state, requested: entry.use.requested, revision: entry.use.revision }
      : SOURCE_ON;
    if (!document.knowledge) return { ...document, labels, use };
    const knowledge = withSourceUse(document.knowledge, use);
    return { ...document, labels, use, knowledge, status: legacyStatus(knowledge) };
  });
}
