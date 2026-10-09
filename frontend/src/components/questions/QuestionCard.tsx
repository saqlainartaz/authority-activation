// The one shared question card (Cycle 5 P6.6; spec 4-5; A07).
//
// Every question the new engine asks, wherever it is asked -- onboarding, Train
// Your AI -> Questions, and Business DNA's editor -- renders through this card,
// so the controls behave the same everywhere. It is a controlled view: the
// caller holds the draft and decides what a submission does. Under M1 none of
// this renders; the M1 screens keep their own controls (`usesQuestionStore`).
//
// What it shows:
// - the question, its position ("3 of 7") when the caller gives one, and the
//   one "Why we're asking" sentence;
// - the control: single or multiple choice, short or long text;
// - "Something else" (`allow_alternative`): a free answer in place of the
//   options. The store takes ONE value per answer, so on a multiple choice it
//   replaces the ticked options rather than joining them;
// - Save answer, Skip and Later (defer), and "Not sure" (`allow_uncertain`,
//   recorded as the `unknown` disposition). Nothing is mandatory (D01).
//
// `PendingAnswerCard` (P6.8, review I-3) is the same question when its answer
// is saved but not applied yet: "We couldn't save that yet — try again", and
// one Try again that re-sends the saved answer under its own key.

import type { Ref } from 'react';
import { Radio } from '@base-ui/react/radio';
import { RadioGroup } from '@base-ui/react/radio-group';
import { Check, RotateCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';

export type QuestionControl = 'single' | 'multiple' | 'short' | 'long';

export type CardQuestion = {
  id: string;
  control: QuestionControl;
  prompt: string;
  /** The one short "Why we're asking" sentence. */
  why: string;
  options: Array<{ id: string; label: string }>;
  allow_alternative: boolean;
  allow_uncertain: boolean;
};

export type CardDraft = {
  /** The chosen option of a single choice. */
  option: string | null;
  /** The ticked options of a multiple choice. */
  options: string[];
  /** A short or long text answer. */
  text: string;
  /** "Something else" is chosen, and what was typed for it. */
  alternative: boolean;
  alternativeText: string;
};

export type Disposition = 'answer' | 'skip' | 'unknown' | 'defer';
export type CardSubmission = { disposition: Disposition; payload?: Record<string, unknown> };

export const EMPTY_DRAFT: CardDraft = { option: null, options: [], text: '', alternative: false, alternativeText: '' };

// The store's limits (`service.py`): short 200, long 4,000, a free answer 4,000.
export const SHORT_TEXT_MAX = 200;
export const LONG_TEXT_MAX = 4_000;
export const ALTERNATIVE_MAX = 4_000;

export const WHY_LABEL = "Why we're asking";
export const SOMETHING_ELSE = 'Something else';
export const NOT_SURE = 'Not sure';
export const SKIP = 'Skip';
export const LATER = 'Later';
export const SAVE_ANSWER = 'Save answer';

const ALTERNATIVE_VALUE = '__something_else__';

const isChoice = (question: CardQuestion) => question.control === 'single' || question.control === 'multiple';

function filled(value: string, limit: number): boolean {
  return value.trim().length > 0 && value.length <= limit;
}

/** The answer payload this draft stands for, or null while it is not a complete answer. */
export function answerPayload(question: CardQuestion, draft: CardDraft): Record<string, unknown> | null {
  if (question.allow_alternative && isChoice(question) && draft.alternative) {
    return filled(draft.alternativeText, ALTERNATIVE_MAX) ? { alternative: draft.alternativeText } : null;
  }
  if (question.control === 'single') {
    return draft.option && question.options.some(option => option.id === draft.option) ? { option: draft.option } : null;
  }
  if (question.control === 'multiple') {
    const offered = new Set(question.options.map(option => option.id));
    const chosen = draft.options.filter(id => offered.has(id));
    return chosen.length ? { options: chosen } : null;
  }
  const limit = question.control === 'short' ? SHORT_TEXT_MAX : LONG_TEXT_MAX;
  return filled(draft.text, limit) ? { text: draft.text } : null;
}

/** Choose (or, on a multiple choice, toggle) an option; it replaces "Something else". */
export function chooseOption(question: CardQuestion, draft: CardDraft, id: string): CardDraft {
  if (question.control === 'multiple') {
    const options = draft.options.includes(id) ? draft.options.filter(value => value !== id) : [...draft.options, id];
    return { ...draft, options, alternative: false };
  }
  return { ...draft, option: id, alternative: false };
}

/** Choose (or untick) "Something else"; it replaces the chosen options. */
export function chooseAlternative(draft: CardDraft, on = true): CardDraft {
  return on ? { ...draft, option: null, options: [], alternative: true } : { ...draft, alternative: false };
}

type CardProps = {
  question: CardQuestion;
  draft: CardDraft;
  onDraft: (draft: CardDraft) => void;
  /** 1-based position and total ("3 of 7"), when the caller is stepping through a set. */
  position?: { index: number; total: number } | null;
  busy?: boolean;
  error?: string | null;
  /** Omitted: the card shows its controls only (an editor that saves elsewhere). */
  onSubmit?: (submission: CardSubmission) => void;
  headingRef?: Ref<HTMLHeadingElement>;
  /** The text limit, when the caller's own store is narrower than the question store's. */
  textLimit?: number;
  className?: string;
};

export function QuestionControls({ question, draft, onDraft, busy = false, textLimit }: Pick<CardProps, 'question' | 'draft' | 'onDraft' | 'busy' | 'textLimit'>) {
  const alternativeOffered = question.allow_alternative && isChoice(question);
  const alternativeInput = alternativeOffered && draft.alternative
    ? <Textarea autoFocus className="rf-qcard-alternative" aria-label={`${SOMETHING_ELSE}: your answer`} disabled={busy}
      maxLength={textLimit ?? ALTERNATIVE_MAX} placeholder="The answer that fits, in your own words." rows={3}
      value={draft.alternativeText} onChange={event => onDraft({ ...draft, alternativeText: event.target.value })} />
    : null;
  if (question.control === 'single') {
    const value = draft.alternative ? ALTERNATIVE_VALUE : draft.option ?? '';
    return <div className="rf-qcard-control">
      <RadioGroup aria-label={question.prompt} value={value} disabled={busy} onValueChange={next => {
        const chosen = String(next);
        onDraft(chosen === ALTERNATIVE_VALUE ? chooseAlternative(draft) : chooseOption(question, draft, chosen));
      }}>
        {question.options.map(option => <label key={option.id} className="rf-qcard-option" data-selected={(!draft.alternative && draft.option === option.id) || undefined}>
          <Radio.Root className="rf-radio" value={option.id}><Radio.Indicator className="rf-radio-dot" /></Radio.Root><span>{option.label}</span>
        </label>)}
        {alternativeOffered && <label className="rf-qcard-option" data-selected={draft.alternative || undefined}>
          <Radio.Root className="rf-radio" value={ALTERNATIVE_VALUE}><Radio.Indicator className="rf-radio-dot" /></Radio.Root><span>{SOMETHING_ELSE}</span>
        </label>}
      </RadioGroup>
      {alternativeInput}
    </div>;
  }
  if (question.control === 'multiple') {
    return <div className="rf-qcard-control">
      <div role="group" aria-label={question.prompt}>
        {question.options.map(option => <label key={option.id} className="rf-qcard-option" data-selected={(!draft.alternative && draft.options.includes(option.id)) || undefined}>
          <Checkbox disabled={busy} checked={!draft.alternative && draft.options.includes(option.id)} onCheckedChange={() => onDraft(chooseOption(question, draft, option.id))} /><span>{option.label}</span>
        </label>)}
        {alternativeOffered && <label className="rf-qcard-option" data-selected={draft.alternative || undefined}>
          <Checkbox disabled={busy} checked={draft.alternative} onCheckedChange={checked => onDraft(chooseAlternative(draft, Boolean(checked)))} /><span>{SOMETHING_ELSE}</span>
        </label>}
      </div>
      {alternativeInput}
    </div>;
  }
  if (question.control === 'short') {
    return <div className="rf-qcard-control">
      <Input className="rf-qcard-text" aria-label={question.prompt} disabled={busy} maxLength={textLimit ?? SHORT_TEXT_MAX}
        value={draft.text} onChange={event => onDraft({ ...draft, text: event.target.value })} />
    </div>;
  }
  return <div className="rf-qcard-control">
    <Textarea className="rf-qcard-text rf-qcard-long" aria-label={question.prompt} disabled={busy} maxLength={textLimit ?? LONG_TEXT_MAX} rows={6}
      value={draft.text} onChange={event => onDraft({ ...draft, text: event.target.value })} />
  </div>;
}

export function QuestionCard({ question, draft, onDraft, position, busy = false, error, onSubmit, headingRef, textLimit, className }: CardProps) {
  const payload = answerPayload(question, draft);
  return <section className={className ? `rf-qcard ${className}` : 'rf-qcard'} aria-busy={busy || undefined}>
    {position && <p className="rf-qcard-position">{position.index} of {position.total}</p>}
    <h2 ref={headingRef} tabIndex={-1}>{question.prompt}</h2>
    {question.why && <p className="rf-qcard-why"><span>{WHY_LABEL}</span> {question.why}</p>}
    <QuestionControls question={question} draft={draft} onDraft={onDraft} busy={busy} textLimit={textLimit} />
    {error && <p className="rf-auth-error" role="alert">{error}</p>}
    {onSubmit && <div className="rf-qcard-actions">
      <div className="rf-qcard-secondary">
        <Button variant="ghost" disabled={busy} onClick={() => onSubmit({ disposition: 'skip' })}>{SKIP}</Button>
        <Button variant="ghost" disabled={busy} onClick={() => onSubmit({ disposition: 'defer' })}>{LATER}</Button>
        {question.allow_uncertain && <Button variant="ghost" disabled={busy} onClick={() => onSubmit({ disposition: 'unknown' })}>{NOT_SURE}</Button>}
      </div>
      <Button className="rf-qcard-save" disabled={busy || payload === null} onClick={() => payload && onSubmit({ disposition: 'answer', payload })}>
        {busy ? 'Saving…' : <>{SAVE_ANSWER} <Check /></>}
      </Button>
    </div>}
  </section>;
}

export const NOT_SAVED = 'We couldn’t save that yet — try again';
export const TRY_AGAIN = 'Try again';
/** Fix round 2 (N2): the answer was refused under its own key, so retrying it cannot help. */
export const ANSWER_AGAIN = 'We couldn’t save that — please answer again';

/** Above the ordinary card when the last answer was refused: answer again (a new answer). */
export function AnswerAgainNotice({ detail }: { detail?: string | null }) {
  return <div className="rf-qcard-notice rf-qcard-answer-again" role="alert">
    <strong>{ANSWER_AGAIN}</strong>
    {detail && <p>{detail}</p>}
  </div>;
}

type PendingProps = {
  question: CardQuestion;
  /** Why it was not applied, when the backend said (a failed application). */
  detail?: string | null;
  position?: { index: number; total: number } | null;
  busy?: boolean;
  error?: string | null;
  onRetry: () => void;
};

/** A question whose answer is saved but not applied yet: the retry re-sends that answer. */
export function PendingAnswerCard({ question, detail, position, busy = false, error, onRetry }: PendingProps) {
  return <section className="rf-qcard rf-qcard-pending" aria-busy={busy || undefined}>
    {position && <p className="rf-qcard-position">{position.index} of {position.total}</p>}
    <h2 tabIndex={-1}>{question.prompt}</h2>
    <div className="rf-qcard-notice" role="alert">
      <strong>{NOT_SAVED}</strong>
      {detail && <p>{detail}</p>}
      <p>Your answer is kept. Trying again saves it once.</p>
    </div>
    {error && <p className="rf-auth-error" role="alert">{error}</p>}
    <div className="rf-qcard-actions">
      <Button className="rf-qcard-save" disabled={busy} onClick={onRetry}>{busy ? 'Saving…' : <><RotateCw /> {TRY_AGAIN}</>}</Button>
    </div>
  </section>;
}

export default QuestionCard;
