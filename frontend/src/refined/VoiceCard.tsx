import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useNavigate } from './navigation';
import { useData } from './state';
import { GUIDANCE_LIMIT, STALE_GUIDANCE_COPY, checkGuidance } from './guidance';
import {
  GENERAL_VOICE, SAMPLE_LABEL, SAVED_COPY, STARTING_PROPOSAL_COPY, STARTING_PROPOSAL_NOTE,
  initialCard, loadVoiceOptions, voiceController, voiceReducer,
  type VoiceCard as VoiceCardState, type VoiceOption, type VoiceVersion,
} from './voice';

const count = (value: number) => value.toLocaleString('en-GB');

export type VoiceCardViewProps = {
  card: VoiceCardState;
  options: VoiceOption[];
  onChoose: (key: string) => void;
  onStyle: (text: string) => void;
  onGenerate: () => void;
  /** Retry the failed generation under its own preview id. */
  onRetry: () => void;
  onUse: (version: VoiceVersion) => void;
  onAdjustOpen: () => void;
  onAdjustText: (text: string) => void;
  onAdjustSend: () => void;
  onAdjustCancel: () => void;
  onEditGuidance: (text: string) => void;
  /** The ONLY write: called from the Save button alone. */
  onSave: () => void;
  onReload: () => void;
  onReset: () => void;
};

/** The voice card (Cycle 5 P5.3; spec 6; A13, A14): show a sample, edit the
 *  guidance, Save. Pure: the card state comes in, so every state renders in a
 *  test without a network. */
export function VoiceCardView(props: VoiceCardViewProps) {
  const { card, options } = props;
  const version = card.version;
  const check = checkGuidance(card.guidanceDraft ?? '');
  const canSave = card.guidanceDraft !== null && check.ok && !card.saving && !card.stale && !card.busy && card.baseStatus === 'ready';

  return <section className="rf-voice-card" aria-labelledby="rf-voice-title">
    <div className="rf-section-heading"><h3 id="rf-voice-title">Try a voice</h3></div>
    <p className="rf-section-description">Hear how a post could sound before you save any guidance. Nothing is saved until you press Save.</p>

    <label className="rf-voice-field">
      <span>Voice</span>
      <select className="rf-voice-select" aria-label="Voice" value={card.voice.key} disabled={card.busy || card.saving} onChange={event => props.onChoose(event.target.value)}>
        {options.map(option => <option key={option.key} value={option.key}>{option.label}</option>)}
      </select>
    </label>

    {version === null && <>
      <label className="rf-voice-field">
        <span>Optional: paste a post you wrote, or describe the style you want</span>
        <Textarea aria-label="Your example or style (optional)" value={card.styleNote} onChange={event => props.onStyle(event.target.value)} rows={3} />
      </label>
      <div className="rf-voice-actions">
        <Button disabled={card.busy || card.baseStatus === 'loading'} onClick={props.onGenerate}>{card.busy ? 'Writing a sample…' : 'Generate a sample'}</Button>
      </div>
    </>}

    {card.message && <div role="alert" className="rf-voice-message">
      <p>{card.message}</p>
      {card.pending && !card.busy && <Button variant="outline" onClick={props.onRetry}>Try again</Button>}
    </div>}
    {card.approaching && <p className="rf-voice-approaching">{card.approaching}</p>}

    {version !== null && <div className="rf-voice-versions">
      <article className="rf-voice-sample" aria-label="Sample">
        <p className="rf-voice-label">
          <span>{SAMPLE_LABEL}</span>
          {version.startingProposal && <span className="rf-voice-starting">{STARTING_PROPOSAL_COPY}</span>}
        </p>
        <p className="rf-voice-text">{version.sample}</p>
      </article>
    </div>}
    {version?.startingProposal && <p className="rf-guidance-note">{STARTING_PROPOSAL_NOTE}</p>}

    {version !== null && !card.adjusting && <div className="rf-voice-actions">
      {card.guidanceDraft === null && <Button disabled={card.busy} onClick={() => props.onUse(version)}>Use this voice</Button>}
      <Button variant="outline" disabled={card.busy} onClick={props.onAdjustOpen}>Adjust</Button>
      <Button variant="ghost" disabled={card.busy || card.saving} onClick={props.onReset}>Start again</Button>
    </div>}
    {card.adjusting && <div className="rf-voice-adjust">
      <Textarea aria-label="What should change?" placeholder="For example: warmer, fewer emojis" value={card.instruction} onChange={event => props.onAdjustText(event.target.value)} rows={2} />
      <div className="rf-voice-actions">
        <Button disabled={card.busy || card.instruction.trim() === ''} onClick={props.onAdjustSend}>{card.busy ? 'Revising…' : 'Revise'}</Button>
        <Button variant="ghost" disabled={card.busy} onClick={props.onAdjustCancel}>Cancel</Button>
      </div>
    </div>}

    {card.guidanceDraft !== null && <div className="rf-voice-guidance">
      <h4>Guidance that will be saved for all your writing</h4>
      <Textarea aria-label="Guidance to save" value={card.guidanceDraft} onChange={event => props.onEditGuidance(event.target.value)} rows={7} aria-invalid={check.over > 0 || undefined} />
      <p className="rf-guidance-count" data-over={check.over > 0 || undefined}>{count(check.length)} / {count(GUIDANCE_LIMIT)}</p>
      {check.over > 0 && <p role="alert" className="rf-auth-error">That is {count(check.over)} {check.over === 1 ? 'character' : 'characters'} over the {count(GUIDANCE_LIMIT)} limit. Shorten it to save.</p>}
      <p className="rf-guidance-note">Saving replaces your general writing guidance above.</p>
      {card.stale && <div role="alert" className="rf-guidance-stale"><p>{STALE_GUIDANCE_COPY}</p><Button variant="outline" disabled={card.saving} onClick={props.onReload}>Reload</Button></div>}
      <div className="rf-voice-actions">
        <Button disabled={!canSave} onClick={props.onSave}>{card.saving ? 'Saving…' : 'Save'}</Button>
      </div>
    </div>}
    {card.savedText !== null && <p role="status" className="rf-voice-saved">{SAVED_COPY}</p>}
  </section>;
}

