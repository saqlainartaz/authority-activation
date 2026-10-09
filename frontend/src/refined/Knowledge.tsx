import { useEffect, useRef, useState, type DragEvent } from 'react';
import { FileText, FileUp, FolderOpen, Download, Trash2, Mic, Globe, Sheet, LoaderCircle, Plus, RotateCw, Search } from 'lucide-react';
import { KNOWLEDGE_UPLOAD_ACCEPT, UPLOAD_LIMITS_COPY, UPLOAD_TYPES_COPY, uploadIssue } from '@/lib/upload-contract';
import { DUPLICATE_UPLOAD_COPY, refusalShowsUsage } from '@/lib/upload-errors';
import { utcTime } from '@/lib/utc-reset';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogTrigger, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { toast } from 'sonner';
import ChannelMark from './ChannelMark';
import { ACCEPT, fileIssue, fileKey, fileSize, readDocuments, saveDocument, removeDocument as removeLocalDocument, type LocalDocument } from './documents';
import { useData } from './state';
import { coverageCards, filterSources, finishedDeleting, markDeleting, showsSourceList, sourceDialogDescription, sourceStatusText, uploadNote, type ServerDocument } from './knowledge-view';
import { deletingStatus } from '@/lib/knowledge-status';
import { KnowledgeRefresher } from './knowledge-refresh';
import { uploadBatch } from './knowledge-upload';
import { DeletedNotice, ServerSourceFooter, ServerSourceRow, SourceListEmpty } from './KnowledgeSource';
import SourcePopup from './SourcePopup';
import { useOpenSettings } from './settings-opener';
import './knowledge.css';

const SOURCES = [['Why we stopped using spreadsheets', 'Post'], ['Discovery call, Marcus Bell', 'Call · 41 min'], ['Pipeline review, 4 Mar', 'Call · 58 min'], ['FY23 revenue breakdown', 'Spreadsheet'], ['Ops weekly, 25 Aug', 'Document'], ['Services page', 'Website']];

