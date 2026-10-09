import { useEffect, useReducer, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useNavigate } from './navigation';
import { useData } from './state';
import VoiceCard from './VoiceCard';
import {
  GENERAL_GUIDANCE_COPY, GUIDANCE_LIMIT, INITIAL_EDITOR, NO_GUIDANCE_COPY, STALE_GUIDANCE_COPY,
  checkGuidance, guidanceReducer, type GuidanceEditor, type GuidanceResult,
} from './guidance';

const count = (value: number) => value.toLocaleString('en-GB');

export type GuidancePanelProps = {
  editor: GuidanceEditor;
  /** Whether the engine serving this client reads saved guidance when it writes. */
  usedInWriting: boolean;
  onDraft: (draft: string) => void;
  onSave: () => void;
  /** Called only after the client confirms. */
  onClear: () => void;
  onReload: () => void;
  onUseKept: () => void;
  /** The voice card (P5.3), rendered in its slot. Absent under M1. */
  voiceCard?: ReactNode;
};

/** Train Your AI -> Guidance for a connected client (Cycle 5 P5.1; spec 6, D06,
 *  A13, A16). Pure apart from the Clear confirmation: the editor state comes in,
 *  so each state renders in a test without a network. */
export function GuidancePanel({ editor, usedInWriting, onDraft, onSave, onClear, onReload, onUseKept, voiceCard }: GuidancePanelProps) {
  const [confirming, setConfirming] = useState(false);
  const check = checkGuidance(editor.draft);
  const saved = editor.saved;
  const changed = check.text !== (saved?.text ?? '');
  const canSave = editor.status === 'ready' && check.ok && changed && !editor.busy && !editor.stale;
  // Ruling 65: this tab edits the GENERAL (neutral) setting, which writing in
  // any voice uses unless that voice has its own (P5.3's voice card adds those).
  const scope = <p className="rf-section-description rf-guidance-scope">{GENERAL_GUIDANCE_COPY}{usedInWriting ? '' : ' The current writing engine does not read it yet.'}</p>;

  if (editor.status === 'loading') {
    return <section className="rf-guidance"><GuidanceHeading /><p role="status" className="rf-section-description">Loading your guidance…</p></section>;
  }
  if (editor.status === 'error') {
    return <section className="rf-guidance"><GuidanceHeading /><p role="alert" className="rf-auth-error">{editor.error || 'Your guidance could not be loaded.'}</p><Button variant="outline" onClick={onReload}>Try again</Button></section>;
  }

  return <section className="rf-guidance">
    <GuidanceHeading status={saved ? 'Saved' : undefined} />
    {scope}
    {saved
      ? <p className="rf-section-description">Edit it here; bullets and line breaks are kept as you write them.</p>
      : <>
        <h3 className="rf-guidance-empty">{NO_GUIDANCE_COPY}</h3>
        <p className="rf-section-description">Write how you want your drafts to sound, or try the voice card below. Bullets and line breaks are kept as you write them.</p>
      </>}
    {/* No maxLength: a browser limit would cut pasted text silently. Over the
        limit, the count says so and Save is blocked instead. */}
    <Textarea className="rf-guidance-editor" aria-label="Writing guidance" value={editor.draft} onChange={event => onDraft(event.target.value)} rows={10} aria-invalid={check.over > 0 || undefined} aria-describedby="rf-guidance-count" />
    <p id="rf-guidance-count" className="rf-guidance-count" data-over={check.over > 0 || undefined}>{count(check.length)} / {count(GUIDANCE_LIMIT)}</p>
    {check.over > 0 && <p role="alert" className="rf-auth-error">That is {count(check.over)} {check.over === 1 ? 'character' : 'characters'} over the {count(GUIDANCE_LIMIT)} limit. Shorten it to save.</p>}
    {check.trimmed && <p className="rf-guidance-note">Blank space at the start and end will be removed when you save.</p>}
    {editor.stale && <div role="alert" className="rf-guidance-stale"><p>{STALE_GUIDANCE_COPY}</p><Button variant="outline" disabled={editor.busy} onClick={onReload}>Reload</Button></div>}
    {editor.kept !== null && <div className="rf-guidance-kept">
      <p>Your unsaved text is below. The box above now shows the latest saved guidance.</p>
      <Textarea aria-label="Your unsaved guidance" value={editor.kept} readOnly rows={6} />
      <Button variant="outline" onClick={onUseKept}>Use my text instead</Button>
    </div>}
    {editor.error && <p role="alert" className="rf-auth-error">{editor.error}</p>}
    <div className="rf-guidance-actions">
      <Button disabled={!canSave} onClick={onSave}>{editor.busy ? 'Saving…' : 'Save guidance'}</Button>
      {saved && <Button variant="ghost" disabled={editor.busy || editor.stale} onClick={() => setConfirming(true)}>Clear</Button>}
    </div>
    {/* VOICE CARD SLOT (P5.3). Spec 6.1: the voice card is reachable from
        Guidance, including when no guidance is saved. Under ke only. */}
    <div className="rf-voice-card-slot" data-slot="voice-card">{voiceCard}</div>
    <Dialog open={confirming} onOpenChange={open => !open && setConfirming(false)}>
      <DialogContent className="rf-settings">
        <DialogHeader><DialogTitle>Clear your guidance?</DialogTitle><DialogDescription>The saved text is deleted. New drafts are written without it until you save new guidance.</DialogDescription></DialogHeader>
        <DialogFooter><Button variant="ghost" onClick={() => setConfirming(false)}>Cancel</Button><Button variant="destructive" onClick={() => { setConfirming(false); onClear(); }}>Clear guidance</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </section>;
}

