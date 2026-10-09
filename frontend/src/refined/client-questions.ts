// The client app's side of the question store (Cycle 5 P6.5/P6.6; spec 4-5).
//
// - `usesQuestionStore`: the ONE switch for every new-engine question screen.
//   Under M1 (or when the engine could not be read, or in the demo) the M1
//   screens render exactly as before.
// - Reads and writes go through the same-origin BFF (`/api/client/questions/**`,
//   `/api/client/onboarding/state`); the client is the session's own.
// - An answer carries an intent key minted HERE, in the browser, and a retry of
//   the same answer reuses it (`answerIntent`), so a lost reply never records a
//   second answer (A08).
// - An answer that is saved but not applied yet (`pending_answer`, P6.8 I-3)
//   keeps its question open: the screen says "We couldn't save that yet — try
//   again", and the retry re-sends the SAME key and payload (`retryIntent`).

import type { CardQuestion, CardSubmission } from '@/components/questions/QuestionCard';

export type KnowledgeEngineName = 'ke' | 'm1';

/** Whether the new engine's question screens render: rehaul engine only, never the demo. */
export function usesQuestionStore(isDemo: boolean, engine: KnowledgeEngineName | null | undefined): boolean {
  return !isDemo && engine === 'ke';
}

export type PendingAnswer = {
  id: string;
  idempotency_key: string;
  disposition: CardSubmission['disposition'];
  payload: Record<string, unknown>;
  application_state: 'pending' | 'failed';
  what_changed: string;
};

export type ClientQuestion = CardQuestion & {
  packet_id: string | null;
  origin: string;
  status: string;
  evidence_refs: Array<Record<string, unknown>>;
  created_at: string;
  /** An answer saved but not applied yet (I-3): retry it with the same key. */
  pending_answer?: PendingAnswer | null;
};


export type ClientAnswer = {
  id: string;
  question_id: string;
  disposition: CardSubmission['disposition'];
  application_state: 'pending' | 'applied' | 'no_change' | 'failed';
  what_changed: string;
  question_status: string;
  replayed: boolean;
};

export type OnboardingStateName = 'preparing' | 'generating' | 'failed' | 'ready' | 'complete';
export type OnboardingState = { state: OnboardingStateName; packet_id: string | null; total: number; remaining: number };

/** A failed BFF call: the status (0 when no answer arrived) and a sentence to show. */
export class QuestionsRequestError extends Error {
  constructor(message: string, readonly status: number, readonly detail?: unknown) {
    super(message);
    this.name = 'QuestionsRequestError';
  }
}

async function request<T>(path: string, init: RequestInit = {}, fallback = 'That did not work. Try again.'): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, { cache: 'no-store', ...init, headers: { Accept: 'application/json', ...(init.headers ?? {}) } });
  } catch {
    throw new QuestionsRequestError(fallback, 0);
  }
  const body = await response.json().catch(() => ({})) as T & { error?: unknown; detail?: unknown };
  if (!response.ok) {
    throw new QuestionsRequestError(typeof body.error === 'string' && body.error ? body.error : fallback, response.status, body.detail);
  }
  return body;
}

/** Where questions are shown: Train Your AI -> Questions, onboarding, or one source's popup (P7.2). */
export type QuestionSurface = 'questions' | 'onboarding' | `source:${string}`;

export async function loadQuestions(surface: QuestionSurface): Promise<ClientQuestion[]> {
  const body = await request<{ questions?: ClientQuestion[] }>(`/api/client/questions?surface=${encodeURIComponent(surface)}`, {}, 'Could not load your questions.');
  return Array.isArray(body.questions) ? body.questions : [];
}

export function loadOnboardingState(): Promise<OnboardingState> {
  return request<OnboardingState>('/api/client/onboarding/state', {}, 'Could not load your setup.');
}

export type AnswerIntent = { questionId: string; digest: string; key: string; body: CardSubmission };

const digestOf = (questionId: string, submission: CardSubmission) =>
  JSON.stringify([questionId, submission.disposition, submission.payload ?? {}]);

/** The intent for this answer: the previous one when it is the same answer (a retry), else a new key. */
export function answerIntent(previous: AnswerIntent | null, questionId: string, submission: CardSubmission,
  mint: () => string = () => crypto.randomUUID()): AnswerIntent {
  const digest = digestOf(questionId, submission);
  if (previous && previous.questionId === questionId && previous.digest === digest) return previous;
  return { questionId, digest, key: mint(), body: submission };
}

export function postAnswer(intent: AnswerIntent): Promise<ClientAnswer> {
  return request<ClientAnswer>(`/api/client/questions/${encodeURIComponent(intent.questionId)}/answers`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ idempotency_key: intent.key, disposition: intent.body.disposition, ...(intent.body.payload ? { payload: intent.body.payload } : {}) }),
  }, 'Your answer was not saved. Try again.');
}

/** Whether an answer is applied (or honestly changed nothing): only then is its question answered (I-3). */
export function isSettled(answer: Pick<ClientAnswer, 'application_state'>): boolean {
  return answer.application_state === 'applied' || answer.application_state === 'no_change';
}

/** The retry of a question's unapplied answer: its own key and payload, never a new key.
 *  Only a `pending` answer is retried; a `failed` one was refused under its key (N2). */
export function retryIntent(question: ClientQuestion): AnswerIntent | null {
  const pending = question.pending_answer;
  if (!pending || pending.application_state !== 'pending') return null;
  const body: CardSubmission = Object.keys(pending.payload ?? {}).length
    ? { disposition: pending.disposition, payload: pending.payload }
    : { disposition: pending.disposition };
  return { questionId: question.id, digest: digestOf(question.id, body), key: pending.idempotency_key, body };
}

/** What an answer changed, from committed effects only (P6.3). */
export function readAnswer(answerId: string): Promise<ClientAnswer> {
  return request<ClientAnswer>(`/api/client/questions/answers/${encodeURIComponent(answerId)}`, {}, 'Could not read what changed.');
}

/** "3 of 7": the first open question's place in the packet. */
export function packetPosition(state: Pick<OnboardingState, 'total' | 'remaining'>): { index: number; total: number } | null {
  if (state.total <= 0 || state.remaining <= 0) return null;
  return { index: state.total - state.remaining + 1, total: state.total };
}