export default function Knowledge() {
  const d = useData();
  const [documents, setDocuments] = useState<LocalDocument[]>([]);
  const [serverDocuments, setServerDocuments] = useState<ServerDocument[]>([]);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState('');
  const [uploadOpen, setUploadOpen] = useState(false);
  const [selected, setSelected] = useState<LocalDocument | ServerDocument | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const dragDepth = useRef(0);
  const locked = useRef(false);
  // Rehaul engine (P2.7): when the list was last read, and whether the latest refresh failed.
  const [loadedAt, setLoadedAt] = useState<number | null>(null);
  const [stale, setStale] = useState(false);
  const [usageRefused, setUsageRefused] = useState(false);
  const refresher = useRef<KnowledgeRefresher | null>(null);
  const openSettings = useOpenSettings();
  // Rehaul engine (P7.2): name search over the list, and the opened source read again after a change.
  const [query, setQuery] = useState('');
  const [detailRead, setDetailRead] = useState(0);
  // Delete file (P8.3): a file that was Deleting and has left the list is announced once.
  const [deletedNotice, setDeletedNotice] = useState(false);
  const previousList = useRef<ServerDocument[]>([]);
  useEffect(() => {
    if (finishedDeleting(previousList.current, serverDocuments).length) setDeletedNotice(true);
    previousList.current = serverDocuments;
  }, [serverDocuments]);
  const sourceList = showsSourceList(d.engine, d.isDemo);
  // "View usage" (spec §7.4): close this screen's dialog first, so none is stacked.
  const viewUsage = d.engine === 'ke' && openSettings ? () => { setUploadOpen(false); setSelected(null); openSettings('usage'); } : undefined;

  async function fetchServerDocuments(): Promise<ServerDocument[]> {
    const response = await fetch('/api/client/documents', { cache: 'no-store' });
    const body = await response.json().catch(() => ({})) as ServerDocument[] & { error?: string };
    if (!response.ok) throw new Error(body.error || 'Could not load sources.');
    return body;
  }

  async function loadServerDocuments() {
    setServerDocuments(await fetchServerDocuments());
    setLoadedAt(Date.now()); setStale(false);
  }

  useEffect(() => {
    if (d.isDemo) return;
    const current = new KnowledgeRefresher({
      load: fetchServerDocuments,
      onLoaded: documents => { setServerDocuments(documents); setLoadedAt(Date.now()); setStale(false); },
      onFailed: () => setStale(true),
      hidden: () => window.document.visibilityState === 'hidden',
    });
    refresher.current = current;
    const visibility = () => current.visibilityChanged();
    window.document.addEventListener('visibilitychange', visibility);
    return () => { current.stop(); refresher.current = null; window.document.removeEventListener('visibilitychange', visibility); };
  }, [d.isDemo]);

  useEffect(() => {
    let live = true;
    if (d.isDemo) readDocuments().then(files => { if (live) { setDocuments(files.sort((a, b) => b.addedAt - a.addedAt)); setReady(true); } }).catch(() => { if (live) setError('Document storage is unavailable. Allow site storage, then reload to add files.'); });
    else void loadServerDocuments().then(() => { if (live) setReady(true); }).catch(reason => { if (live) setError(reason instanceof Error ? reason.message : 'Could not load sources.'); });
    const preventNavigation = (event: globalThis.DragEvent) => { if (event.dataTransfer?.types.includes('Files')) event.preventDefault(); };
    window.addEventListener('dragover', preventNavigation); window.addEventListener('drop', preventNavigation);
    return () => { live = false; window.removeEventListener('dragover', preventNavigation); window.removeEventListener('drop', preventNavigation); };
  }, [d.isDemo]);

  useEffect(() => {
    if (d.isDemo) return;
    // Rehaul-engine sources (P2.7): `KnowledgeRefresher` reads the list again on its
    // own cadence, retries a failed read, and pauses while the tab is hidden.
    if (serverDocuments.some(document => document.knowledge !== undefined)) {
      refresher.current?.schedule(serverDocuments);
      return;
    }
    if (!serverDocuments.some(document => !['atomised', 'failed'].includes(document.status))) return;
    const timer = window.setInterval(() => {
      void loadServerDocuments().catch(reason => setError(reason instanceof Error ? reason.message : 'Could not refresh source status.'));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [d.isDemo, serverDocuments]);

  const addFiles = async (files: File[]) => {
    if (!ready || locked.current || !files.length) return;
    locked.current = true; setBusy(true); setError(''); setUsageRefused(false);
    const known = new Set(documents.map(fileKey));
    // Each file on its own (A19): a refusal is shown beside that file, and the
    // rest are still sent. Under ke the D08 contract decides (P7.3).
    const { added, issues } = await uploadBatch(files, sourceList ? uploadIssue : fileIssue, async file => {
      if (d.isDemo) {
        const id = fileKey(file);
        if (known.has(id)) return { added: false, note: 'Already added.' };
        const document = { id, name: file.name, size: file.size, lastModified: file.lastModified, addedAt: Date.now(), file };
        await saveDocument(document); setDocuments(previous => [document, ...previous]); known.add(id);
        return { added: true };
      }
      const form = new FormData(); form.set('file', file); form.set('source_type', 'brand_doc'); form.set('source_authority', 'CONVERSATIONAL');
      const response = await fetch('/api/client/documents', { method: 'POST', body: form });
      const body = await response.json().catch(() => ({})) as ServerDocument & { error?: string };
      if (!response.ok) {
        if (refusalShowsUsage((body as { detail?: unknown }).detail)) setUsageRefused(true);
        throw new Error(body.error || `Upload failed (${response.status}).`);
      }
      if (body.duplicate_of) {
        // Identical bytes are already a source (A18): one row, nothing counted again.
        setServerDocuments(previous => previous.some(document => document.id === body.id) ? previous : [body, ...previous]);
        return { added: false, note: DUPLICATE_UPLOAD_COPY };
      }
      setServerDocuments(previous => [body, ...previous]);
      return { added: true };
    });
    if (added) {
      toast.success(`${added === 1 ? 'Document' : `${added} documents`} ${d.isDemo ? 'added on this device' : 'accepted for processing'}`);
      if (!d.isDemo) void d.refreshPosts().catch(() => undefined);
    }
    setError(issues.join('\n')); setBusy(false); locked.current = false;
    if (added && !issues.length) setUploadOpen(false);
  };

  const drop = (event: DragEvent) => { event.preventDefault(); dragDepth.current = 0; setDragging(false); void addFiles(Array.from(event.dataTransfer.files)); };
  const isLocal = (value: LocalDocument | ServerDocument): value is LocalDocument => 'file' in value;
  const remove = async () => {
    if (!selected || locked.current) return;
    locked.current = true; setBusy(true);
    try {
      if (isLocal(selected)) { await removeLocalDocument(selected.id); setDocuments(files => files.filter(file => file.id !== selected.id)); }
      else {
        const response = await fetch(`/api/client/documents/${encodeURIComponent(selected.id)}`, { method: 'DELETE' });
        if (!response.ok) { const body = await response.json().catch(() => ({})) as { error?: string }; throw new Error(body.error || 'Could not remove this source.'); }
        setServerDocuments(files => files.filter(file => file.id !== selected.id));
      }
      setSelected(null); toast.success('Document removed');
      if (!d.isDemo) void d.refreshPosts().catch(() => undefined);
    } catch (reason) { toast.error(reason instanceof Error ? reason.message : 'Could not remove this document. Try again.'); }
    finally { locked.current = false; setBusy(false); }
  };
  const download = () => { if (!selected || !isLocal(selected)) return; const url = URL.createObjectURL(selected.file); const link = document.createElement('a'); link.href = url; link.download = selected.name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); };
  const reprocess = async () => {
    if (!selected || isLocal(selected)) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/client/documents/${encodeURIComponent(selected.id)}`, { method: 'POST' });
      if (!response.ok) { const body = await response.json().catch(() => ({})) as { error?: string }; throw new Error(body.error || 'Could not retry processing.'); }
      await loadServerDocuments(); setSelected(null); toast.success('Document queued for reprocessing');
    } catch (reason) { toast.error(reason instanceof Error ? reason.message : 'Could not retry processing.'); }
    finally { setBusy(false); }
  };

  // Ruling 38: an opened rehaul source reads its own detail once, so a released
  // source whose later knowledge update waits says so under Available.
  const openedKnowledgeId = selected && !isLocal(selected) && selected.knowledge !== undefined && d.engine === 'ke' ? selected.id : null;
  useEffect(() => {
    if (!openedKnowledgeId) return;
    let live = true;
    void fetch(`/api/client/documents/${encodeURIComponent(openedKnowledgeId)}`, { cache: 'no-store' })
      .then(async response => response.ok ? await response.json() as ServerDocument : null)
      .then(body => {
        if (live && body?.knowledge && body.id === openedKnowledgeId) setSelected(current => current && !isLocal(current) && current.id === body.id ? body : current);
      })
      .catch(() => undefined);
    return () => { live = false; };
  }, [openedKnowledgeId, detailRead]);

  // A source switched in its popup (P7.2): read the list and that source again.
  const sourceChanged = () => {
    void fetchServerDocuments().then(fresh => {
      setServerDocuments(fresh); setLoadedAt(Date.now()); setStale(false);
      setSelected(current => current && !isLocal(current) ? fresh.find(document => document.id === current.id) ?? current : current);
      setDetailRead(value => value + 1);
    }).catch(() => setStale(true));
  };
  // Delete file was recorded (P8.3): the row shows Deleting now, then the list is read again.
  const sourceDeleted = (documentId: string) => {
    setSelected(null);
    setServerDocuments(list => markDeleting(list, new Set([documentId]), deletingStatus()));
    sourceChanged();
  };
  const shownDocuments = sourceList ? filterSources(serverDocuments, query) : serverDocuments;
  const openSource = selected && !isLocal(selected) && sourceList && selected.knowledge !== undefined ? selected : null;
  // While the popup closes it keeps its content: swapping the dialog's body mid-close would leave it open.
  const [shownSource, setShownSource] = useState<ServerDocument | null>(null);
  useEffect(() => { if (openSource) setShownSource(openSource); }, [openSource]);
  const popupSource = openSource ?? (sourceList && selected === null ? shownSource : null);

  const sourceCount = d.isDemo ? documents.length + 14 : serverDocuments.length;
  return <div className="rf-knowledge">
    <div className="rf-section-heading"><h2>Knowledge</h2><span>{sourceCount} sources</span><Dialog open={uploadOpen} onOpenChange={open => { if (!busy) { setUploadOpen(open); setDragging(false); dragDepth.current = 0; } }}><DialogTrigger render={<Button variant="outline" />}><Plus /> Add files</DialogTrigger><DialogContent className="rf-upload-dialog"><DialogHeader><DialogTitle>Add files</DialogTitle><DialogDescription>Add documents to your data.</DialogDescription></DialogHeader>
    <form className="rf-file-drop" data-dragging={dragging || undefined} aria-label="Add knowledge files" aria-busy={busy} onSubmit={event => { event.preventDefault(); input.current?.click(); }} onDragEnter={event => { if (event.dataTransfer.types.includes('Files')) { event.preventDefault(); dragDepth.current++; setDragging(true); } }} onDragOver={event => { event.preventDefault(); event.dataTransfer.dropEffect = busy || !ready ? 'none' : 'copy'; }} onDragLeave={event => { event.preventDefault(); if (--dragDepth.current <= 0) { dragDepth.current = 0; setDragging(false); } }} onDrop={drop}>
      <span className="rf-file-drop-icon">{busy ? <LoaderCircle className="animate-spin" /> : <FileUp />}</span>
      <div><h3>{busy ? (d.isDemo ? 'Saving your documents…' : 'Uploading your documents…') : dragging ? 'Drop files to add them' : 'Choose your files'}</h3><p><span className="rf-drop-desktop">Drag files here, or </span>choose files from your device.</p><small>{sourceList ? <>{UPLOAD_TYPES_COPY}<br />{UPLOAD_LIMITS_COPY}</> : 'PDF, Word, text, spreadsheets, presentations · Up to 20 MB each'}</small></div>
      <input ref={input} type="file" multiple accept={sourceList ? KNOWLEDGE_UPLOAD_ACCEPT : ACCEPT} className="sr-only" tabIndex={-1} aria-label="Choose knowledge files" disabled={busy || !ready} onChange={event => { const files = Array.from(event.target.files || []); event.target.value = ''; void addFiles(files); }} />
      <Button variant="outline" type="submit" disabled={busy || !ready}><FolderOpen /> Choose files</Button>
    </form>
    <p className="rf-local-note rf-knowledge-note">{d.isDemo ? 'Files stay on this device in the demo. AI reading and learning are not connected.' : uploadNote(d.engine)}</p>
    {error && <p className="rf-file-error" role="alert">{error}</p>}
    {error && usageRefused && viewUsage && <Button variant="link" className="rf-view-usage" onClick={viewUsage}>View usage</Button>}
    </DialogContent></Dialog></div>
    <p className="rf-section-description">Your documents, calls, and writing. Give your agent the context behind your work.</p>
    <div className="rf-coverage">{(d.isDemo ? [['What you sell', 'Strong · 6 sources', 82], ['Who you sell to', 'Good · 4 sources', 64], ['How you sound', 'Thin · 4 posts', 31]] : coverageCards(serverDocuments, d.engine)).map(([title, label, width]) => <Card key={String(title)} className="rf-coverage-card"><CardContent><h3>{title}</h3><div className="rf-coverage-track"><span style={{ width: `${width}%` }} /></div><p>{label}</p></CardContent></Card>)}</div>
    <div className="rf-documents-heading"><h3>Your data</h3>{sourceList && <div className="rf-source-search"><Search aria-hidden /><Input type="search" placeholder="Search by name" aria-label="Search sources by name" value={query} onChange={event => setQuery(event.target.value)} />{query && <Button variant="ghost" size="sm" onClick={() => setQuery('')}>Clear search</Button>}</div>}</div>
    {deletedNotice && <DeletedNotice onDismiss={() => setDeletedNotice(false)} />}
    {stale && serverDocuments.some(document => document.knowledge !== undefined) && <p className="rf-knowledge-stale" role="status">Couldn&apos;t refresh · showing status from {loadedAt === null ? 'earlier' : utcTime(new Date(loadedAt))}<Button variant="link" size="sm" onClick={() => void refresher.current?.refresh()}>Retry</Button></p>}
    <ul className="rf-source-list">
      {documents.map(document => <li className="rf-uploaded-source" key={document.id}><Button variant="ghost" className="rf-source-open" onClick={() => setSelected(document)}><FileText /><b>{document.name}<small>{fileSize(document.size)} · {document.name.split('.').pop()?.toUpperCase()}</small></b><span className="rf-source-meta">On this device</span></Button></li>)}
      {shownDocuments.map(document => <ServerSourceRow key={document.id} document={document} engine={d.engine} onOpen={() => setSelected(document)} onViewUsage={viewUsage} />)}
      {d.isDemo && SOURCES.map(([name, type]) => <li key={name}>{type === 'Post' ? <ChannelMark channel="li" /> : type.startsWith('Call') ? <Mic /> : type === 'Spreadsheet' ? <Sheet /> : type === 'Website' ? <Globe /> : <FileText />}<b>{name}</b><span className="rf-source-meta">{type} · learned</span></li>)}
    </ul>
    {sourceList && ready && <SourceListEmpty total={serverDocuments.length} shown={shownDocuments.length} query={query} onAddFiles={() => setUploadOpen(true)} onClearSearch={() => setQuery('')} />}
    <Dialog open={selected !== null} onOpenChange={open => !open && !busy && setSelected(null)}>{popupSource ? <SourcePopup key={popupSource.id} document={popupSource} engine={d.engine} onClose={() => setSelected(null)} onChanged={sourceChanged} onViewUsage={viewUsage} canDelete={d.signedIn} onDeleted={sourceDeleted} /> : <DialogContent className="rf-document-dialog"><DialogHeader><DialogTitle>{selected ? isLocal(selected) ? selected.name : selected.source_type.replaceAll('_', ' ') : ''}</DialogTitle><DialogDescription>{selected && isLocal(selected) ? 'Stored on this device. This document has not been read by the agent.' : selected ? sourceDialogDescription(selected, d.engine) : ''}</DialogDescription></DialogHeader>{selected && <dl><div><dt>{isLocal(selected) ? 'File size' : 'Status'}</dt><dd>{isLocal(selected) ? fileSize(selected.size) : sourceStatusText(selected, d.engine)}</dd></div><div><dt>Added</dt><dd>{new Date(isLocal(selected) ? selected.addedAt : selected.created_at).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}</dd></div></dl>}{selected && !isLocal(selected) ? <ServerSourceFooter document={selected} engine={d.engine} busy={busy} onRemove={() => void remove()} onReprocess={() => void reprocess()} onViewUsage={viewUsage} /> : <DialogFooter><Button variant="ghost" disabled={busy} onClick={() => void remove()}><Trash2 /> Remove</Button>{selected && isLocal(selected) ? <Button variant="outline" onClick={download}><Download /> Download original</Button> : <Button variant="outline" disabled={busy} onClick={() => void reprocess()}><RotateCw /> Reprocess</Button>}</DialogFooter>}</DialogContent>}</Dialog>
  </div>;
}