/** The connected voice card: the reducer, and the actions from `voiceController`. */
export default function VoiceCard() {
  const d = useData();
  const navigate = useNavigate();
  const [card, dispatch] = useReducer(voiceReducer, undefined, () => initialCard(GENERAL_VOICE, d.guidance.saved));
  const [options, setOptions] = useState<VoiceOption[]>([GENERAL_VOICE]);
  const { status: guidanceStatus, saved: generalSaved } = d.guidance;
  // The controller reads the LATEST state when an action runs, not the state
  // of the render that created the handler.
  const latest = useRef(card);
  latest.current = card;

  const controller = useMemo(() => voiceController(
    { get: () => latest.current, dispatch },
    {
      saveGeneral: (draft, base) => d.saveGuidance(draft, base),
      reloadGeneral: () => d.reloadGuidance(),
      onSignedOut: () => navigate('/refined/signin', { replace: true }),
      onSaved: () => toast.success('Guidance saved'),
    },
  ), [d, navigate]);

  useEffect(() => { void loadVoiceOptions().then(setOptions); }, []);
  // The general guidance is the Guidance tab's own server state: follow it.
  useEffect(() => {
    if (guidanceStatus === 'ready') dispatch({ type: 'base-loaded', base: generalSaved });
  }, [guidanceStatus, generalSaved]);

  return <VoiceCardView
    card={card}
    options={options}
    onChoose={key => controller.choose(options.find(option => option.key === key) ?? GENERAL_VOICE)}
    onStyle={controller.style}
    onGenerate={() => { void controller.generate(); }}
    onRetry={() => { void controller.retry(); }}
    onUse={controller.use}
    onAdjustOpen={controller.adjustOpen}
    onAdjustText={controller.adjustText}
    onAdjustSend={() => { void controller.adjust(); }}
    onAdjustCancel={controller.adjustCancel}
    onEditGuidance={controller.editGuidance}
    onSave={() => { void controller.save(); }}
    onReload={() => { void controller.reload(); }}
    onReset={controller.reset}
  />;
}
