import { FileText, Plus, RotateCw, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DialogFooter } from '@/components/ui/dialog';
import { DELETED_NOTICE } from '@/lib/source-switch';
import { offersSourceActions, showsKnowledgeStatus, sourceRowView, type Engine, type ServerDocument } from './knowledge-view';

// A connected source's row and its popup actions (Cycle 5 P2.7). Under M1 both
// render exactly the markup the Knowledge screen always had; under the rehaul
// engine the row shows the §7.2 status and the popup offers no delete and no
// reprocess until P8. A source paused by the client's own daily spending limit
// offers "View usage" (spec §7.4), when the app can open Settings.

/** A source's business labels (P7.2): the visible profiles it is about, as chips. */
export function SourceLabels({ names }: { names: string[] }) {
  return <span className="rf-source-labels">{names.map((name, index) => <span key={`${index}-${name}`} className="rf-source-label">{name}</span>)}</span>;
}

export function ServerSourceRow({ document, engine, onOpen, onViewUsage }: {
  document: ServerDocument; engine: Engine; onOpen: () => void; onViewUsage?: () => void;
}) {
  if (!showsKnowledgeStatus(engine, document)) {
    return <li className="rf-uploaded-source"><Button variant="ghost" className="rf-source-open" onClick={onOpen}><FileText /><b>{document.source_type.replaceAll('_', ' ')}<small>{document.id.slice(0, 8)} · {document.status}</small></b><span className="rf-source-meta">{document.status === 'atomised' ? 'Learned' : document.status === 'failed' ? 'Failed' : 'Processing'}</span></Button></li>;
  }
  const view = sourceRowView(document, engine);
  return <li className="rf-uploaded-source"><Button variant="ghost" className="rf-source-open" onClick={onOpen}><FileText /><b>{view.title}<small>{view.detail}</small>{view.labels && view.labels.length > 0 && <SourceLabels names={view.labels} />}</b><span className="rf-source-meta" data-tone={view.tone}>{view.meta}</span></Button>{document.knowledge.usage_limited && onViewUsage && <Button variant="link" size="sm" className="rf-source-usage" onClick={onViewUsage}>View usage</Button>}</li>;
}

export function ServerSourceFooter({ document, engine, busy, onRemove, onReprocess, onViewUsage }: {
  document: ServerDocument; engine: Engine; busy: boolean; onRemove: () => void; onReprocess: () => void; onViewUsage?: () => void;
}) {
  if (!offersSourceActions(engine, document)) {
    return showsKnowledgeStatus(engine, document) && document.knowledge.usage_limited && onViewUsage
      ? <DialogFooter><Button variant="outline" onClick={onViewUsage}>View usage</Button></DialogFooter>
      : null;
  }
  return <DialogFooter><Button variant="ghost" disabled={busy} onClick={onRemove}><Trash2 /> Remove</Button><Button variant="outline" disabled={busy} onClick={onReprocess}><RotateCw /> Reprocess</Button></DialogFooter>;
}

/** Shown once when a file the client deleted has left the list (P8.3; D12 wording). */
export function DeletedNotice({ onDismiss }: { onDismiss: () => void }) {
  return <p className="rf-knowledge-deleted" role="status">{DELETED_NOTICE}<Button variant="link" size="sm" onClick={onDismiss}>Dismiss</Button></p>;
}

export const NO_FILES_TITLE = 'No files yet';
export const CLEAR_SEARCH = 'Clear search';

/** The rehaul list's two empty states (P7.2; spec §7.1, A35): no files at all
 *  (Add files), and a name search that matches none (Clear search). Nothing
 *  when the list shows rows. */
export function SourceListEmpty({ total, shown, query, onAddFiles, onClearSearch }: {
  total: number; shown: number; query: string; onAddFiles: () => void; onClearSearch: () => void;
}) {
  if (!total) {
    return <div className="rf-empty rf-source-empty"><h2>{NO_FILES_TITLE}</h2><p>Add documents, transcripts or notes, and each one shows its status here.</p><Button variant="outline" onClick={onAddFiles}><Plus /> Add files</Button></div>;
  }
  if (shown) return null;
  return <div className="rf-empty rf-source-empty"><h2>No sources match “{query.trim()}”</h2><p>Search looks at file names.</p><Button variant="outline" onClick={onClearSearch}>{CLEAR_SEARCH}</Button></div>;
}
