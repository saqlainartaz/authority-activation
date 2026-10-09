// Business DNA on the new engine (Cycle 5 P9.4; spec 3.1-3.2; A01-A03, A35; Ruling 88).
//
// One composed page: Identity, Audience, Offers and problems, Positioning, Proof
// stories and Voice sample, each compact and expanding in place (no new
// destinations). What it shows is the engine's current, eligible knowledge for
// the chosen profile; nothing is invented, scored or filled in to look complete.
// - The selector appears only when two or more profiles are permitted. The last
//   selection is remembered in this browser; the server re-checks it (A02).
// - Corrections open the existing one-item contribution form inside the section;
//   that section shows the existing what-changed text, and the page re-reads.
// - The voice sample is the voice card's metered preview, only when the client
//   asks, labelled as generated writing. Nothing paid runs on load.
// Under M1 this view is never rendered (`BusinessDna.tsx` keeps the questionnaire).

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronDown, ChevronUp, Pencil, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import type { DnaSectionId } from '@/lib/product';
import ContributionBox from './ContributionBox';
import {
  ADD_FILES, browserStore, CHOOSE_PROFILE, COMPACT_ITEMS, CORRECT_ACTION, DNA_DESCRIPTION, DNA_SECTIONS, DNA_TITLE,
  itemTags, KIND_LABELS, loadDnaPage, rememberProfile, SAMPLE_NOTE, SHOW_SAMPLE, showsSelector, STILL_BUILDING,
  TELL_US, VOICE_NOT_SET, type DnaPage,
} from './dna';
import { useNavigate } from './navigation';
import { useData } from './state';
import { GENERAL_VOICE, newPreviewId, requestVoice, SAMPLE_LABEL } from './voice';

export type VoiceSample =
  | { kind: 'loading' }
  | { kind: 'not-set' }
  | { kind: 'ready' }
  | { kind: 'busy' }
  | { kind: 'shown'; sample: string }
  | { kind: 'failed'; message: string };

export type DnaViewProps = {
  page: DnaPage | { kind: 'loading' };
  embedded?: boolean;
  expanded: ReadonlySet<DnaSectionId>;
  correcting: DnaSectionId | null;
  voice: VoiceSample;
  onSelect: (id: string) => void;
  onToggle: (id: DnaSectionId) => void;
  onCorrect: (id: DnaSectionId | null) => void;
  onAddFiles: () => void;
  onSetVoice: () => void;
  onSample: () => void;
  onRetry: () => void;
  /** The contribution form opened in a section (the live form; a placeholder in render tests). */
  correction: (id: DnaSectionId) => ReactNode;
};

function Selector({ profiles, value, onSelect }: { profiles: Array<{ id: string; name: string }>; value: string; onSelect: (id: string) => void }) {
  return <label className="rf-voice-field rf-dna-selector">
    <span>Business</span>
    <select className="rf-voice-select" aria-label="Business" value={value} onChange={event => event.target.value && onSelect(event.target.value)}>
      {value === '' && <option value="">Choose…</option>}
      {profiles.map(profile => <option key={profile.id} value={profile.id}>{profile.name}</option>)}
    </select>
  </label>;
}

function VoiceBody({ voice, onSetVoice, onSample }: Pick<DnaViewProps, 'voice' | 'onSetVoice' | 'onSample'>) {
  if (voice.kind === 'loading') return <p className="rf-dna-state">Checking your voice…</p>;
  if (voice.kind === 'not-set') {
    return <div className="rf-dna-empty"><p className="rf-dna-state">{VOICE_NOT_SET}</p>
      <Button variant="outline" onClick={onSetVoice}>Set up your voice</Button></div>;
  }
  return <div className="rf-dna-voice">
    <p className="rf-dna-state">Your saved writing guidance shapes every post. Ask for a sample to hear it.</p>
    {voice.kind === 'shown' && <article className="rf-voice-sample" aria-label="Sample">
      <p className="rf-voice-label"><span>{SAMPLE_LABEL}</span></p>
      <p className="rf-voice-text">{voice.sample}</p>
      <p className="rf-dna-note">{SAMPLE_NOTE}</p>
    </article>}
    {voice.kind === 'failed' && <p role="alert" className="rf-voice-message">{voice.message}</p>}
    <div className="rf-dna-voice-actions">
      <Button variant="outline" disabled={voice.kind === 'busy'} onClick={onSample}>
        {voice.kind === 'busy' ? 'Writing a sample…' : voice.kind === 'shown' ? 'Show another sample' : SHOW_SAMPLE}
      </Button>
    </div>
  </div>;
}

