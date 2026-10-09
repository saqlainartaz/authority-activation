import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { ANSWER_AGAIN, EMPTY_DRAFT, NOT_SAVED, PendingAnswerCard, TRY_AGAIN } from '@/components/questions/QuestionCard';
import { onboardingReadyView } from '@/app/internal/onboarding-ready';
import { needsPersonLine } from '@/app/internal/system-health-display';
import { ADD_TO_GUIDANCE, ContributionBoxView, SUGGESTED_GUIDANCE } from '@/refined/ContributionBox';
import { KeOnboardingView } from '@/refined/KeOnboarding';
import { QuestionsPanelView } from '@/refined/QuestionsPanel';
import { CONTRIBUTE_TITLE } from '@/refined/client-contributions';
import type { ClientQuestion, PendingAnswer } from '@/refined/client-questions';

/**
 * Cycle 5 P6.8: what the P6 milestone review's fixes show.
 * - I-3: an answer saved but not applied keeps its question, with "We couldn't
 *   save that yet — try again" and one Try again;
 * - I-4: "What would you like us to know?" and its per-part outcome, with
 *   "Add to my guidance" on each proposed line;
 * - I-2: the operator card after the third retry, and System health's new rows;
 * - M-5: onboarding shows what an answer changed.
 */

const noop = () => {};
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&quot;/g, '"')
  .replace(/&amp;/g, '&').replace(/’/g, "'").replace(/\s+/g, ' ').trim();
const plain = (value: string) => value.replace(/’/g, "'");

const pending = (extra: Partial<PendingAnswer> = {}): PendingAnswer => ({
  id: 'a-1', idempotency_key: 'key-1', disposition: 'answer', payload: { text: 'Families in Leeds.' },
  application_state: 'pending', what_changed: "Saved. It hasn't been applied yet.", ...extra,
});

const question = (extra: Partial<ClientQuestion> = {}): ClientQuestion => ({
  id: 'q-1', control: 'long', prompt: 'Who does the business serve?', why: 'So posts reach the right people.',
  options: [], allow_alternative: false, allow_uncertain: true, packet_id: null, origin: 'monthly', status: 'open',
  evidence_refs: [], created_at: '2026-10-08T12:00:00Z', ...extra,
});

describe('an answer that is not applied yet (I-3)', () => {
  const panel = (questions: ClientQuestion[]) => text(renderToStaticMarkup(createElement(QuestionsPanelView, {
    phase: 'ready', questions, draft: EMPTY_DRAFT, busy: false, error: null, changed: null,
    onRetry: noop, onDraft: noop, onSubmit: noop, onRetryAnswer: noop,
  })));

  it('keeps the question with "We couldn\'t save that yet — try again" and Try again, not the answer form', () => {
    const words = panel([question({ pending_answer: pending() })]);
    expect(words).toContain(plain(NOT_SAVED));
    expect(words).toContain(TRY_AGAIN);
    expect(words).toContain('Who does the business serve?');
    expect(words).not.toContain('Save answer');
    expect(words).not.toContain('Nothing to clarify');
  });

  it('a refused answer asks the client to answer again, with the answer form and no Try again (N2)', () => {
    const words = panel([question({ pending_answer: pending({ application_state: 'failed', what_changed: 'Not applied: subject entity not found.' }) })]);
    expect(words).toContain(plain(ANSWER_AGAIN));
    expect(words).toContain('Not applied: subject entity not found.');
    expect(words).toContain('Save answer');
    expect(words).not.toContain(TRY_AGAIN);
    expect(words).not.toContain(plain(NOT_SAVED));
  });

  it('a question with no unapplied answer is the ordinary card', () => {
    const words = panel([question()]);
    expect(words).toContain('Save answer');
    expect(words).not.toContain(plain(NOT_SAVED));
  });

  it('the card on its own offers only the retry', () => {
    const words = text(renderToStaticMarkup(createElement(PendingAnswerCard, { question: question(), onRetry: noop })));
    expect(words).toContain(TRY_AGAIN);
    expect(words).not.toContain('Skip');
  });

  it('onboarding shows the same retry, and what the last answer changed (M-5)', () => {
    const words = text(renderToStaticMarkup(createElement(KeOnboardingView, {
      loaded: { state: { state: 'ready', packet_id: 'p-1', total: 3, remaining: 2 }, questions: [question({ pending_answer: pending() })] },
      loadError: null, draft: EMPTY_DRAFT, busy: false, error: null, onDraft: noop, onSubmit: noop, onCheck: noop, onOpen: noop,
      onRetryAnswer: noop, changed: 'Added for Acme: Acme serves runners.',
    })));
    expect(words).toContain('2 of 3');
    expect(words).toContain(plain(NOT_SAVED));
    expect(words).toContain('What changed Added for Acme: Acme serves runners.');
  });
});

