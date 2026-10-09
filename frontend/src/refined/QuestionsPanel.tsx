// Train Your AI -> Questions on the new engine (Cycle 5 P6.6; spec 5.1-5.2; A08, A35).
//
// Reads the real question store (`surface=questions`), one shared card at a
// time. An answer is saved with a browser intent key that a retry reuses; once
// saved, "what changed" is read back from the answer (`GET .../answers/{id}`,
// committed effects only). Nothing to ask is "Nothing to clarify right now"; a
// failed read is "Questions unavailable" with Retry, never the empty state.
// An answer saved but not applied keeps its question here (P6.8, I-3) with
// "We couldn't save that yet — try again"; Try again re-sends it under its key.
// Under M1 this panel is not rendered: the atom review stays.
//
// The same panel answers a source's own question inline in its Knowledge popup
// (P7.2, `surface=source:{id}`), `quiet`: it shows only when there is a question
// to answer or something just changed, so the popup asks only when needed, and
// a failed read is one line with Retry rather than a card.

import { useCallback, useEffect, useRef, useState } from 'react';
import { RotateCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  AnswerAgainNotice, EMPTY_DRAFT, PendingAnswerCard, QuestionCard, type CardDraft, type CardSubmission,
} from '@/components/questions/QuestionCard';
import { useNavigate } from './navigation';
import {
  answerIntent, isSettled, loadQuestions, postAnswer, QuestionsRequestError, readAnswer, retryIntent,
  type AnswerIntent, type ClientQuestion, type QuestionSurface,
} from './client-questions';

export const EMPTY_QUESTIONS_COPY = 'Nothing to clarify right now';
export const UNAVAILABLE_COPY = 'Questions unavailable';

export type QuestionsPhase = 'loading' | 'error' | 'ready';
export type WhatChanged = { prompt: string; text: string };

type ViewProps = {
  phase: QuestionsPhase;
  questions: ClientQuestion[];
  draft: CardDraft;
  busy: boolean;
  error: string | null;
  changed: WhatChanged | null;
  onRetry: () => void;
  onDraft: (draft: CardDraft) => void;
  onSubmit: (submission: CardSubmission) => void;
  onRetryAnswer?: () => void;
  /** Inline in a source's popup (P7.2): nothing while loading or with nothing to ask. */
  quiet?: boolean;
  /** Shown above the card when there is a question (quiet only). */
  title?: string;
};

export const SOURCE_QUESTIONS_UNAVAILABLE = 'We couldn\u2019t check for questions about this file.';

export function QuestionsPanelView({ phase, questions, draft, busy, error, changed, onRetry, onDraft, onSubmit, onRetryAnswer, quiet = false, title }: ViewProps) {
  const question = questions[0];
  if (quiet) {
    if (phase === 'loading' || (phase === 'ready' && !question && !changed)) return null;
    if (phase === 'error') {
      return <p className="rf-source-question-error" role="status">{SOURCE_QUESTIONS_UNAVAILABLE}<Button variant="link" size="sm" onClick={onRetry}>Retry</Button></p>;
    }
  }
  return <div className={quiet ? 'rf-questions-store rf-questions-inline' : 'rf-questions-store'}>
    {quiet && title && question && <h3 className="rf-questions-inline-title">{title}</h3>}
    {changed && <div className="rf-qcard-changed" role="status"><strong>What changed</strong><p>{changed.text}</p></div>}
    {phase === 'loading' ? <Card className="rf-qcard-state"><CardContent><h3>Loading questions…</h3></CardContent></Card>
      : phase === 'error' ? <Card className="rf-qcard-state"><CardContent><h3>{UNAVAILABLE_COPY}</h3><p>We could not load your questions. Nothing is lost.</p>{error && <p className="rf-auth-error" role="alert">{error}</p>}<Button variant="outline" onClick={onRetry}><RotateCw /> Retry</Button></CardContent></Card>
      : question?.pending_answer?.application_state === 'pending' ? <PendingAnswerCard key={question.id} question={question}
        busy={busy} error={error} position={{ index: 1, total: questions.length }} onRetry={() => onRetryAnswer?.()} />
      : question ? <>
        {question.pending_answer?.application_state === 'failed' && <AnswerAgainNotice detail={question.pending_answer.what_changed} />}
        <QuestionCard key={question.id} question={question} draft={draft} onDraft={onDraft} busy={busy} error={error}
          position={{ index: 1, total: questions.length }} onSubmit={onSubmit} />
      </>
      : quiet ? null
      : <Card className="rf-qcard-state"><CardContent><h3>{EMPTY_QUESTIONS_COPY}</h3><p>New questions appear here when your material leaves something unclear.</p></CardContent></Card>}
  </div>;
}

