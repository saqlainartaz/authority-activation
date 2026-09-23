import { useEffect, useRef, useState } from 'react';
import { useNavigate } from './navigation';
import { ArrowLeft, ArrowRight, Check, ChevronDown, FileText } from 'lucide-react';
import { Radio } from '@base-ui/react/radio';
import { RadioGroup } from '@base-ui/react/radio-group';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { onboardingTextLength } from '@/lib/onboarding-profile';
import type { OnboardingPrefill } from '@/lib/product';
import { EntryBrand } from './Auth';
import {
  connectedPackets,
  responsesFromSetup,
  reviewAnswer,
  setupFromPrefill,
} from './connected-onboarding';
import { useData } from './state';
import {
  PACKETS,
  OTHER,
  advancesOnChoice,
  canContinue,
  setupComplete,
  type Packet,
  type Setup,
  type SetupAnswer,
} from './setup-packets';

const emptyAnswer: SetupAnswer = { selected: [], text: '' };
const emptySetup: Setup = { answers: {}, completed: false };

function AnswerLimit({ id, value, limit }: { id: string; value: string; limit?: number }) {
  if (limit === undefined) return null;
  const count = onboardingTextLength(value);
  const over = count > limit;
  return <p id={id} className="rf-answer-limit" data-over-limit={over || undefined}>
    {count} / {limit} characters{over ? ' · Shorten this answer to continue.' : ''}
  </p>;
}

function firstConnectedIndex(packets: readonly Packet[], setup: Setup): number {
  if (setup.completed) return packets.length;
  const required = packets.findIndex(packet => packet.required !== false && !canContinue(packet, setup.answers[packet.id]));
  return required < 0 ? 0 : required;
}

