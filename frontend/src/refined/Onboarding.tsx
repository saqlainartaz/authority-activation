import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
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
      </> : <><p className="rf-onboarding-reason">A quick check before you start writing.</p><h1 ref={title} tabIndex={-1}>Does this sound right?</h1><div className="rf-onboarding-review">{PACKETS.map((p, i) => <div key={p.id}><span>{p.topic}</span><p>{packetAnswer(p, d.onboarding.answers[p.id])?.join(' · ')}</p><Button variant="ghost" onClick={() => { setChanging(true); setIndex(i); }} aria-label={`Change ${p.topic}`}>Change</Button></div>)}</div><p className="rf-entry-note">Your answers are saved on this device for the prototype.</p></>}
    </section></div>
    <footer className="rf-onboarding-footer"><div>{(index > 0 || changing) && <Button variant="ghost" onClick={() => { setIndex(changing ? PACKETS.length : index - 1); setChanging(false); }}><ArrowLeft />{changing ? 'Back to review' : 'Back'}</Button>}<Button className="rf-onboarding-next" disabled={!valid} onClick={packet ? next : () => { d.completeSetup(); navigate('/refined/workspace?welcome=1', { replace: true }); }}>{packet ? changing ? 'Save answer' : 'Next' : 'Open my workspace'}{packet ? <ArrowRight /> : <Check />}</Button></div></footer>
  </main>;
}
