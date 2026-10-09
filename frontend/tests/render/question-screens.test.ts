import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { EMPTY_DRAFT, QuestionCard, WHY_LABEL } from '@/components/questions/QuestionCard';
import KeOnboarding, { COMPLETE_COPY, FAILED_COPY, GENERATING_COPY, KeOnboardingView, PREPARING_COPY } from '@/refined/KeOnboarding';
import { onboardingFor } from '@/refined/Onboarding';
import { EMPTY_QUESTIONS_COPY, QuestionsPanelView, UNAVAILABLE_COPY } from '@/refined/QuestionsPanel';
import { dnaAnswer, dnaCardQuestion, dnaDraft } from '@/refined/BusinessDna';
import { usesQuestionStore, type ClientQuestion, type OnboardingState } from '@/refined/client-questions';

/**
 * Cycle 5 P6.5/P6.6: the new engine's question screens in each state (spec 4.2,
 * 5.2; A05, A35), and M1 left as it was.
 */

const noop = () => {};
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&quot;/g, '"')
  .replace(/&amp;/g, '&').replace(/’/g, "'").replace(/\s+/g, ' ').trim();
const plain = (value: string) => value.replace(/’/g, "'");

const question = (n: number, extra: Partial<ClientQuestion> = {}): ClientQuestion => ({
  id: `q-${n}`, control: 'short', prompt: `Question ${n}?`, why: `Benefit ${n}.`, options: [],
  allow_alternative: false, allow_uncertain: true, packet_id: 'p-1', origin: 'onboarding', status: 'open',
  evidence_refs: [], created_at: '2026-10-08T12:00:00Z', ...extra,
});

describe('Train Your AI -> Questions on the new engine', () => {
  const panel = (props: Partial<Parameters<typeof QuestionsPanelView>[0]>) => text(renderToStaticMarkup(createElement(QuestionsPanelView, {
    phase: 'ready', questions: [], draft: EMPTY_DRAFT, busy: false, error: null, changed: null,
    onRetry: noop, onDraft: noop, onSubmit: noop, ...props,
  })));

  it('with nothing to ask shows "Nothing to clarify right now" (A35)', () => {
    const words = panel({});
    expect(words).toContain(EMPTY_QUESTIONS_COPY);
    expect(words).not.toContain('Retry');
  });

  it('a failed read shows unavailable with Retry, never the empty state (A35)', () => {
    const words = panel({ phase: 'error', error: 'Could not load your questions.' });
    expect(words).toContain(UNAVAILABLE_COPY);
    expect(words).toContain('Retry');
    expect(words).not.toContain(EMPTY_QUESTIONS_COPY);
  });

  it('shows the first open question on the shared card, with its position and why', () => {
    const words = panel({ questions: [question(1, { origin: 'monthly' }), question(2)] });
    expect(words).toContain('1 of 2');
    expect(words).toContain('Question 1?');
    expect(words).toContain(`${WHY_LABEL} Benefit 1.`);
    expect(words).toContain('Not sure');
    expect(words).not.toContain('Question 2?');
  });

  it('after an answer shows what changed, from the answer read back', () => {
    const words = panel({ changed: { prompt: 'Question 1?', text: 'Added for Acme: Acme serves runners.' } });
    expect(words).toContain('What changed Added for Acme: Acme serves runners.');
    expect(words).toContain(EMPTY_QUESTIONS_COPY);
  });
});