function GuidanceHeading({ status }: { status?: string }) {
  return <div className="rf-section-heading"><h2>Guidance</h2>{status && <span>{status}</span>}</div>;
}

/** P5.3: the voice card under the rehaul engine only (ke). M1 has none: its
 *  writing does not read saved guidance, and it has no voice preview. */
export function voiceCardFor(engine: 'ke' | 'm1' | null): ReactNode {
  return engine === 'ke' ? <VoiceCard /> : null;
}

/** The connected Guidance tab: the server state from `useData`, the editor here. */
export default function GuidanceTab() {
  const d = useData();
  const navigate = useNavigate();
  const [editor, dispatch] = useReducer(guidanceReducer, INITIAL_EDITOR);
  const { status, saved, message } = d.guidance;

  useEffect(() => {
    if (message) dispatch({ type: 'load-failed', message });
    else if (status === 'ready') dispatch({ type: 'loaded', saved });
  }, [status, saved, message]);

  const settle = (result: GuidanceResult, done: string) => {
    if (result.kind === 'signed-out') { navigate('/refined/signin', { replace: true }); return; }
    dispatch({ type: 'written', result });
    if (result.kind === 'saved') toast.success(done);
  };

  return <GuidancePanel
    editor={editor}
    usedInWriting={d.engine === 'ke'}
    onDraft={draft => dispatch({ type: 'edit', draft })}
    onSave={() => { dispatch({ type: 'busy' }); void d.saveGuidance(editor.draft, editor.saved).then(result => settle(result, 'Guidance saved')); }}
    onClear={() => { if (!editor.saved) return; dispatch({ type: 'busy' }); void d.clearGuidance(editor.saved).then(result => settle(result, 'Guidance cleared')); }}
    onReload={() => {
      void d.reloadGuidance().then(result => {
        if (result.kind === 'saved') dispatch({ type: 'loaded', saved: result.saved });
        else if (result.kind === 'signed-out') navigate('/refined/signin', { replace: true });
        else if (result.kind === 'error') dispatch({ type: 'load-failed', message: result.message });
      });
    }}
    onUseKept={() => dispatch({ type: 'use-kept' })}
    voiceCard={voiceCardFor(d.engine)}
  />;
}
