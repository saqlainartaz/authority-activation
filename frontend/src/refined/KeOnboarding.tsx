// Onboarding on the new engine (Cycle 5 P6.5; spec 4.2; A05-A08; D01).
//
// One short packet of questions (at most 7), prepared once the operator marks
// the client Ready to onboard. Kept simple by operator decision: one shared
// card per question, its position ("3 of 7") and its one-line benefit. The
// states are the backend's (`GET /v1/onboarding/state`):
// - preparing / generating: the workspace is being prepared; leave and come back;
// - failed: the questions could not be prepared; never an empty success;
// - ready: the packet, resumed at its first open question;
// - complete: every question answered, skipped, "not sure" or "later" (D01).
// An answer saved but not applied keeps its question (P6.8, I-3): "We couldn't
// save that yet — try again", and Try again re-sends it under its own key. What
// each applied answer changed is shown above the next question (review M-5).
// Under M1 this screen is not rendered: the questionnaire stays (`Onboarding.tsx`).

import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowRight, RotateCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  AnswerAgainNotice, EMPTY_DRAFT, PendingAnswerCard, QuestionCard, type CardDraft, type CardSubmission,
} from '@/components/questions/QuestionCard';
import { EntryBrand } from './Auth';
import { useNavigate } from './navigation';
import {
  answerIntent, isSettled, loadOnboardingState, loadQuestions, packetPosition, postAnswer, QuestionsRequestError,
  retryIntent, type AnswerIntent, type ClientQuestion, type OnboardingState,
} from './client-questions';

export const PREPARING_COPY = 'We’re preparing your workspace';
export const GENERATING_COPY = 'We’re preparing a few questions for you';
export const FAILED_COPY = 'We couldn’t prepare your questions';
export const COMPLETE_COPY = 'You’re good to go.';

type Loaded = { state: OnboardingState; questions: ClientQuestion[] };

type ViewProps = {
  loaded: Loaded | null;
  loadError: string | null;
  draft: CardDraft;
  busy: boolean;
  error: string | null;
  onDraft: (draft: CardDraft) => void;
  onSubmit: (submission: CardSubmission) => void;
  onCheck: () => void;
  onOpen: () => void;
  onRetryAnswer?: () => void;
  /** What the last applied answer changed (M-5). */
  changed?: string | null;
};

function Waiting({ title, body, onCheck }: { title: string; body: string; onCheck: () => void }) {
  return <><h1 tabIndex={-1}>{title}</h1><p className="rf-entry-note">{body}</p>
    <Button variant="outline" className="rf-onboarding-check" onClick={onCheck}><RotateCw /> Check again</Button></>;
}

export function KeOnboardingView({ loaded, loadError, draft, busy, error, onDraft, onSubmit, onCheck, onOpen, onRetryAnswer, changed }: ViewProps) {
  const state = loaded?.state.state;
  const question = loaded?.questions[0];
  const status = !loaded ? (loadError ? 'Setup unavailable' : 'Loading')
    : state === 'complete' ? 'Complete'
    : state === 'ready' ? 'Getting to know your business'
    : 'Preparing';
  return <main className="rf-entry rf-onboarding rf-onboarding-ke">
    <header className="rf-onboarding-header"><EntryBrand /><span>{status}</span></header>
    <div className="rf-onboarding-scroll"><section className="rf-onboarding-body">
      {!loaded ? loadError
        ? <><p className="rf-onboarding-reason">We could not load your setup.</p><p className="rf-auth-error" role="alert">{loadError}</p><Button variant="outline" onClick={onCheck}><RotateCw /> Retry</Button></>
        : <p className="rf-onboarding-reason">Loading your setup…</p>
        : state === 'preparing' ? <Waiting title={PREPARING_COPY} onCheck={onCheck} body="Your account team is getting things ready. You can close this page; nothing is lost, and this screen will have your first questions once they are ready." />
        : state === 'generating' ? <Waiting title={GENERATING_COPY} onCheck={onCheck} body="This usually takes a few minutes, longer while your documents are still being read. You can leave and come back; nothing is lost." />
        : state === 'failed' ? <Waiting title={FAILED_COPY} onCheck={onCheck} body="Something went wrong on our side while preparing them. Nothing is lost. Your account team can start them again; if this page stays like this, please contact them." />
        : state === 'ready' && question ? <>
          <p className="rf-onboarding-reason">A few questions so your writing assistant gets your business right. Answer what you can; you can skip any of them.</p>
          {changed && <div className="rf-qcard-changed" role="status"><strong>What changed</strong><p>{changed}</p></div>}
          {question.pending_answer?.application_state === 'pending'
            ? <PendingAnswerCard key={question.id} question={question} busy={busy} error={error}
              position={packetPosition(loaded.state)} onRetry={() => onRetryAnswer?.()} />
            : <>
              {question.pending_answer?.application_state === 'failed' && <AnswerAgainNotice detail={question.pending_answer.what_changed} />}
              <QuestionCard key={question.id} question={question} draft={draft} onDraft={onDraft} busy={busy} error={error}
                position={packetPosition(loaded.state)} onSubmit={onSubmit} />
            </>}
        </>
        : <><p className="rf-onboarding-reason">Your answers are in.</p><h1 tabIndex={-1}>{COMPLETE_COPY}</h1><p className="rf-entry-note">You can add more knowledge and answer new questions in Train your AI.</p></>}
    </section></div>
    {state === 'complete' && <footer className="rf-onboarding-footer"><div><Button className="rf-onboarding-next" onClick={onOpen}>Open my workspace <ArrowRight /></Button></div></footer>}
  </main>;
}

