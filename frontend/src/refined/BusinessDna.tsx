import { useEffect, useRef, useState } from 'react';
import { Check, Pencil } from 'lucide-react';
import { Radio } from '@base-ui/react/radio';
import { RadioGroup } from '@base-ui/react/radio-group';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
import {
  onboardingTextLength,
  OTHER_VALUE,
} from '@/lib/onboarding-profile';
import type { OnboardingPrefill } from '@/lib/product';
import {
  businessDnaSections,
  type BusinessDnaField,
  type BusinessDnaSection,
} from './business-dna';
import { useData } from './state';
import { useNavigate } from './navigation';
import type { SetupAnswer } from './setup-packets';

function validField(field: BusinessDnaField, answer: SetupAnswer): boolean {
  if (!field.question) return true;
  if (onboardingTextLength(answer.text) > field.question.max_text_chars) return false;
  if (field.question.input_type === 'long') {
    return field.required === false || Boolean(answer.text.trim());
  }
  if (!answer.selected.length) return field.required === false;
  return answer.selected[0] !== OTHER_VALUE || Boolean(answer.text.trim());
}

function AnswerLimit({ id, value, limit }: { id: string; value: string; limit: number }) {
  const count = onboardingTextLength(value);
  const over = count > limit;
  return <p id={id} className="rf-answer-limit" data-over-limit={over || undefined}>
    {count} / {limit} characters{over ? ' · Shorten this answer to save.' : ''}
  </p>;
}

