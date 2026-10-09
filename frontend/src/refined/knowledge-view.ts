// The Knowledge screen's display rules, pure (Cycle 5 P2.7; spec §7.1-7.3, A47).
// No React and no fetch, so every rule is testable without rendering.
//
// - Under the rehaul engine each source shows its §7.2 status, which the BFF
//   computed (`knowledge`), and offers no delete and no reprocess until P8.
// - Under M1, and while the engine is still unknown, every source renders exactly
//   as it always did. The new labels never flash before the engine is known.

import type { KnowledgeStatus, KnowledgeTone, SourceUse } from '@/lib/knowledge-status';
import type { SourceLabel } from '@/lib/source-overview';
import { uploadTypeName } from '@/lib/upload-contract';
import { utcDay } from '@/lib/utc-reset';

export type ServerDocument = {
  id: string;
  source_type: string;
  source_authority: string;
  status: 'uploaded' | 'parsed' | 'cleaned' | 'atomised' | 'failed';
  created_at: string;
  atom_count?: number;
  /** Rehaul engine only: the §7.2 status. */
  knowledge?: KnowledgeStatus;
  /** Rehaul engine uploads only: identical bytes were already this source (A18). */
  duplicate_of?: string | null;
  /** Rehaul engine only (P7.2): the retained file name, as uploaded. */
  filename?: string;
  /** Rehaul engine only: withdrawn or superseded, so "Use this source" cannot act on it. */
  closed?: boolean;
  /** Rehaul engine only (P7.2): the visible business profiles this source is about. */
  labels?: SourceLabel[];
  /** Rehaul engine only (P7.2): "Use this source"; null for a closed source. */
  use?: SourceUse | null;
  /** Rehaul engine only (P8.3): Delete file was asked; "Deleting" until its purge finishes. */
  deleting?: boolean;
};

export type Engine = 'ke' | 'm1' | null;

/** Whether this source shows its §7.2 status: the app knows it runs the rehaul
 *  engine AND the BFF sent the status. */
export function showsKnowledgeStatus(engine: Engine, document: ServerDocument): document is ServerDocument & { knowledge: KnowledgeStatus } {
  return engine === 'ke' && document.knowledge !== undefined;
}

/** Remove and Reprocess are M1's. A rehaul-engine source has neither until P8,
 *  even while the app has not yet learned the engine: the document itself says so. */
export function offersSourceActions(engine: Engine, document: ServerDocument): boolean {
  return engine !== 'ke' && document.knowledge === undefined;
}

const addedOn = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

export type SourceRowView = { title: string; detail: string; meta: string; tone?: KnowledgeTone; labels?: string[] };

// ---- P7.2: the rehaul source's identity, labels and name search ---------------

/** The source's name as the client gave it: the retained file name (P7.2), or
 *  the older type slot when the BFF sent no file name. */
export function sourceName(document: ServerDocument): string {
  return document.filename ?? document.source_type.replaceAll('_', ' ');
}

/** "PDF · 6 Oct 2026": its type (from the upload contract) and the UTC day it was added. */
export function sourceTypeAndDate(document: ServerDocument): string {
  return [uploadTypeName(sourceName(document)), utcDay(document.created_at, { short: true, year: true })]
    .filter(Boolean).join(' · ');
}

/** The business labels to print, as the backend chose them; none is invented. */
export function sourceLabelNames(document: ServerDocument): string[] {
  return (document.labels ?? []).map(label => label.label);
}

/** Name search (spec §7.1, A17): case-insensitive, on the name only; an empty query matches all. */
export function matchesSourceSearch(document: ServerDocument, query: string): boolean {
  const wanted = query.trim().toLocaleLowerCase();
  return !wanted || sourceName(document).toLocaleLowerCase().includes(wanted);
}

export function filterSources(documents: ServerDocument[], query: string): ServerDocument[] {
  return documents.filter(document => matchesSourceSearch(document, query));
}

/** Whether the rehaul list (search, labels, the new popup) applies: ke, not the demo. */
export function showsSourceList(engine: Engine, isDemo: boolean): boolean {
  return engine === 'ke' && !isDemo;
}

