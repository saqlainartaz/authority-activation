import { useEffect, useRef, useState, type DragEvent } from 'react';
import { FileText, FileUp, FolderOpen, Download, Trash2, Mic, Globe, Sheet, LoaderCircle, Plus, RotateCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogTrigger, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { toast } from 'sonner';
import ChannelMark from './ChannelMark';
import { ACCEPT, fileIssue, fileKey, fileSize, readDocuments, saveDocument, removeDocument as removeLocalDocument, type LocalDocument } from './documents';
import { useData } from './state';
import './knowledge.css';

const SOURCES = [['Why we stopped using spreadsheets', 'Post'], ['Discovery call, Marcus Bell', 'Call · 41 min'], ['Pipeline review, 4 Mar', 'Call · 58 min'], ['FY23 revenue breakdown', 'Spreadsheet'], ['Ops weekly, 25 Aug', 'Document'], ['Services page', 'Website']];
type ServerDocument = { id: string; source_type: string; source_authority: string; status: 'uploaded' | 'parsed' | 'cleaned' | 'atomised' | 'failed'; created_at: string; atom_count?: number };

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

  async function loadServerDocuments() {
    const response = await fetch('/api/client/documents', { cache: 'no-store' });
    const body = await response.json().catch(() => ({})) as ServerDocument[] & { error?: string };
    if (!response.ok) throw new Error(body.error || 'Could not load sources.');
    setServerDocuments(body);
  }

  useEffect(() => {
    let live = true;
    if (d.isDemo) readDocuments().then(files => { if (live) { setDocuments(files.sort((a, b) => b.addedAt - a.addedAt)); setReady(true); } }).catch(() => { if (live) setError('Document storage is unavailable. Allow site storage, then reload to add files.'); });
    else void loadServerDocuments().then(() => { if (live) setReady(true); }).catch(reason => { if (live) setError(reason instanceof Error ? reason.message : 'Could not load sources.'); });
    const preventNavigation = (event: globalThis.DragEvent) => { if (event.dataTransfer?.types.includes('Files')) event.preventDefault(); };
    window.addEventListener('dragover', preventNavigation); window.addEventListener('drop', preventNavigation);
    return () => { live = false; window.removeEventListener('dragover', preventNavigation); window.removeEventListener('drop', preventNavigation); };
  }, [d.isDemo]);

  useEffect(() => {
    if (d.isDemo || !serverDocuments.some(document => !['atomised', 'failed'].includes(document.status))) return;
    const timer = window.setInterval(() => {
      void loadServerDocuments().catch(reason => setError(reason instanceof Error ? reason.message : 'Could not refresh source status.'));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [d.isDemo, serverDocuments]);

  const addFiles = async (files: File[]) => {
    if (!ready || locked.current || !files.length) return;
    locked.current = true; setBusy(true); setError('');
    const known = new Set(documents.map(fileKey));
    let added = 0; const issues: string[] = [];
    for (const file of files) {
      const issue = fileIssue(file);
      if (issue) { issues.push(`${file.name}: ${issue}`); continue; }
      try {
        if (d.isDemo) {
          const id = fileKey(file);
          if (known.has(id)) { issues.push(`${file.name}: Already added.`); continue; }
          const document = { id, name: file.name, size: file.size, lastModified: file.lastModified, addedAt: Date.now(), file };
          await saveDocument(document); setDocuments(previous => [document, ...previous]); known.add(id);
        } else {
          const form = new FormData(); form.set('file', file); form.set('source_type', 'brand_doc'); form.set('source_authority', 'CONVERSATIONAL');
          const response = await fetch('/api/client/documents', { method: 'POST', body: form });
          const body = await response.json().catch(() => ({})) as ServerDocument & { error?: string };
          if (!response.ok) throw new Error(body.error || `Upload failed (${response.status}).`);
          setServerDocuments(previous => [body, ...previous]);
        }
        added++;
      } catch (reason) { issues.push(`${file.name}: ${reason instanceof Error ? reason.message : 'Could not upload.'}`); }
    }
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

  const sourceCount = d.isDemo ? documents.length + 14 : serverDocuments.length;
  const learned = serverDocuments.filter(document => document.status === 'atomised').length;
  const failed = serverDocuments.filter(document => document.status === 'failed').length;
  return <div className="rf-knowledge">
    <div className="rf-section-heading"><h2>Knowledge</h2><span>{sourceCount} sources</span><Dialog open={uploadOpen} onOpenChange={open => { if (!busy) { setUploadOpen(open); setDragging(false); dragDepth.current = 0; } }}><DialogTrigger render={<Button variant="outline" />}><Plus /> Add files</DialogTrigger><DialogContent className="rf-upload-dialog"><DialogHeader><DialogTitle>Add files</DialogTitle><DialogDescription>Add documents to your data.</DialogDescription></DialogHeader>
    <form className="rf-file-drop" data-dragging={dragging || undefined} aria-label="Add knowledge files" aria-busy={busy} onSubmit={event => { event.preventDefault(); input.current?.click(); }} onDragEnter={event => { if (event.dataTransfer.types.includes('Files')) { event.preventDefault(); dragDepth.current++; setDragging(true); } }} onDragOver={event => { event.preventDefault(); event.dataTransfer.dropEffect = busy || !ready ? 'none' : 'copy'; }} onDragLeave={event => { event.preventDefault(); if (--dragDepth.current <= 0) { dragDepth.current = 0; setDragging(false); } }} onDrop={drop}>
      <span className="rf-file-drop-icon">{busy ? <LoaderCircle className="animate-spin" /> : <FileUp />}</span>
      <div><h3>{busy ? (d.isDemo ? 'Saving your documents…' : 'Uploading your documents…') : dragging ? 'Drop files to add them' : 'Choose your files'}</h3><p><span className="rf-drop-desktop">Drag files here, or </span>choose files from your device.</p><small>PDF, Word, text, spreadsheets, presentations · Up to 20 MB each</small></div>
      <input ref={input} type="file" multiple accept={ACCEPT} className="sr-only" tabIndex={-1} aria-label="Choose knowledge files" disabled={busy || !ready} onChange={event => { const files = Array.from(event.target.files || []); event.target.value = ''; void addFiles(files); }} />
      <Button variant="outline" type="submit" disabled={busy || !ready}><FolderOpen /> Choose files</Button>
    </form>
    <p className="rf-local-note rf-knowledge-note">{d.isDemo ? 'Files stay on this device in the demo. AI reading and learning are not connected.' : 'Uploads are persisted by the connected engine. “Learned” appears only after atomisation completes.'}</p>
    {error && <p className="rf-file-error" role="alert">{error}</p>}
    </DialogContent></Dialog></div>
    <p className="rf-section-description">Your documents, calls, and writing. Give your agent the context behind your work.</p>
    <div className="rf-coverage">{(d.isDemo ? [['What you sell', 'Strong · 6 sources', 82], ['Who you sell to', 'Good · 4 sources', 64], ['How you sound', 'Thin · 4 posts', 31]] : [['Sources', `${serverDocuments.length} total`, serverDocuments.length ? 100 : 0], ['Learned', `${learned} atomised`, serverDocuments.length ? Math.round(learned / serverDocuments.length * 100) : 0], ['Needs attention', failed ? `${failed} failed` : 'No failures', serverDocuments.length ? Math.round(failed / serverDocuments.length * 100) : 0]]).map(([title, label, width]) => <Card key={String(title)} className="rf-coverage-card"><CardContent><h3>{title}</h3><div className="rf-coverage-track"><span style={{ width: `${width}%` }} /></div><p>{label}</p></CardContent></Card>)}</div>
    <div className="rf-documents-heading"><h3>Your data</h3></div>
    <ul className="rf-source-list">
      {documents.map(document => <li className="rf-uploaded-source" key={document.id}><Button variant="ghost" className="rf-source-open" onClick={() => setSelected(document)}><FileText /><b>{document.name}<small>{fileSize(document.size)} · {document.name.split('.').pop()?.toUpperCase()}</small></b><span className="rf-source-meta">On this device</span></Button></li>)}
      {serverDocuments.map(document => <li className="rf-uploaded-source" key={document.id}><Button variant="ghost" className="rf-source-open" onClick={() => setSelected(document)}><FileText /><b>{document.source_type.replaceAll('_', ' ')}<small>{document.id.slice(0, 8)} · {document.status}</small></b><span className="rf-source-meta">{document.status === 'atomised' ? 'Learned' : document.status === 'failed' ? 'Failed' : 'Processing'}</span></Button></li>)}
      {d.isDemo && SOURCES.map(([name, type]) => <li key={name}>{type === 'Post' ? <ChannelMark channel="li" /> : type.startsWith('Call') ? <Mic /> : type === 'Spreadsheet' ? <Sheet /> : type === 'Website' ? <Globe /> : <FileText />}<b>{name}</b><span className="rf-source-meta">{type} · learned</span></li>)}
    </ul>
    <Dialog open={selected !== null} onOpenChange={open => !open && !busy && setSelected(null)}><DialogContent className="rf-document-dialog"><DialogHeader><DialogTitle>{selected ? isLocal(selected) ? selected.name : selected.source_type.replaceAll('_', ' ') : ''}</DialogTitle><DialogDescription>{selected && isLocal(selected) ? 'Stored on this device. This document has not been read by the agent.' : selected ? `Persisted source · ${selected.status}. Original-file download is not exposed by the previous backend.` : ''}</DialogDescription></DialogHeader>{selected && <dl><div><dt>{isLocal(selected) ? 'File size' : 'Status'}</dt><dd>{isLocal(selected) ? fileSize(selected.size) : selected.status}</dd></div><div><dt>Added</dt><dd>{new Date(isLocal(selected) ? selected.addedAt : selected.created_at).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}</dd></div></dl>}<DialogFooter><Button variant="ghost" disabled={busy} onClick={() => void remove()}><Trash2 /> Remove</Button>{selected && isLocal(selected) ? <Button variant="outline" onClick={download}><Download /> Download original</Button> : <Button variant="outline" disabled={busy} onClick={() => void reprocess()}><RotateCw /> Reprocess</Button>}</DialogFooter></DialogContent></Dialog>
  </div>;
}
