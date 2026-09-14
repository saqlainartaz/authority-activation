import { useEffect, useRef, useState, type DragEvent } from 'react';
import { FileText, FileUp, FolderOpen, Download, Trash2, Mic, Globe, Sheet, LoaderCircle, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogTrigger, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { toast } from 'sonner';
import { ChannelMark } from './Home';
import { ACCEPT, fileIssue, fileKey, fileSize, readDocuments, saveDocument, removeDocument, type LocalDocument } from './documents';
import './knowledge.css';

const SOURCES = [['Why we stopped using spreadsheets', 'Post'], ['Discovery call, Marcus Bell', 'Call · 41 min'], ['Pipeline review, 4 Mar', 'Call · 58 min'], ['FY23 revenue breakdown', 'Spreadsheet'], ['Ops weekly, 25 Aug', 'Document'], ['Services page', 'Website']];

export default function Knowledge() {
  const [documents, setDocuments] = useState<LocalDocument[]>([]);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState('');
  const [uploadOpen, setUploadOpen] = useState(false);
  const [selected, setSelected] = useState<LocalDocument | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const dragDepth = useRef(0);
  const locked = useRef(false);
  useEffect(() => {
    let live = true;
    readDocuments().then(files => { if (live) { setDocuments(files.sort((a, b) => b.addedAt - a.addedAt)); setReady(true); } }).catch(() => { if (live) setError('Document storage is unavailable. Allow site storage, then reload to add files.'); });
    // Dropping outside the form should never navigate away from this page.
    const preventNavigation = (event: globalThis.DragEvent) => { if (event.dataTransfer?.types.includes('Files')) event.preventDefault(); };
    window.addEventListener('dragover', preventNavigation); window.addEventListener('drop', preventNavigation);
    return () => { live = false; window.removeEventListener('dragover', preventNavigation); window.removeEventListener('drop', preventNavigation); };
  }, []);
  const addFiles = async (files: File[]) => {
    if (!ready || locked.current || !files.length) return;
    locked.current = true; setBusy(true); setError('');
    const known = new Set(documents.map(fileKey));
    const added: LocalDocument[] = []; const issues: string[] = [];
    for (const file of files) {
      const issue = fileIssue(file);
      if (issue) { issues.push(`${file.name}: ${issue}`); continue; }
      const id = fileKey(file);
      if (known.has(id)) { issues.push(`${file.name}: Already added.`); continue; }
      const document = { id, name: file.name, size: file.size, lastModified: file.lastModified, addedAt: Date.now(), file };
      try { await saveDocument(document); added.push(document); known.add(id); }
      catch { issues.push(`${file.name}: Could not save. Check available browser storage and try again.`); }
    }
    setDocuments(previous => [...added.reverse(), ...previous]);
    if (added.length) toast.success(`${added.length === 1 ? 'Document' : `${added.length} documents`} added on this device`);
    setError(issues.join('\n')); setBusy(false); locked.current = false;
    if (added.length && !issues.length) setUploadOpen(false);
  };
  const drop = (event: DragEvent) => { event.preventDefault(); dragDepth.current = 0; setDragging(false); void addFiles(Array.from(event.dataTransfer.files)); };
  const remove = async () => {
    if (!selected || locked.current) return;
    locked.current = true; setBusy(true);
    try { await removeDocument(selected.id); setDocuments(files => files.filter(file => file.id !== selected.id)); setSelected(null); toast.success('Document removed'); }
    catch { toast.error('Could not remove this document. Try again.'); }
    finally { locked.current = false; setBusy(false); }
  };
  const download = () => { if (!selected) return; const url = URL.createObjectURL(selected.file); const link = document.createElement('a'); link.href = url; link.download = selected.name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); };
  return <div className="rf-knowledge">
    <div className="rf-section-heading"><h2>Knowledge</h2><span>{documents.length + 14} sources</span><Dialog open={uploadOpen} onOpenChange={open => { if (!busy) { setUploadOpen(open); setDragging(false); dragDepth.current = 0; } }}><DialogTrigger render={<Button variant="outline" />}><Plus /> Add files</DialogTrigger><DialogContent className="rf-upload-dialog"><DialogHeader><DialogTitle>Add files</DialogTitle><DialogDescription>Add documents to your data.</DialogDescription></DialogHeader>
    <form className="rf-file-drop" data-dragging={dragging || undefined} aria-label="Add knowledge files" aria-busy={busy} onSubmit={event => { event.preventDefault(); input.current?.click(); }} onDragEnter={event => { if (event.dataTransfer.types.includes('Files')) { event.preventDefault(); dragDepth.current++; setDragging(true); } }} onDragOver={event => { event.preventDefault(); event.dataTransfer.dropEffect = busy || !ready ? 'none' : 'copy'; }} onDragLeave={event => { event.preventDefault(); if (--dragDepth.current <= 0) { dragDepth.current = 0; setDragging(false); } }} onDrop={drop}>
      <span className="rf-file-drop-icon">{busy ? <LoaderCircle className="animate-spin" /> : <FileUp />}</span>
      <div><h3>{busy ? 'Saving your documents…' : dragging ? 'Drop files to add them' : 'Choose your files'}</h3><p><span className="rf-drop-desktop">Drag files here, or </span>choose files from your device.</p><small>PDF, Word, text, spreadsheets, presentations · Up to 20 MB each</small></div>
      <input ref={input} type="file" multiple accept={ACCEPT} className="sr-only" tabIndex={-1} aria-label="Choose knowledge files" disabled={busy || !ready} onChange={event => { const files = Array.from(event.target.files || []); event.target.value = ''; void addFiles(files); }} />
      <Button variant="outline" type="submit" disabled={busy || !ready}><FolderOpen /> Choose files</Button>
    </form>
    <p className="rf-local-note rf-knowledge-note">Files stay on this device in the preview. AI reading and learning are not connected yet.</p>
    {error && <p className="rf-file-error" role="alert">{error}</p>}
    </DialogContent></Dialog></div>
    <p className="rf-section-description">Your documents, calls, and writing. Give your agent the context behind your work.</p>
    <div className="rf-coverage">{[['What you sell', 'Strong · 6 sources', 82], ['Who you sell to', 'Good · 4 sources', 64], ['How you sound', 'Thin · 4 posts', 31]].map(([title, label, width]) => <Card key={title} className="rf-coverage-card"><CardContent><h3>{title}</h3><div className="rf-coverage-track"><span style={{ width: `${width}%` }} /></div><p>{label}</p></CardContent></Card>)}</div>
    <div className="rf-documents-heading"><h3>Your data</h3></div>
    <ul className="rf-source-list">{documents.map(document => <li className="rf-uploaded-source" key={document.id}><Button variant="ghost" className="rf-source-open" onClick={() => setSelected(document)}><FileText /><b>{document.name}<small>{fileSize(document.size)} · {document.name.split('.').pop()?.toUpperCase()}</small></b><span className="rf-source-meta">On this device</span></Button></li>)}{SOURCES.map(([name, type]) => <li key={name}>{type === 'Post' ? <ChannelMark channel="li" /> : type.startsWith('Call') ? <Mic /> : type === 'Spreadsheet' ? <Sheet /> : type === 'Website' ? <Globe /> : <FileText />}<b>{name}</b><span className="rf-source-meta">{type} · learned</span></li>)}</ul>
    <Dialog open={selected !== null} onOpenChange={open => !open && !busy && setSelected(null)}><DialogContent className="rf-document-dialog"><DialogHeader><DialogTitle>{selected?.name}</DialogTitle><DialogDescription>Stored on this device. This document has not been read by the agent yet.</DialogDescription></DialogHeader>{selected && <dl><div><dt>File size</dt><dd>{fileSize(selected.size)}</dd></div><div><dt>Added</dt><dd>{new Date(selected.addedAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}</dd></div></dl>}<DialogFooter><Button variant="ghost" disabled={busy} onClick={() => void remove()}><Trash2 /> Remove</Button><Button variant="outline" onClick={download}><Download /> Download original</Button></DialogFooter></DialogContent></Dialog>
  </div>;
}