export default function Onboarding() {
  const d = useData();
  const navigate = useNavigate();
  const [connected, setConnected] = useState<{ prefill: OnboardingPrefill; packets: Packet[]; setup: Setup } | null>(null);
  const [index, setIndex] = useState(() => {
    const first = PACKETS.findIndex(packet => !canContinue(packet, d.onboarding.answers[packet.id]));
    return first < 0 ? PACKETS.length : first;
  });
  const [changing, setChanging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [finished, setFinished] = useState(false);
  const [error, setError] = useState('');
  const [loadAttempt, setLoadAttempt] = useState(0);
  const main = useRef<HTMLDivElement>(null);
  const title = useRef<HTMLHeadingElement>(null);

  const packets = d.isDemo ? PACKETS : connected?.packets ?? [];
  const setup = d.isDemo ? d.onboarding : connected?.setup ?? emptySetup;
  const packet = packets[index];
  const answer = packet ? setup.answers[packet.id] || emptyAnswer : emptyAnswer;
  const answerLimitId = packet?.maxTextChars !== undefined ? `rf-answer-limit-${packet.id}` : undefined;
  const answerOverLimit = Boolean(packet?.maxTextChars !== undefined && onboardingTextLength(answer.text) > packet.maxTextChars);
  const ready = d.isDemo || connected !== null;
  const valid = ready && (packet ? canContinue(packet, answer) : setupComplete(setup, packets));

  const write = (patch: Partial<SetupAnswer>) => {
    if (!packet) return;
    const next = { ...answer, ...patch };
    if (d.isDemo) {
      d.setSetupAnswer(packet.id, next);
      return;
    }
    setConnected(current => current ? {
      ...current,
      setup: { completed: false, answers: { ...current.setup.answers, [packet.id]: next } },
    } : current);
  };

  const choose = (value: string) => {
    if (!packet) return;
    const selected = packet.type === 'multi'
      ? answer.selected.includes(value)
        ? answer.selected.filter(candidate => candidate !== value)
        : packet.exclusiveChoices?.includes(value)
          ? [value]
          : [...answer.selected.filter(candidate => !packet.exclusiveChoices?.includes(candidate)), value]
      : [value];
    write({
      selected,
      text: selected.includes(OTHER) ? answer.text : '',
    });
    if (advancesOnChoice(packet, value)) {
      setIndex(changing ? packets.length : index + 1);
      setChanging(false);
    }
  };

  const next = () => {
    if (!valid) return;
    setIndex(changing ? packets.length : index + 1);
    setChanging(false);
  };

  useEffect(() => {
    if (d.isDemo) return;
    let active = true;
    setError('');
    void fetch('/api/client/onboarding', { cache: 'no-store' }).then(async response => {
      const body = await response.json().catch(() => ({})) as OnboardingPrefill & { error?: string; detail?: string };
      if (response.status === 401) {
        navigate('/refined/signin', { replace: true });
        return;
      }
      if (!response.ok) throw new Error(body.error || body.detail || 'Could not load your setup.');
      const nextPackets = connectedPackets(body);
      const nextSetup = setupFromPrefill(body);
      if (active) {
        setConnected({ prefill: body, packets: nextPackets, setup: nextSetup });
        setIndex(firstConnectedIndex(nextPackets, nextSetup));
      }
    }).catch(reason => {
      if (active) setError(reason instanceof Error ? reason.message : 'Could not load your setup.');
    });
    return () => { active = false; };
  }, [d.isDemo, loadAttempt]);

  async function finish() {
    if (busy || !ready || !setupComplete(setup, packets)) return;
    if (d.isDemo) {
      d.completeSetupLocal();
      setFinished(true);
      return;
    }
    setBusy(true);
    setError('');
    try {
      const responses = responsesFromSetup(packets, setup);
      const response = await fetch('/api/client/onboarding', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clarifications: responses }),
      });
      const body = await response.json().catch(() => ({})) as { error?: string; detail?: unknown };
      if (response.status === 401) {
        navigate('/refined/signin', { replace: true });
        return;
      }
      if (!response.ok) {
        throw new Error(body.error || (typeof body.detail === 'string' ? body.detail : 'Your setup was not saved.'));
      }
      setFinished(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Your setup was not saved.');
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    main.current?.scrollTo({ top: 0 });
    title.current?.focus();
  }, [index]);

  const displayName = connected?.prefill.user.display_name.trim();

  if (finished) return <main className="rf-entry rf-onboarding">
    <header className="rf-onboarding-header"><EntryBrand /><span>Complete</span></header>
    <div className="rf-onboarding-scroll"><section className="rf-onboarding-body">
      <p className="rf-onboarding-reason">Your answers are in.</p>
      <h1>You’re good to go.</h1>
      <p className="rf-entry-note">You can add more knowledge and connect social accounts later.</p>
    </section></div>
    <footer className="rf-onboarding-footer"><div><Button className="rf-onboarding-next" onClick={() => navigate('/refined/workspace?welcome=1', { replace: true })}>Open my workspace <ArrowRight /></Button></div></footer>
  </main>;

  return <main className="rf-entry rf-onboarding" onKeyDown={event => {
    const target = event.target as HTMLElement;
    if (!packet || event.ctrlKey || event.metaKey || event.altKey || target.closest('input, textarea')) return;
    if (/^[1-9]$/.test(event.key) && packet.options) {
      const choice = [...packet.options.map(option => option.label), OTHER][Number(event.key) - 1];
      if (choice) { event.preventDefault(); choose(choice); }
    }
    if (event.key === 'Enter' && (!target.closest('button') || target.closest('[role="radio"]'))) {
      event.preventDefault();
      next();
    }
  }}>
    <header className="rf-onboarding-header"><EntryBrand /><span>{packet ? `Question ${index + 1} of ${packets.length}` : ready ? 'Review your answers' : 'Preparing your questions'}</span></header>
    <div className="rf-onboarding-scroll" ref={main}><section className="rf-onboarding-body">
      {!ready ? error ? <><p className="rf-onboarding-reason">We could not load your setup.</p><p className="rf-auth-error" role="alert">{error}</p><Button variant="outline" onClick={() => setLoadAttempt(attempt => attempt + 1)}>Retry</Button></> : <p className="rf-onboarding-reason">Loading your setup…</p> : packet ? <>
        {!d.isDemo && index === 0 && displayName && <p className="rf-onboarding-reason">Welcome, {displayName}. A few answers will help clarify what we know about your work.</p>}
        <h1 ref={title} tabIndex={-1}>{packet.headline}</h1>
        {(packet.quote || packet.options?.some(option => option.quote)) ? <Collapsible key={packet.id} className="rf-onboarding-context"><CollapsibleTrigger render={<Button variant="ghost" />}><FileText /> View source context <ChevronDown className="rf-context-chevron" /></CollapsibleTrigger><CollapsibleContent><div className="rf-context-excerpts"><p>{packet.why}</p>{packet.quote && <blockquote>{packet.quote}<cite>{packet.source}</cite></blockquote>}{packet.options?.filter(option => option.quote).map(option => <blockquote key={option.label}><span>{option.label}</span>{option.quote}<cite>{option.source}</cite></blockquote>)}</div></CollapsibleContent></Collapsible> : <p className="rf-onboarding-instruction">{packet.type === 'multi' ? 'Choose all that apply.' : packet.why}</p>}
        {packet.options ? <Card className="rf-onboarding-card">
          {packet.type === 'multi' ? <div role="group" aria-label={packet.headline}>{[...packet.options, { label: OTHER }].map(option => <label className="rf-onboarding-option" key={option.label} data-selected={answer.selected.includes(option.label) || undefined}><Checkbox checked={answer.selected.includes(option.label)} onCheckedChange={() => choose(option.label)} /><span>{option.label === OTHER ? 'Something else, I will type it' : option.label}</span></label>)}</div> : <RadioGroup aria-label={packet.headline} value={answer.selected[0] || ''} onValueChange={value => choose(String(value))}>{[...packet.options, { label: OTHER }].map(option => <label className="rf-onboarding-option" key={option.label} data-selected={answer.selected.includes(option.label) || undefined}><Radio.Root className="rf-radio" value={option.label}><Radio.Indicator className="rf-radio-dot" /></Radio.Root><span>{option.label === OTHER ? 'Something else, I will type it' : option.label}</span></label>)}</RadioGroup>}
          {answer.selected.includes(OTHER) && <><Textarea autoFocus key={`${packet.id}-other`} className="rf-onboarding-other" aria-label="Your own answer" aria-invalid={answerOverLimit || undefined} aria-describedby={answerLimitId} placeholder="The real answer, in your own words." value={answer.text} onChange={event => write({ text: event.target.value })} rows={3} /><AnswerLimit id={answerLimitId!} value={answer.text} limit={packet.maxTextChars} /></>}
        </Card> : packet.type === 'short' ? <><Input key={packet.id} className="rf-onboarding-write" aria-label={packet.headline} aria-invalid={answerOverLimit || undefined} aria-describedby={answerLimitId} placeholder={packet.placeholder} value={answer.text} onChange={event => write({ text: event.target.value })} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); next(); } }} /><AnswerLimit id={answerLimitId!} value={answer.text} limit={packet.maxTextChars} /></> : <><Textarea key={packet.id} className="rf-onboarding-write rf-onboarding-long" aria-label={packet.headline} aria-invalid={answerOverLimit || undefined} aria-describedby={answerLimitId} placeholder={packet.placeholder} value={answer.text} onChange={event => write({ text: event.target.value })} rows={6} /><AnswerLimit id={answerLimitId!} value={answer.text} limit={packet.maxTextChars} /></>}
      </> : <><p className="rf-onboarding-reason">A quick check before you start writing.</p><h1 ref={title} tabIndex={-1}>Does this sound right?</h1><div className="rf-onboarding-review">{packets.map((candidate, candidateIndex) => <div key={candidate.id}><span>{candidate.topic}</span><p>{reviewAnswer(candidate, setup.answers[candidate.id])}</p><Button variant="ghost" disabled={busy} onClick={() => { setChanging(true); setIndex(candidateIndex); }} aria-label={`Change ${candidate.topic}`}>Change</Button></div>)}</div><p className="rf-entry-note">{d.isDemo ? 'Your answers are saved on this device for the demo.' : 'Your answers are saved to your client knowledge. Business DNA can be filled in separately in Train your AI.'}</p></>}
      {ready && error && <p className="rf-auth-error" role="alert">{error}</p>}
    </section></div>
    {ready && <footer className="rf-onboarding-footer"><div>{(index > 0 || changing) && <Button variant="ghost" disabled={busy} onClick={() => { setIndex(changing ? packets.length : index - 1); setChanging(false); }}><ArrowLeft />{changing ? 'Back to review' : 'Back'}</Button>}<Button className="rf-onboarding-next" disabled={!valid || busy} onClick={packet ? next : finish}>{busy ? 'Saving…' : packet ? changing ? 'Save answer' : 'Next' : 'Open my workspace'}{packet ? <ArrowRight /> : <Check />}</Button></div></footer>}
  </main>;
}