/** The page, pure: every state renders without a network. */
export function DnaInventoryView(props: DnaViewProps) {
  const { page, embedded = false, expanded, correcting } = props;
  return <>
    {!embedded && <header className="rf-topbar"><h1>{DNA_TITLE}</h1></header>}
    <div className={embedded ? 'rf-dna-embedded' : 'rf-dna-scroll'}><div className="rf-dna-content rf-dna-inventory">
      <div className="rf-section-heading"><div><h2>{DNA_TITLE}</h2><p className="rf-section-description">{DNA_DESCRIPTION}</p></div></div>
      {page.kind === 'loading' && <p className="rf-dna-state">Loading your profile…</p>}
      {page.kind === 'signed-out' && <p className="rf-dna-state">Sign in again to see your Business DNA.</p>}
      {page.kind === 'error' && <div className="rf-dna-empty"><p className="rf-auth-error" role="alert">{page.message}</p>
        <Button variant="outline" onClick={props.onRetry}>Try again</Button></div>}
      {page.kind === 'choose' && <Card className="rf-dna-card"><CardContent>
        <div className="rf-dna-section-heading"><h3>{CHOOSE_PROFILE}</h3></div>
        <Selector profiles={page.profiles} value="" onSelect={props.onSelect} />
      </CardContent></Card>}
      {page.kind === 'open' && <>
        {showsSelector(page.profiles) && <Selector profiles={page.profiles} value={page.dna.profile.id} onSelect={props.onSelect} />}
        {page.dna.empty && <Card className="rf-dna-card rf-dna-building"><CardContent>
          <h3>{STILL_BUILDING}</h3>
          {page.processing && <p className="rf-dna-state">{page.processing}</p>}
          <div className="rf-dna-building-actions">
            <Button variant="outline" onClick={props.onAddFiles}><Upload /> {ADD_FILES}</Button>
            <Button variant="outline" onClick={() => props.onCorrect('identity')}><Pencil /> {TELL_US}</Button>
          </div>
        </CardContent></Card>}
        {DNA_SECTIONS.map(section => {
          const items = page.dna.sections.find(entry => entry.id === section.id)?.items ?? [];
          const open = expanded.has(section.id);
          const shown = open ? items : items.slice(0, COMPACT_ITEMS);
          return <Card className="rf-dna-card" key={section.id} data-section={section.id}><CardContent>
            <div className="rf-dna-section-heading"><h3>{section.title}</h3>
              {section.id !== 'voice' && <Button variant="ghost" aria-expanded={correcting === section.id}
                onClick={() => props.onCorrect(correcting === section.id ? null : section.id)}><Pencil /> {CORRECT_ACTION}</Button>}
            </div>
            {section.id === 'identity' && <div className="rf-dna-identity">
              <p><strong>{page.dna.profile.name}</strong> <span className="rf-dna-kind">{KIND_LABELS[page.dna.profile.kind]}</span></p>
              {page.dna.relationships.length > 0 && <ul className="rf-dna-related">{page.dna.relationships.map(link =>
                <li key={`${link.profile.id}-${link.relation}-${link.direction}`}>{link.direction === 'outgoing'
                  ? <>{page.dna.profile.name} {link.relation || 'related to'} <button type="button" className="rf-dna-link" onClick={() => props.onSelect(link.profile.id)}>{link.profile.name}</button></>
                  : <><button type="button" className="rf-dna-link" onClick={() => props.onSelect(link.profile.id)}>{link.profile.name}</button> {link.relation || 'related to'} {page.dna.profile.name}</>}
                </li>)}</ul>}
            </div>}
            {section.id === 'voice'
              ? <VoiceBody voice={props.voice} onSetVoice={props.onSetVoice} onSample={props.onSample} />
              : items.length === 0
                ? <p className="rf-dna-state rf-dna-empty-line">{section.empty}</p>
                : <ul className="rf-dna-items">{shown.map(item => <li key={item.knowledge_id}>
                  <span>{item.statement}</span>
                  {itemTags(item).map(tag => <span key={tag} className="rf-dna-tag">{tag}</span>)}
                </li>)}</ul>}
            {items.length > COMPACT_ITEMS && <Button variant="ghost" className="rf-dna-more" aria-expanded={open} onClick={() => props.onToggle(section.id)}>
              {open ? <><ChevronUp /> Show fewer</> : <><ChevronDown /> Show all {items.length}</>}
            </Button>}
            {correcting === section.id && props.correction(section.id)}
          </CardContent></Card>;
        })}
      </>}
    </div></div>
  </>;
}

