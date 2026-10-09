// "What would you like us to know?" in Train Your AI, on the new engine (Cycle 5 P6.8; A09; review I-4).
//
// One text area, a choice of what the note is, and Send. A note is ONE item, and
// the client says what it is: "Something about me or my business" (the
// default) or "How I want my posts written" (no model sorts it: the splitter was
// removed, 2026-10-08). The note is saved once per browser intent key; the reply
// shows what changed:
// - a fact added,
// - or a proposed guidance line, with "Add to my guidance", which opens the
//   guidance editor with the line appended; the client saves it there. Nothing
//   is ever saved to guidance automatically.
// Lines proposed by answered questions are listed here too (`/proposals`).
// Under M1 this box is not rendered.

import { useCallback, useEffect, useRef, useState } from 'react';
import { Plus, Send } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { useNavigate } from './navigation';
import {
  appendLine, canSave, CONTRIBUTE_TITLE, CONTRIBUTION_KINDS, CONTRIBUTION_TEXT_MAX, ContributionRequestError,
  contributionIntent, loadProposals, postContribution, summarizeContribution, type ContributionIntent,
  type ContributionSummary,
} from './client-contributions';
import type { ContributionKind, ContributionOut, ContributionSection } from '@/lib/product';
import { GUIDANCE_LIMIT, loadGuidance, saveGuidance, STALE_GUIDANCE_COPY, type SavedGuidance } from './guidance';

export const ADD_TO_GUIDANCE = 'Add to my guidance';
export const SUGGESTED_GUIDANCE = 'Suggested guidance';

type ViewProps = {
  text: string;
  kind: ContributionKind;
  busy: boolean;
  error: string | null;
  summary: ContributionSummary | null;
  proposals: string[];
  onText: (text: string) => void;
  onKind: (kind: ContributionKind) => void;
  onSend: () => void;
  onAdd: (line: string) => void;
  /** Business DNA opens the same form inside one of its sections (P9.4). */
  className?: string;
};

export function ContributionBoxView({ text, kind, busy, error, summary, proposals, onText, onKind, onSend, onAdd, className }: ViewProps) {
  const sendable = text.trim().length > 0 && text.length <= CONTRIBUTION_TEXT_MAX && !busy;
  return <Card className={className ? `rf-contribute ${className}` : 'rf-contribute'}><CardContent>
    <h3>{CONTRIBUTE_TITLE}</h3>
    <p className="rf-section-description">Tell us one thing at a time. We add facts to what your assistant knows, and suggest writing guidance for you to confirm.</p>
    <fieldset className="rf-contribute-kind" aria-label="What is this about?">
      {CONTRIBUTION_KINDS.map(option => <label key={option.kind}>
        <input type="radio" name="contribution-kind" value={option.kind} checked={kind === option.kind}
          onChange={() => onKind(option.kind)} /> {option.label}
      </label>)}
    </fieldset>
    <Textarea aria-label={CONTRIBUTE_TITLE} value={text} rows={3} maxLength={CONTRIBUTION_TEXT_MAX}
      placeholder={kind === 'writing' ? 'For example: please don’t name our clients.' : 'For example: we now offer evening classes.'}
      onChange={event => onText(event.target.value)} />
    {error && <p className="rf-auth-error" role="alert">{error}</p>}
    <div className="rf-contribute-actions"><Button disabled={!sendable} onClick={onSend}>{busy ? 'Sending…' : <><Send /> Send</>}</Button></div>
    {summary && <div className="rf-contribute-outcome" role="status">
      {summary.pending && <p>{summary.pending}</p>}
      {summary.facts.length > 0 && <><strong>What changed</strong><ul>{summary.facts.map(fact => <li key={fact}>{fact}</li>)}</ul></>}
      {summary.notes.map(note => <p key={note}>{note}</p>)}
    </div>}
    {proposals.length > 0 && <div className="rf-contribute-proposals">
      <strong>{SUGGESTED_GUIDANCE}</strong>
      <ul>{proposals.map(line => <li key={line}><span>{line}</span>
        <Button variant="outline" size="sm" onClick={() => onAdd(line)}><Plus /> {ADD_TO_GUIDANCE}</Button></li>)}</ul>
    </div>}
  </CardContent></Card>;
}

type EditorProps = {
  open: boolean;
  text: string;
  busy: boolean;
  error: string | null;
  onText: (text: string) => void;
  onSave: () => void;
  onCancel: () => void;
};