describe('onboarding on the new engine', () => {
  const state = (name: OnboardingState['state'], total = 0, remaining = 0): OnboardingState => ({ state: name, packet_id: name === 'preparing' ? null : 'p-1', total, remaining });
  const view = (loaded: { state: OnboardingState; questions: ClientQuestion[] } | null, loadError: string | null = null) =>
    text(renderToStaticMarkup(createElement(KeOnboardingView, {
      loaded, loadError, draft: EMPTY_DRAFT, busy: false, error: null, onDraft: noop, onSubmit: noop, onCheck: noop, onOpen: noop,
    })));

  it('preparing, generating and failed are preparation screens that never open the workspace (A05)', () => {
    for (const [name, copy] of [['preparing', PREPARING_COPY], ['generating', GENERATING_COPY], ['failed', FAILED_COPY]] as const) {
      const words = view({ state: state(name), questions: [] });
      expect(words, name).toContain(plain(copy));
      expect(words, name).toContain('Check again');
      expect(words, name).not.toContain('Open my workspace');
      expect(words, name).not.toContain(plain(COMPLETE_COPY));
    }
  });

  it('ready resumes the packet at its first open question: "3 of 7" and the one-line benefit', () => {
    const words = view({ state: state('ready', 7, 5), questions: [question(3), question(4)] });
    expect(words).toContain('3 of 7');
    expect(words).toContain('Question 3?');
    expect(words).toContain(`${WHY_LABEL} Benefit 3.`);
    for (const label of ['Skip', 'Later', 'Not sure', 'Save answer']) expect(words).toContain(label);
    expect(words).not.toContain('Open my workspace');
  });

  it('complete opens the workspace', () => {
    const words = view({ state: state('complete', 4, 0), questions: [] });
    expect(words).toContain(plain(COMPLETE_COPY));
    expect(words).toContain('Open my workspace');
  });

  it('a failed read offers Retry', () => {
    const words = view(null, 'Could not load your setup.');
    expect(words).toContain('Could not load your setup.');
    expect(words).toContain('Retry');
  });
});

describe('M1 is unchanged', () => {
  it('only the new engine uses the question store; M1, an unknown engine and the demo do not', () => {
    expect(usesQuestionStore(false, 'ke')).toBe(true);
    expect(usesQuestionStore(false, 'm1')).toBe(false);
    expect(usesQuestionStore(false, null)).toBe(false);
    expect(usesQuestionStore(true, 'ke')).toBe(false);
  });

  it('onboarding renders the packet under ke and the M1 questionnaire otherwise', () => {
    expect(onboardingFor(false, 'ke').type).toBe(KeOnboarding);
    for (const [isDemo, engine] of [[false, 'm1'], [false, null], [true, 'ke'], [true, 'm1']] as const) {
      const element = onboardingFor(isDemo, engine);
      expect(element.type, `${isDemo} ${engine}`).not.toBe(KeOnboarding);
      expect((element.type as { name?: string }).name, `${isDemo} ${engine}`).toBe('M1Onboarding');
    }
  });
});

describe('Business DNA through the shared card (new engine)', () => {
  const field = (input_type: 'single' | 'long') => ({
    id: 'audience', label: 'Who you serve', value: '', editable: true, required: true,
    question: { question_id: 'audience', question_version: 'v1', prompt: 'Who?', review_label: 'Audience', input_type, required: true, choices: ['Runners', 'Cyclists'], exclusive_choices: [], max_text_chars: 2_000 },
  }) as unknown as Parameters<typeof dnaCardQuestion>[0];

  it('a single-choice field is a single question with "Something else"; a long field is long text', () => {
    expect(dnaCardQuestion(field('single'))).toMatchObject({ control: 'single', allow_alternative: true, options: [{ id: 'Runners', label: 'Runners' }, { id: 'Cyclists', label: 'Cyclists' }] });
    expect(dnaCardQuestion(field('long'))).toMatchObject({ control: 'long', allow_alternative: false, options: [] });
  });

  it('round-trips the saved answer shape, including "Something else"', () => {
    const single = dnaCardQuestion(field('single'));
    for (const answer of [{ selected: ['Runners'], text: '' }, { selected: ['__other__'], text: 'Swimmers' }, { selected: [], text: '' }]) {
      const draft = dnaDraft(answer.selected[0] === '__other__' ? { selected: [answer.selected[0]], text: answer.text } : answer);
      expect(dnaAnswer(single, draft)).toEqual(answer);
    }
    expect(dnaAnswer(dnaCardQuestion(field('long')), dnaDraft({ selected: [], text: 'Runners in Leeds' }))).toEqual({ selected: [], text: 'Runners in Leeds' });
    const html = renderToStaticMarkup(createElement(QuestionCard, { question: single, draft: dnaDraft({ selected: ['Runners'], text: '' }), onDraft: noop }));
    expect(text(html)).toContain('Something else');
  });
});