/** `refresh`: bump it to read the list again (a contribution just asked a question, P6.8).
 *  `surface`, `quiet` and `title`: a source's popup (P7.2). */
export default function QuestionsPanel({ onCount, refresh = 0, surface = 'questions', quiet = false, title }: {
  onCount?: (count: number) => void; refresh?: number; surface?: QuestionSurface; quiet?: boolean; title?: string;
}) {
  const navigate = useNavigate();
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;
  const [phase, setPhase] = useState<QuestionsPhase>('loading');
  const [questions, setQuestions] = useState<ClientQuestion[]>([]);
  const [draft, setDraft] = useState<CardDraft>(EMPTY_DRAFT);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [changed, setChanged] = useState<WhatChanged | null>(null);
  const [attempt, setAttempt] = useState(0);
  const intent = useRef<AnswerIntent | null>(null);

  useEffect(() => {
    let active = true;
    setPhase('loading');
    setError(null);
    loadQuestions(surface).then(next => {
      if (!active) return;
      setQuestions(next);
      setPhase('ready');
    }).catch(reason => {
      if (!active) return;
      if (reason instanceof QuestionsRequestError && reason.status === 401) { navigateRef.current('/refined/signin', { replace: true }); return; }
      setError(reason instanceof Error ? reason.message : 'Could not load your questions.');
      setPhase('error');
    });
    return () => { active = false; };
  }, [attempt, refresh, surface]);

  useEffect(() => { onCount?.(phase === 'ready' ? questions.length : 0); }, [onCount, phase, questions.length]);

  const send = useCallback(async (question: ClientQuestion, current: AnswerIntent) => {
    intent.current = current;
    setBusy(true);
    setError(null);
    try {
      const saved = await postAnswer(current);
      if (!isSettled(saved)) {
        // Saved but not applied (I-3): the question stays. A pending answer is retried under
        // the same key; a failed one was refused under it, so the next answer is a new one (N2).
        if (saved.application_state === 'failed') intent.current = null;
        setDraft(EMPTY_DRAFT);
        setAttempt(value => value + 1);
        return;
      }
      intent.current = null;
      setQuestions(list => list.filter(candidate => candidate.id !== question.id));
      setDraft(EMPTY_DRAFT);
      // Saved first; what it changed is read back from the answer's committed effects.
      const read = await readAnswer(saved.id).catch(() => saved);
      setChanged({ prompt: question.prompt, text: read.what_changed || saved.what_changed });
    } catch (reason) {
      if (reason instanceof QuestionsRequestError && reason.status === 401) { navigateRef.current('/refined/signin', { replace: true }); return; }
      if (reason instanceof QuestionsRequestError && reason.status === 409) {
        // Answered elsewhere meanwhile (or the key stands for another answer): read the list again.
        intent.current = null;
        setAttempt(value => value + 1);
      }
      setError(reason instanceof Error ? reason.message : 'Your answer was not saved. Try again.');
    } finally {
      setBusy(false);
    }
  }, []);

  const submit = useCallback(async (submission: CardSubmission) => {
    const question = questions[0];
    if (!question || busy) return;
    await send(question, answerIntent(intent.current, question.id, submission));
  }, [busy, questions, send]);

  const retryAnswer = useCallback(async () => {
    const question = questions[0];
    const again = question ? retryIntent(question) : null;
    if (!question || !again || busy) return;
    await send(question, again);
  }, [busy, questions, send]);

  return <QuestionsPanelView phase={phase} questions={questions} draft={draft} busy={busy} error={error} changed={changed}
    onRetry={() => setAttempt(value => value + 1)} onDraft={setDraft} onSubmit={submission => void submit(submission)}
    onRetryAnswer={() => void retryAnswer()} quiet={quiet} title={title} />;
}