/** The connected page: loads, remembers the selection, opens corrections and asks for a sample. */
export default function DnaInventory({ embedded = false }: { embedded?: boolean }) {
  const d = useData();
  const navigate = useNavigate();
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;
  const [page, setPage] = useState<DnaPage | { kind: 'loading' }>({ kind: 'loading' });
  const [expanded, setExpanded] = useState<Set<DnaSectionId>>(new Set());
  const [correcting, setCorrecting] = useState<DnaSectionId | null>(null);
  const [sample, setSample] = useState<VoiceSample | null>(null);
  const current = useRef<string | null>(null);

  const load = useCallback(async (wanted: string | null) => {
    const loaded = await loadDnaPage((input, init) => fetch(input, init), browserStore(), wanted);
    if (loaded.kind === 'signed-out') { navigateRef.current('/refined/signin', { replace: true }); return; }
    current.current = loaded.kind === 'open' ? loaded.dna.profile.id : null;
    setPage(loaded);
  }, []);

  useEffect(() => { void load(null); }, [load]);

  const select = (id: string) => {
    if (id === current.current) return;
    rememberProfile(browserStore(), id);
    setCorrecting(null);
    setExpanded(new Set());
    setPage({ kind: 'loading' });
    void load(id);
  };

  async function askForSample() {
    setSample({ kind: 'busy' });
    const result = await requestVoice(GENERAL_VOICE, { previewId: newPreviewId(), kind: 'generate', instruction: null, base: null }, '');
    if (result.kind === 'signed-out') { navigateRef.current('/refined/signin', { replace: true }); return; }
    if (result.kind === 'preview') setSample({ kind: 'shown', sample: result.version.sample });
    else setSample({ kind: 'failed', message: result.message });
  }

  const { status, saved } = d.guidance;
  const voice: VoiceSample = status === 'loading' ? { kind: 'loading' } : !saved ? { kind: 'not-set' } : sample ?? { kind: 'ready' };

  return <DnaInventoryView
    page={page}
    embedded={embedded}
    expanded={expanded}
    correcting={correcting}
    voice={voice}
    onSelect={select}
    onToggle={id => setExpanded(previous => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    })}
    onCorrect={setCorrecting}
    onAddFiles={() => navigate('/refined/train?tab=knowledge')}
    onSetVoice={() => navigate('/refined/train?tab=guidance')}
    onSample={() => { void askForSample(); }}
    onRetry={() => { setPage({ kind: 'loading' }); void load(current.current); }}
    correction={id => <ContributionBox key={id} inline section={id === 'voice' ? undefined : id}
      onApplied={() => { void load(current.current); }} />}
  />;
}
