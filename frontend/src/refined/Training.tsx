import { useState } from 'react';
import { useSearchParams } from './navigation';
import { Check, ChevronLeft, ChevronRight, Plus, Pencil } from 'lucide-react';
import { Radio } from '@base-ui/react/radio';
import { RadioGroup } from '@base-ui/react/radio-group';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { toast } from 'sonner';
import { useData } from './state';
import Knowledge from './Knowledge';
import { QUESTIONS, OTHER_ANSWER, getQuestionAnswer } from './questions';
export { QUESTIONS } from './questions';

export default function Training() {
  const d = useData();
  const [search, setSearch] = useSearchParams();
  const tab = search.get('tab') || 'guidance';
  const [index, setIndex] = useState(0);
  const [selected, setSelected] = useState<Record<string, string[]>>({});
  const [written, setWritten] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [active, setActive] = useState(true);
  const rules = [...d.rules.filter(rule => rule.enabled), ...d.rules.filter(rule => !rule.enabled)];
  const unanswered = QUESTIONS.filter(q => !d.answers[q.id]);
  const q = unanswered[Math.min(index, unanswered.length - 1)];
  const selection = q ? selected[q.id] || [] : [];
  const response = q ? written[q.id] || '' : '';
  const answer = q ? getQuestionAnswer(q, selection, response) : null;
  const choose = (value: string) => q && setSelected(s => ({ ...s, [q.id]: q.kind === 'multiple' ? selection.includes(value) ? selection.filter(v => v !== value) : [...selection, value] : [value] }));
  const write = (value: string) => q && setWritten(s => ({ ...s, [q.id]: value }));
  return <>
    <header className="rf-topbar"><h1>Train your AI</h1></header>
    <Tabs value={tab} onValueChange={value => setSearch({ tab: String(value) })} className="rf-training-tabs">
      <TabsList variant="line" className="rf-training-nav"><TabsTrigger value="questions">Questions {unanswered.length > 0 && <span className="rf-count">{unanswered.length}</span>}</TabsTrigger><TabsTrigger value="knowledge">Knowledge</TabsTrigger><TabsTrigger value="guidance">Guidance</TabsTrigger></TabsList>
      <TabsContent value="questions" className="rf-training-page rf-questions-page"><div className="rf-section-heading"><h2>Questions</h2>{unanswered.length > 0 && <span>{unanswered.length} waiting</span>}</div><p className="rf-section-description">Gaps the agent found in your material. Answer what you can; the rest stays here.</p>
        {q ? <Card className="rf-question"><CardContent><p className="rf-question-position">{Math.min(index + 1, unanswered.length)} of {unanswered.length}</p><h3>{q.title}</h3><p className="rf-question-reason">{q.why}</p>
          {'options' in q ? <>
            {q.kind === 'multiple' ? <div className="rf-options" role="group" aria-label={q.title}>{[...q.options, OTHER_ANSWER].map(option => <label key={option} className="rf-option" data-selected={selection.includes(option) || undefined}><Checkbox checked={selection.includes(option)} onCheckedChange={() => choose(option)} /><span>{option === OTHER_ANSWER ? 'Something else' : option}</span></label>)}</div> : <RadioGroup aria-label={q.title} value={selection[0] || ''} onValueChange={value => choose(String(value))} className="rf-options">{[...q.options, OTHER_ANSWER].map(option => <label key={option} className="rf-option" data-selected={selection.includes(option) || undefined}><Radio.Root value={option} className="rf-radio"><Radio.Indicator className="rf-radio-dot" /></Radio.Root><span>{option === OTHER_ANSWER ? 'Something else' : option}</span></label>)}</RadioGroup>}
            {selection.includes(OTHER_ANSWER) && <label className="rf-question-written rf-question-other" key={`${q.id}-other`}><span>Your answer</span><Textarea autoFocus value={response} onChange={event => write(event.target.value)} placeholder="The answer that fits, in your own words…" rows={3} /></label>}
          </> : <label className="rf-question-written" key={q.id}><span>Your answer</span>{q.kind === 'short' ? <Input value={response} onChange={event => write(event.target.value)} placeholder={q.placeholder} /> : <Textarea className="rf-question-long" value={response} onChange={event => write(event.target.value)} placeholder={q.placeholder} rows={7} />}</label>}
          <Button className="rf-question-save" disabled={!answer} onClick={() => { if (!answer) return; d.answer(q.id, answer); setIndex(i => Math.min(i, Math.max(0, unanswered.length - 2))); toast.success('Answer saved'); }}>Save answer <Check /></Button>
          <div className="rf-question-footer"><Button variant="ghost" size="icon" className="rf-question-previous" disabled={index === 0} aria-label="Previous question" onClick={() => setIndex(i => i - 1)}><ChevronLeft /></Button><span>{Math.min(index + 1, unanswered.length)} of {unanswered.length}</span><Button variant="ghost" size="icon" className="rf-question-next" disabled={index >= unanswered.length - 1} aria-label="Next question" onClick={() => setIndex(i => i + 1)}><ChevronRight /></Button></div>
        </CardContent></Card> : <Card className="rf-question rf-question-complete"><CardContent><div className="rf-complete-mark"><Check /></div><h3>You’re all caught up</h3><p>Your answers are saved. New questions will appear here when your material leaves something unclear.</p></CardContent></Card>}
      </TabsContent>
      <TabsContent value="knowledge" className="rf-training-page"><Knowledge /></TabsContent>
      <TabsContent value="guidance" className="rf-training-page"><div className="rf-section-heading"><h2>Guidance</h2><span>{d.rules.filter(rule => rule.enabled).length} active</span><Button variant="outline" onClick={() => { setEditing('new'); setText(''); setActive(true); }}><Plus /> Add</Button></div><p className="rf-section-description">Sent to the agent every time it writes.</p><div className="rf-guidance-list">{rules.map((rule, position) => <div key={rule.id} className="rf-rule" data-disabled={!rule.enabled || undefined}><span className="rf-rule-number" aria-hidden="true">{rule.enabled ? position + 1 : '—'}</span><span className="rf-rule-text" title={rule.text}>{rule.text}</span><Switch checked={rule.enabled} onCheckedChange={enabled => d.setRule({ ...rule, enabled })} aria-label={`Enable: ${rule.text}`} /><Button variant="ghost" size="icon" className="rf-rule-edit" aria-label={`Edit: ${rule.text}`} onClick={() => { setEditing(rule.id); setText(rule.text); setActive(rule.enabled); }}><Pencil /></Button></div>)}</div></TabsContent>
    </Tabs>
    <Dialog open={editing !== null} onOpenChange={open => !open && setEditing(null)}><DialogContent className="rf-settings"><DialogHeader><DialogTitle>{editing === 'new' ? 'Add guidance' : 'Edit guidance'}</DialogTitle><DialogDescription>A clear rule to guide every draft.</DialogDescription></DialogHeader><Textarea autoFocus aria-label="Guidance" value={text} onChange={event => setText(event.target.value)} rows={4} /><DialogFooter className="rf-guidance-editor-footer"><label>Active<Switch checked={active} onCheckedChange={setActive} /></label><Button variant="ghost" onClick={() => setEditing(null)}>Cancel</Button><Button disabled={!text.trim()} onClick={() => { d.setRule({ id: editing === 'new' ? crypto.randomUUID() : editing!, text: text.trim(), enabled: active }); setEditing(null); toast.success('Guidance saved'); }}>Save guidance</Button></DialogFooter></DialogContent></Dialog>
  </>;
}