export function GuidanceAddDialog({ open, text, busy, error, onText, onSave, onCancel }: EditorProps) {
  return <Dialog open={open} onOpenChange={next => !next && onCancel()}><DialogContent className="rf-settings">
    <DialogHeader><DialogTitle>Add to your guidance</DialogTitle>
      <DialogDescription>Your general writing guidance, with the suggested line added at the end. Edit it if you like, then save.</DialogDescription></DialogHeader>
    <Textarea autoFocus aria-label="Guidance" value={text} rows={8} onChange={event => onText(event.target.value)} />
    <p className="rf-section-description">{Array.from(text.trim()).length.toLocaleString('en-GB')} of {GUIDANCE_LIMIT.toLocaleString('en-GB')} characters</p>
    {error && <p className="rf-auth-error" role="alert">{error}</p>}
    <DialogFooter><Button variant="ghost" onClick={onCancel}>Cancel</Button>
      <Button disabled={busy || !canSave(text)} onClick={onSave}>{busy ? 'Saving…' : 'Save guidance'}</Button></DialogFooter>
  </DialogContent></Dialog>;
}

type BoxProps = {
  /** Business DNA (P9.4): the same form inside one section. It lists only this note's
   *  proposed line, not every waiting one, and reads nothing on mount. */
  inline?: boolean;
  /** Called once a note is applied, so the page can refresh what it shows. */
  onApplied?: (reply: ContributionOut) => void;
  /** The DNA section the form is opened from: a fact is filed there (P9 fix round 1). */
  section?: ContributionSection;
};

export default function ContributionBox({ inline = false, onApplied, section }: BoxProps = {}) {
  const navigate = useNavigate();
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;
  const [text, setText] = useState('');
  const [kind, setKind] = useState<ContributionKind>('fact');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<ContributionSummary | null>(null);
  const [listed, setListed] = useState<string[] | null>(null);
  const [editor, setEditor] = useState<{ base: SavedGuidance | null; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [editorError, setEditorError] = useState<string | null>(null);
  const intent = useRef<ContributionIntent | null>(null);

  const refresh = useCallback(() => {
    loadProposals().then(rows => setListed(rows.map(row => row.instruction))).catch(() => undefined);
  }, []);

  useEffect(() => { if (!inline) refresh(); }, [inline, refresh]);

  async function send() {
    if (busy || !text.trim()) return;
    const current = contributionIntent(intent.current, text, kind, undefined, section);
    intent.current = current;
    setBusy(true);
    setError(null);
    try {
      const reply = await postContribution(current);
      setSummary(summarizeContribution(reply));
      if (reply.application_state !== 'pending') {
        intent.current = null;
        setText('');
      }
      if (reply.application_state === 'applied') onApplied?.(reply);
      if (!inline) refresh();
    } catch (reason) {
      if (reason instanceof ContributionRequestError && reason.status === 401) { navigateRef.current('/refined/signin', { replace: true }); return; }
      setError(reason instanceof Error ? reason.message : 'Your message was not sent. Try again.');
    } finally {
      setBusy(false);
    }
  }

  async function add(line: string) {
    setEditorError(null);
    const loaded = await loadGuidance();
    if (loaded.kind === 'signed-out') { navigateRef.current('/refined/signin', { replace: true }); return; }
    if (loaded.kind !== 'saved') { toast.error(loaded.kind === 'error' ? loaded.message : 'Your guidance could not be loaded.'); return; }
    setEditor({ base: loaded.saved, text: appendLine(loaded.saved?.text, line) });
  }

  async function save() {
    if (!editor || saving) return;
    setSaving(true);
    setEditorError(null);
    const result = await saveGuidance(editor.text, editor.base);
    setSaving(false);
    if (result.kind === 'saved') {
      setEditor(null);
      toast.success('Guidance saved');
      if (inline) setListed([]);
      else refresh();
    } else if (result.kind === 'signed-out') {
      navigateRef.current('/refined/signin', { replace: true });
    } else {
      setEditorError(result.kind === 'stale' ? STALE_GUIDANCE_COPY : result.message);
    }
  }

  // The server's list once read (it includes this message's lines, and drops a line once it is in the
  // guidance); this message's own lines until then.
  const proposals = listed ?? summary?.proposals ?? [];
  return <>
    <ContributionBoxView text={text} kind={kind} busy={busy} error={error} summary={summary} proposals={proposals}
      className={inline ? 'rf-contribute-inline' : undefined}
      onText={setText} onKind={setKind} onSend={() => void send()} onAdd={line => void add(line)} />
    <GuidanceAddDialog open={editor !== null} text={editor?.text ?? ''} busy={saving} error={editorError}
      onText={value => setEditor(current => current ? { ...current, text: value } : current)}
      onSave={() => void save()} onCancel={() => setEditor(null)} />
  </>;
}