export function sourceRowView(document: ServerDocument, engine: Engine): SourceRowView {
  const title = document.source_type.replaceAll('_', ' ');
  if (showsKnowledgeStatus(engine, document)) {
    const { label, tone, detail } = document.knowledge;
    if (document.filename !== undefined) {
      // P7.2: name, type and date, then the status line; labels beside it.
      return {
        title: document.filename, detail: [sourceTypeAndDate(document), detail].filter(Boolean).join(' · '),
        meta: label, tone, labels: sourceLabelNames(document),
      };
    }
    return { title, detail: [addedOn(document.created_at), detail].filter(Boolean).join(' · '), meta: label, tone };
  }
  return {
    title,
    detail: `${document.id.slice(0, 8)} · ${document.status}`,
    meta: document.status === 'atomised' ? 'Learned' : document.status === 'failed' ? 'Failed' : 'Processing',
  };
}

/** The popup's description line under the source's name. */
export function sourceDialogDescription(document: ServerDocument, engine: Engine): string {
  if (showsKnowledgeStatus(engine, document)) {
    const { label, detail } = document.knowledge;
    return detail ? `${label} · ${detail}` : label;
  }
  return `Persisted source · ${document.status}. Original-file download is not exposed by the previous backend.`;
}

/** The popup's Status value. */
export function sourceStatusText(document: ServerDocument, engine: Engine): string {
  return showsKnowledgeStatus(engine, document) ? document.knowledge.label : document.status;
}

/** The ids of files that were Deleting in `previous` and are gone from `current`:
 *  their purge finished (P8.3). Each is announced once, with `DELETED_NOTICE`. */
export function finishedDeleting(previous: ServerDocument[], current: ServerDocument[]): string[] {
  const listed = new Set(current.map(document => document.id));
  return previous.filter(document => document.deleting && !listed.has(document.id)).map(document => document.id);
}

/** The list with these files shown as Deleting at once, before the next read confirms it. */
export function markDeleting(documents: ServerDocument[], ids: ReadonlySet<string>, deleting: ServerDocument['knowledge']): ServerDocument[] {
  return documents.map(document => ids.has(document.id) && !document.deleting && deleting
    ? { ...document, deleting: true, closed: true, use: null, knowledge: deleting }
    : document);
}

export type CoverageCard = [title: string, label: string, width: number];

const share = (part: number, whole: number) => whole ? Math.round(part / whole * 100) : 0;

/** The three summary cards above the list for a connected client. */
export function coverageCards(documents: ServerDocument[], engine: Engine): CoverageCard[] {
  const total = documents.length;
  if (engine === 'ke' && documents.every(document => document.knowledge !== undefined)) {
    const available = documents.filter(document => document.knowledge!.tone === 'ready' && document.knowledge!.label !== 'Processed · no usable information').length;
    const help = documents.filter(document => document.knowledge!.tone === 'action').length;
    return [
      ['Sources', `${total} total`, total ? 100 : 0],
      ['Available', `${available} available`, share(available, total)],
      ['Needs your help', help ? `${help} ${help === 1 ? 'source' : 'sources'}` : 'Nothing needs your help', share(help, total)],
    ];
  }
  const learned = documents.filter(document => document.status === 'atomised').length;
  const failed = documents.filter(document => document.status === 'failed').length;
  return [
    ['Sources', `${total} total`, total ? 100 : 0],
    ['Learned', `${learned} atomised`, share(learned, total)],
    ['Needs attention', failed ? `${failed} failed` : 'No failures', share(failed, total)],
  ];
}

/** The note under Add files for a connected client. */
export function uploadNote(engine: Engine): string {
  return engine === 'ke'
    ? 'Each file shows its own status here. “Available” means its information can be used.'
    : 'Uploads are persisted by the connected engine. “Learned” appears only after atomisation completes.';
}

export const SOON_MS = 5_000;
/** A source waiting for a person has no time; a person may still lift the hold. */
export const SLOW_MS = 60_000;
const LATEST_MS = 6 * 60 * 60 * 1000;

/** When to read a rehaul-engine list again, in ms, or null when every source is
 *  settled: soon while a source is processing or may be retried by the engine on
 *  its own, at the time a paused or delayed source continues, and slowly while a
 *  source waits for a person. */
export function knowledgeRefreshDelay(documents: ServerDocument[], now: number): number | null {
  let delay: number | null = null;
  const consider = (wait: number) => { delay = delay === null ? wait : Math.min(delay, wait); };
  for (const document of documents) {
    const knowledge = document.knowledge;
    if (!knowledge) continue;
    if (knowledge.tone === 'working' || knowledge.recheck) return SOON_MS;
    if (knowledge.tone !== 'waiting') continue;
    const at = knowledge.resumes_at ? Date.parse(knowledge.resumes_at) : Number.NaN;
    consider(Number.isNaN(at) ? SLOW_MS : Math.min(LATEST_MS, Math.max(SOON_MS, at - now)));
  }
  return delay;
}
