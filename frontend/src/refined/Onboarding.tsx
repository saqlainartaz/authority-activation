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
import { EntryBrand } from './Auth';
import { useData } from './state';
import { PACKETS, OTHER, packetAnswer, setupComplete, advancesOnChoice, type SetupAnswer } from './setup-packets';

const empty: SetupAnswer = { selected: [], text: '' };
export default function Onboarding() {
  const d = useData();
  const navigate = useNavigate();
  const [index, setIndex] = useState(() => { const first = PACKETS.findIndex(p => !packetAnswer(p, d.onboarding.answers[p.id])); return first < 0 ? PACKETS.length : first; });
  const [changing, setChanging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const serverAnswers = useRef<Record<string, unknown>>({});
  const main = useRef<HTMLDivElement>(null);
  const title = useRef<HTMLHeadingElement>(null);
  const packet = PACKETS[index];
  const answer = packet ? d.onboarding.answers[packet.id] || empty : empty;
  const valid = packet ? !!packetAnswer(packet, answer) : setupComplete(d.onboarding);
  const write = (patch: Partial<SetupAnswer>) => d.setSetupAnswer(packet.id, { ...answer, ...patch });
  const choose = (value: string) => {
    write({ selected: packet.type === 'multi' ? answer.selected.includes(value) ? answer.selected.filter(v => v !== value) : [...answer.selected, value] : [value] });
    if (advancesOnChoice(packet, value)) { setIndex(changing ? PACKETS.length : index + 1); setChanging(false); }
  };
  const next = () => { if (valid) { setIndex(changing ? PACKETS.length : index + 1); setChanging(false); } };
  useEffect(() => {
    if (d.isDemo) return;
    let active = true;
    void fetch('/api/client/onboarding', { cache: 'no-store' }).then(async response => {
      const body = await response.json().catch(() => ({})) as { answers?: Record<string, unknown>; error?: string };
      if (!response.ok) throw new Error(body.error || 'Could not load your setup.');
      if (active) serverAnswers.current = body.answers ?? {};
    }).catch(reason => { if (active) setError(reason instanceof Error ? reason.message : 'Could not load your setup.'); });
    return () => { active = false; };
  }, [d.isDemo]);

  async function finish() {
    if (busy || !setupComplete(d.onboarding)) return;
    if (d.isDemo) { d.completeSetupLocal(); navigate('/refined/workspace?welcome=1', { replace: true }); return; }
    setBusy(true); setError('');
    const answer = (id: string) => packetAnswer(PACKETS.find(candidate => candidate.id === id)!, d.onboarding.answers[id]) ?? [];
    const existing = serverAnswers.current;
    const list = (key: string) => Array.isArray(existing[key]) ? existing[key] as string[] : [];
    const payload = {
      // The approved restaurant-group choices are not the old backend's
      // profession-derived audience keys. Preserve any authoritative value;
      // never invent a key merely to make this screen look connected.
      audience: list('audience'), never_say: list('never_say'), voice_constraints: list('voice_constraints'), tone: list('tone'),
      tldr: answer('company'), insight: answer('services'), pain_point: list('pain_point'), objection: list('objection'), proof_point: list('proof_point'), quote: list('quote'),
      terminology: [...answer('timing'), ...answer('engine')],
    };
    try {
      const response = await fetch('/api/client/onboarding', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const body = await response.json().catch(() => ({})) as { error?: string; detail?: unknown };
      if (!response.ok) {
        const detail = body.error || (typeof body.detail === 'string' ? body.detail : 'Your setup was not saved.');
        if (detail.includes('a confirmation must answer at least one guardrail question')) {
          throw new Error('The previous backend also requires a confirmed writing guardrail, but this approved setup does not ask that question. Your answers are still here; an operator must add a guardrail before setup can complete.');
        }
        throw new Error(detail);
      }
      d.completeSetupLocal();
      navigate('/refined/workspace?welcome=1', { replace: true });
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Your setup was not saved.'); }
    finally { setBusy(false); }
  }
  useEffect(() => { main.current?.scrollTo({ top: 0 }); title.current?.focus(); }, [index]);
  return <main className="rf-entry rf-onboarding" onKeyDown={event => {
    const target = event.target as HTMLElement;
    if (!packet || event.ctrlKey || event.metaKey || event.altKey || target.closest('input, textarea')) return;
    if (/^[1-9]$/.test(event.key) && packet.options) { const choice = [...packet.options.map(o => o.label), OTHER][Number(event.key) - 1]; if (choice) { event.preventDefault(); choose(choice); } }
    if (event.key === 'Enter' && (!target.closest('button') || target.closest('[role="radio"]'))) { event.preventDefault(); next(); }
  }}>
    <header className="rf-onboarding-header"><EntryBrand /><span>{packet ? `Question ${index + 1} of ${PACKETS.length}` : 'Review your answers'}</span></header>
    <div className="rf-onboarding-scroll" ref={main}><section className="rf-onboarding-body">
      {packet ? <><h1 ref={title} tabIndex={-1}>{packet.headline}</h1>
        {(packet.quote || packet.options?.some(option => option.quote)) ? <Collapsible key={packet.id} className="rf-onboarding-context"><CollapsibleTrigger render={<Button variant="ghost" />}><FileText /> View source context <ChevronDown className="rf-context-chevron" /></CollapsibleTrigger><CollapsibleContent><div className="rf-context-excerpts"><p>{packet.why}</p>{packet.quote && <blockquote>{packet.quote}<cite>{packet.source}</cite></blockquote>}{packet.options?.filter(option => option.quote).map(option => <blockquote key={option.label}><span>{option.label}</span>{option.quote}<cite>{option.source}</cite></blockquote>)}</div></CollapsibleContent></Collapsible> : <p className="rf-onboarding-instruction">{packet.type === 'multi' ? 'Choose all that apply.' : packet.why}</p>}
        {packet.options ? <Card className="rf-onboarding-card">
          {packet.type === 'multi' ? <div role="group" aria-label={packet.headline}>{[...packet.options, { label: OTHER }].map(option => <label className="rf-onboarding-option" key={option.label} data-selected={answer.selected.includes(option.label) || undefined}><Checkbox checked={answer.selected.includes(option.label)} onCheckedChange={() => choose(option.label)} /><span>{option.label === OTHER ? 'Something else, I will type it' : option.label}</span></label>)}</div> : <RadioGroup aria-label={packet.headline} value={answer.selected[0] || ''} onValueChange={value => choose(String(value))}>{[...packet.options, { label: OTHER }].map(option => <label className="rf-onboarding-option" key={option.label} data-selected={answer.selected.includes(option.label) || undefined}><Radio.Root className="rf-radio" value={option.label}><Radio.Indicator className="rf-radio-dot" /></Radio.Root><span>{option.label === OTHER ? 'Something else, I will type it' : option.label}</span></label>)}</RadioGroup>}
          {answer.selected.includes(OTHER) && <Textarea autoFocus key={`${packet.id}-other`} className="rf-onboarding-other" aria-label="Your own answer" placeholder="The real answer, or who would know." value={answer.text} onChange={event => write({ text: event.target.value })} rows={3} />}
        </Card> : packet.type === 'short' ? <Input key={packet.id} className="rf-onboarding-write" aria-label={packet.headline} placeholder={packet.placeholder} value={answer.text} onChange={event => write({ text: event.target.value })} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); next(); } }} /> : <Textarea key={packet.id} className="rf-onboarding-write rf-onboarding-long" aria-label={packet.headline} placeholder={packet.placeholder} value={answer.text} onChange={event => write({ text: event.target.value })} rows={6} />}
      </> : <><p className="rf-onboarding-reason">A quick check before you start writing.</p><h1 ref={title} tabIndex={-1}>Does this sound right?</h1><div className="rf-onboarding-review">{PACKETS.map((p, i) => <div key={p.id}><span>{p.topic}</span><p>{packetAnswer(p, d.onboarding.answers[p.id])?.join(' · ')}</p><Button variant="ghost" onClick={() => { setChanging(true); setIndex(i); }} aria-label={`Change ${p.topic}`}>Change</Button></div>)}</div><p className="rf-entry-note">{d.isDemo ? 'Your answers are saved on this device for the demo.' : 'Compatible answers are written to your account together. The audience choice remains local because the previous backend uses a different audience catalogue.'}</p></>}
      {error && <p className="rf-auth-error" role="alert">{error}</p>}
    </section></div>
    <footer className="rf-onboarding-footer"><div>{(index > 0 || changing) && <Button variant="ghost" onClick={() => { setIndex(changing ? PACKETS.length : index - 1); setChanging(false); }}><ArrowLeft />{changing ? 'Back to review' : 'Back'}</Button>}<Button className="rf-onboarding-next" disabled={!valid || busy} onClick={packet ? next : finish}>{busy ? 'Saving…' : packet ? changing ? 'Save answer' : 'Next' : 'Open my workspace'}{packet ? <ArrowRight /> : <Check />}</Button></div></footer>
  </main>;
}