describe('"What would you like us to know?" (I-4)', () => {
  const props = {
    text: '', kind: 'fact' as const, busy: false, error: null, summary: null, proposals: [],
    onText: noop, onKind: noop, onSend: noop, onAdd: noop,
  };
  const box = (extra: Partial<Parameters<typeof ContributionBoxView>[0]>) => text(renderToStaticMarkup(createElement(ContributionBoxView, {
    ...props, ...extra,
  })));

  it('is one text area, a choice of two kinds (about me by default) and Send', () => {
    const html = renderToStaticMarkup(createElement(ContributionBoxView, props));
    expect(text(html)).toContain(CONTRIBUTE_TITLE);
    expect(html.match(/<textarea/g)?.length).toBe(1);
    expect(html.match(/type="radio"/g)?.length).toBe(2);
    expect(text(html)).toContain('Something about me or my business');
    expect(text(html)).toContain('How I want my posts written');
    expect(html).toMatch(/checked="" value="fact"/);
    expect(text(html)).toContain('Send');
    expect(text(html)).not.toContain(SUGGESTED_GUIDANCE);
  });

  it('shows what changed and the proposed line to add; never a question', () => {
    const words = box({
      summary: { facts: ['Added for Acme: We now serve teams.'], proposals: ['Never name Sam.'], pending: null, notes: [] },
      proposals: ['Never name Sam.'],
    });
    expect(words).toContain('What changed Added for Acme: We now serve teams.');
    expect(words).not.toContain('question');
    expect(words).toContain(`${SUGGESTED_GUIDANCE} Never name Sam. ${ADD_TO_GUIDANCE}`);
  });

  it('a message not applied yet says so', () => {
    const words = box({ summary: { facts: [], proposals: [], pending: 'Saved. We couldn’t apply it yet — send it again in a moment.', notes: [] } });
    expect(words).toContain("Saved. We couldn't apply it yet");
  });
});

describe('the operator side (I-2, Ruling 76, M-7)', () => {
  it('a failed packet always offers Try again, with no retry count (the cap was removed 2026-10-08)', () => {
    const view = onboardingReadyView({ state: 'failed', packet_id: 'p-1', total: 0, remaining: 0 });
    expect(view.action).toBe('Try again');
    expect(view.status).not.toMatch(/retr(y|ies) left|support/i);
  });

  it('a client onboarded with the earlier questionnaire is told so, and can be started on the new questions', () => {
    const view = onboardingReadyView({ state: 'complete', packet_id: null, total: 0, remaining: 0 });
    expect(view.status).toContain('earlier questionnaire');
    expect(view.action).toBe('Ready to onboard');
  });

  it('System health words the new rows', () => {
    const row = (item_kind: string, action_class: string, reason_class: string, fn = 'operator') => needsPersonLine({
      issue_id: 'i', client_id: 'c', item_kind, item_id: '12345678-aaaa', document_id: null, function: fn,
      action_class, reason_class, opened_at: '2026-10-08T12:00:00Z', age_seconds: 60,
    });
    expect(row('onboarding_packet', 'retry_onboarding_packet', 'onboarding_packet_failed').action).toBe('Onboarding packet failed — retry');
    expect(row('source_lifecycle_request', 'review_source_switch', 'source_switch_not_applied').reason)
      .toBe("Source switch couldn't be applied");
    const stuckDelete = row('source_lifecycle_request', 'restart_source_delete', 'source_delete_not_finished');
    expect(stuckDelete.reason).toBe('File delete stopped before it finished');
    expect(stuckDelete.action).toBe('File delete stopped — retry');
    expect(stuckDelete.detail.section).toBe('sources');
    expect(stuckDelete.item).toBe('Source request 12345678');
    expect(row('question_answer', 'apply_client_answer', 'answer_not_applied', 'support').item).toContain('Client answer');
  });
});
