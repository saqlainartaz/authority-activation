// What the operator's Sources panel shows as a document's status, and whether its
// open detail keeps polling (Cycle 5 P2.7, fix round 1). Pure. Under the rehaul
// engine every row carries the §7.2 status the BFF computed (`knowledge`), so a
// failed, parked or paused document no longer reads "uploaded". Under M1 a row
// has no `knowledge` and everything reads exactly as before.

export type OperatorKnowledge = { label: string; tone: string; detail?: string };
export type OperatorSource = { status: string; knowledge?: OperatorKnowledge };

/** The list row's status word: the §7.2 label under ke, the raw status under M1. */
export function operatorStatusLabel(source: OperatorSource): string {
  return source.knowledge ? source.knowledge.label : source.status;
}

/** The detail's Status: the label and its one-line reason under ke. */
export function operatorStatusText(source: OperatorSource): string {
  const knowledge = source.knowledge;
  if (!knowledge) return source.status;
  return knowledge.detail ? `${knowledge.label} · ${knowledge.detail}` : knowledge.label;
}

/** Whether the open detail is read again (every 750 ms): only while it is still
 *  processing. Under ke a paused, delayed, held, settled or unused document stops
 *  the poll, as a finished one always did; under M1 the old rule. */
export function keepsPollingDetail(source: OperatorSource): boolean {
  if (source.knowledge) return source.knowledge.tone === "working";
  return !["atomised", "failed"].includes(source.status);
}