export default function KeOnboarding() {
  const navigate = useNavigate();
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [draft, setDraft] = useState<CardDraft>(EMPTY_DRAFT);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [changed, setChanged] = useState<string | null>(null);
  const intent = useRef<AnswerIntent | null>(null);

  const read = useCallback(async (): Promise<Loaded> => {
    const state = await loadOnboardingState();
    const questions = state.state === 'ready' ? await loadQuestions('onboarding') : [];
    // A packet that is ready with nothing left open is complete (D01), however the counts raced.
    if (state.state === 'ready' && questions.length === 0) return { state: { ...state, state: 'complete', remaining: 0 }, questions };
    return { state, questions };
  }, []);

  const unauthorized = (reason: unknown) => reason instanceof QuestionsRequestError && reason.status === 401;

  useEffect(() => {
    let active = true;
    setLoadError(null);
    read().then(next => { if (active) setLoaded(next); }).catch(reason => {
      if (!active) return;
      if (unauthorized(reason)) { navigateRef.current('/refined/signin', { replace: true }); return; }
      setLoaded(null);
      setLoadError(reason instanceof Error ? reason.message : 'Could not load your setup.');
    });
    return () => { active = false; };
  }, [attempt, read]);

  // While the questions are being prepared, look again now and then.
  useEffect(() => {
    if (loaded?.state.state !== 'generating') return;
    const timer = window.setTimeout(() => setAttempt(value => value + 1), 8_000);
    return () => window.clearTimeout(timer);
  }, [loaded]);

  async function send(current: AnswerIntent) {
    intent.current = current;
    setBusy(true);
    setError(null);
    try {
      const saved = await postAnswer(current);
      setDraft(EMPTY_DRAFT);
      if (isSettled(saved) || saved.application_state === 'failed') intent.current = null; // N2: a refusal needs a new answer
      if (isSettled(saved)) setChanged(saved.what_changed || null);
      // Not applied yet (I-3): the reload brings the question back with its retry.
      setLoaded(await read());
    } catch (reason) {
      if (unauthorized(reason)) { navigateRef.current('/refined/signin', { replace: true }); return; }
      if (reason instanceof QuestionsRequestError && reason.status === 409) {
        intent.current = null;
        setAttempt(value => value + 1);
      }
      setError(reason instanceof Error ? reason.message : 'Your answer was not saved. Try again.');
    } finally {
      setBusy(false);
    }
  }

  function submit(submission: CardSubmission) {
    const question = loaded?.questions[0];
    if (!question || busy) return;
    void send(answerIntent(intent.current, question.id, submission));
  }

  function retryAnswer() {
    const question = loaded?.questions[0];
    const again = question ? retryIntent(question) : null;
    if (!again || busy) return;
    void send(again);
  }

  return <KeOnboardingView loaded={loaded} loadError={loadError} draft={draft} busy={busy} error={error} changed={changed}
    onRetryAnswer={retryAnswer}
    onDraft={setDraft} onSubmit={submit} onCheck={() => setAttempt(value => value + 1)}
    onOpen={() => navigate('/refined/workspace?welcome=1', { replace: true })} />;
}