export default function BusinessDna() {
  const d = useData();
  const navigate = useNavigate();
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;
  const [prefill, setPrefill] = useState<OnboardingPrefill | null>(null);
  const [ready, setReady] = useState(d.isDemo);
  const [editing, setEditing] = useState<BusinessDnaSection['id'] | null>(null);
  const [draft, setDraft] = useState<Record<string, SetupAnswer>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (d.isDemo) return;
    let active = true;
    void fetch('/api/client/onboarding', { cache: 'no-store' }).then(async response => {
      const body = await response.json().catch(() => ({})) as OnboardingPrefill & { error?: string; detail?: string };
      if (response.status === 401) {
        navigateRef.current('/refined/signin', { replace: true });
        return;
      }
      if (!response.ok) throw new Error(body.error || body.detail || 'Could not load Business DNA.');
      businessDnaSections(body);
      if (active) { setPrefill(body); setReady(true); }
    }).catch(reason => {
      if (active) { setError(reason instanceof Error ? reason.message : 'Could not load Business DNA.'); setReady(true); }
    });
    return () => { active = false; };
  }, [d.isDemo]);

  const sections = prefill ? businessDnaSections(prefill) : [];
  const begin = (section: BusinessDnaSection) => {
    if (busy || editing !== null) return;
    setDraft(Object.fromEntries(section.fields.filter(field => field.editable).map(field => [
      field.id,
      field.answer ? { selected: [...field.answer.selected], text: field.answer.text } : { selected: [], text: '' },
    ])));
    setEditing(section.id);
    setError('');
  };
  const write = (id: string, answer: SetupAnswer) => {
    if (busy) return;
    setDraft(current => ({ ...current, [id]: answer }));
  };

  async function save(section: BusinessDnaSection) {
    if (!prefill || busy) return;
    const editable = section.fields.filter(field => field.editable && field.question);
    if (!editable.every(field => validField(field, draft[field.id] ?? { selected: [], text: '' }))) return;
    setBusy(true);
    setError('');
    try {
      const edits = editable.map(field => {
        const answer = draft[field.id] ?? { selected: [], text: '' };
        return {
          question_id: field.id,
          question_version: field.question!.question_version,
          selected: [...answer.selected],
          text: answer.selected[0] && answer.selected[0] !== OTHER_VALUE ? '' : answer.text,
        };
      });
      const response = await fetch('/api/client/onboarding', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ merge: true, responses: edits }),
      });
      const body = await response.json().catch(() => ({})) as { answers?: Record<string, unknown>; confirmed_at?: string | null; error?: string; detail?: unknown };
      if (response.status === 401) {
        navigateRef.current('/refined/signin', { replace: true });
        return;
      }
      if (!response.ok || !body.answers) {
        throw new Error(body.error || (typeof body.detail === 'string' ? body.detail : 'Business DNA was not saved.'));
      }
      const nextPrefill = {
        ...prefill,
        answers: body.answers!,
        confirmed_at: body.confirmed_at ?? prefill.confirmed_at,
      } as OnboardingPrefill;
      businessDnaSections(nextPrefill);
      setPrefill(nextPrefill);
      setEditing(null);
      toast.success('Business DNA saved');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Business DNA was not saved.');
    } finally {
      setBusy(false);
    }
  }

  return <>
    <header className="rf-topbar"><h1>Business DNA</h1></header>
    <div className="rf-dna-scroll"><div className="rf-dna-content">
      <div className="rf-section-heading"><div><h2>Business DNA</h2><p className="rf-section-description">The core context your writing assistant uses to understand you and your work.</p></div></div>
      {!ready && <p className="rf-dna-state">Loading your profile…</p>}
      {ready && d.isDemo && <Card className="rf-dna-card"><CardContent><p className="rf-dna-state">No Business DNA has been saved in this demo.</p></CardContent></Card>}
      {ready && !d.isDemo && !prefill && !error && <p className="rf-dna-state">No Business DNA has been saved yet.</p>}
      {sections.map(section => {
        const active = editing === section.id;
        const canSave = section.fields.filter(field => field.editable).every(field => validField(field, draft[field.id] ?? { selected: [], text: '' }));
        return <Card className="rf-dna-card" key={section.id}><CardContent>
          <div className="rf-dna-section-heading"><h3>{section.title}</h3>{!active && <Button variant="ghost" disabled={editing !== null || busy} onClick={() => begin(section)}><Pencil /> Edit</Button>}</div>
          <dl className="rf-dna-fields">{section.fields.map(field => <div key={field.id}><dt>{field.label}</dt><dd>
            {!active || !field.editable ? field.value : field.question?.input_type === 'single' ? <div className="rf-dna-editor"><RadioGroup disabled={busy} aria-label={field.label} value={draft[field.id]?.selected[0] || ''} onValueChange={value => write(field.id, { selected: [String(value)], text: String(value) === OTHER_VALUE ? draft[field.id]?.text ?? '' : '' })}>{[...(field.question.choices ?? []), OTHER_VALUE].map(option => <label className="rf-dna-option" key={option}><Radio.Root className="rf-radio" value={option}><Radio.Indicator className="rf-radio-dot" /></Radio.Root><span>{option === OTHER_VALUE ? 'Something else' : option}</span></label>)}</RadioGroup>{field.required === false && <Button variant="ghost" disabled={busy} onClick={() => write(field.id, { selected: [], text: '' })}>Clear answer</Button>}{draft[field.id]?.selected[0] === OTHER_VALUE && <><Textarea disabled={busy} aria-label={`${field.label} custom answer`} aria-invalid={onboardingTextLength(draft[field.id]?.text ?? '') > field.question.max_text_chars || undefined} aria-describedby={`rf-dna-limit-${field.id}`} value={draft[field.id]?.text ?? ''} onChange={event => write(field.id, { selected: [OTHER_VALUE], text: event.target.value })} rows={3} /><AnswerLimit id={`rf-dna-limit-${field.id}`} value={draft[field.id]?.text ?? ''} limit={field.question.max_text_chars} /></>}</div> : <div className="rf-dna-editor"><Textarea disabled={busy} aria-label={field.label} aria-invalid={onboardingTextLength(draft[field.id]?.text ?? '') > field.question!.max_text_chars || undefined} aria-describedby={`rf-dna-limit-${field.id}`} value={draft[field.id]?.text ?? ''} onChange={event => write(field.id, { selected: [], text: event.target.value })} rows={4} /><AnswerLimit id={`rf-dna-limit-${field.id}`} value={draft[field.id]?.text ?? ''} limit={field.question!.max_text_chars} /></div>}
          </dd></div>)}</dl>
          {active && <div className="rf-dna-actions"><Button variant="ghost" disabled={busy} onClick={() => { setEditing(null); setError(''); }}>Cancel</Button><Button disabled={!canSave || busy} onClick={() => void save(section)}>{busy ? 'Saving…' : <>Save <Check /></>}</Button></div>}
        </CardContent></Card>;
      })}
      {error && <p className="rf-auth-error" role="alert">{error}</p>}
    </div></div>
  </>;
}
