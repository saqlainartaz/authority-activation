import { createElement, isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import {
  EMPTY_DRAFT, LATER, NOT_SURE, QuestionCard, SAVE_ANSWER, SKIP, SOMETHING_ELSE, WHY_LABEL,
  answerPayload, chooseAlternative, chooseOption, type CardDraft, type CardQuestion, type CardSubmission,
} from '@/components/questions/QuestionCard';

/**
 * Cycle 5 P6.6: the one shared question card, one test per control (spec 5.1;
 * A07). Static markup for what shows; the card is hook-free, so its element
 * tree is walked to press its buttons and read what each submits.
 */

const noop = () => {};
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&quot;/g, '"')
  .replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

const SINGLE: CardQuestion = {
  id: 'q-1', control: 'single', prompt: 'Which price is current?', why: 'So posts quote the price you charge today.',
  options: [{ id: 'a', label: 'USD 49 a month' }, { id: 'b', label: 'USD 59 a month' }],
  allow_alternative: false, allow_uncertain: false,
};
const MULTIPLE: CardQuestion = { ...SINGLE, id: 'q-2', control: 'multiple', prompt: 'Who do you work with?', options: [{ id: 'r', label: 'Runners' }, { id: 'c', label: 'Cyclists' }] };
const SHORT: CardQuestion = { ...SINGLE, id: 'q-3', control: 'short', prompt: 'Where are you based?', options: [] };
const LONG: CardQuestion = { ...SINGLE, id: 'q-4', control: 'long', prompt: 'What do you offer?', options: [] };

const render = (question: CardQuestion, draft: CardDraft = EMPTY_DRAFT, extra: Record<string, unknown> = {}) =>
  renderToStaticMarkup(createElement(QuestionCard, { question, draft, onDraft: noop, onSubmit: noop, ...extra }));

function nodeText(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(nodeText).join('');
  if (isValidElement(node)) return nodeText((node.props as { children?: ReactNode }).children);
  return '';
}

/** Every element in the tree the card returns (its own children, not its components' output). */
function elements(node: ReactNode, out: ReactElement[] = []): ReactElement[] {
  if (Array.isArray(node)) node.forEach(child => elements(child, out));
  else if (isValidElement(node)) {
    out.push(node);
    elements((node.props as { children?: ReactNode }).children, out);
  }
  return out;
}

function press(question: CardQuestion, draft: CardDraft, label: string): CardSubmission | null {
  const onSubmit = vi.fn();
  const tree = QuestionCard({ question, draft, onDraft: noop, onSubmit });
  const button = elements(tree).find(element => (element.props as { onClick?: unknown }).onClick && nodeText(element).trim().startsWith(label));
  if (!button) return null;
  (button.props as { onClick: () => void }).onClick();
  return onSubmit.mock.calls[0]?.[0] ?? null;
}

const disabled = (html: string, label: string) => {
  const match = html.match(new RegExp(`<button([^>]*)>${label}`));
  return match ? /\sdisabled(=""|\s|>|$)/.test(match[1]) : null;
};

describe('the shared question card', () => {
  it('shows the question, its position and the one "Why we\'re asking" sentence', () => {
    const words = text(render(SINGLE, EMPTY_DRAFT, { position: { index: 3, total: 7 } }));
    expect(words).toContain('3 of 7');
    expect(words).toContain('Which price is current?');
    expect(words).toContain(`${WHY_LABEL} So posts quote the price you charge today.`);
  });

  it('single choice: a radio per option, and Save only once one is chosen', () => {
    const html = render(SINGLE);
    expect(html).toContain('role="radiogroup"');
    expect(text(html)).toContain('USD 49 a month');
    expect(text(html)).not.toContain(SOMETHING_ELSE);
    expect(disabled(html, SAVE_ANSWER)).toBe(true);
    const chosen = chooseOption(SINGLE, EMPTY_DRAFT, 'b');
    expect(disabled(render(SINGLE, chosen), SAVE_ANSWER)).toBe(false);
    expect(press(SINGLE, chosen, SAVE_ANSWER)).toEqual({ disposition: 'answer', payload: { option: 'b' } });
  });

  it('multiple choice: a checkbox per option, and every ticked option is sent', () => {
    const html = render(MULTIPLE);
    expect(html).toContain('role="group"');
    expect(html).toContain('role="checkbox"');
    const both = chooseOption(MULTIPLE, chooseOption(MULTIPLE, EMPTY_DRAFT, 'r'), 'c');
    expect(press(MULTIPLE, both, SAVE_ANSWER)).toEqual({ disposition: 'answer', payload: { options: ['r', 'c'] } });
    expect(answerPayload(MULTIPLE, chooseOption(MULTIPLE, both, 'r'))).toEqual({ options: ['c'] });
  });

  it('short text: one line, held to the store\'s 200 characters', () => {
    const html = render(SHORT);
    expect(html).toMatch(/<input[^>]*maxLength="200"/);
    expect(html).not.toContain('<textarea');
    expect(press(SHORT, { ...EMPTY_DRAFT, text: 'Leeds' }, SAVE_ANSWER)).toEqual({ disposition: 'answer', payload: { text: 'Leeds' } });
    expect(answerPayload(SHORT, { ...EMPTY_DRAFT, text: '   ' })).toBeNull();
    expect(answerPayload(SHORT, { ...EMPTY_DRAFT, text: 'x'.repeat(201) })).toBeNull();
  });

  it('long text: a text area, held to 4,000 characters', () => {
    const html = render(LONG);
    expect(html).toMatch(/<textarea[^>]*maxLength="4000"/);
    expect(answerPayload(LONG, { ...EMPTY_DRAFT, text: 'x'.repeat(4_000) })).toEqual({ text: 'x'.repeat(4_000) });
    expect(answerPayload(LONG, { ...EMPTY_DRAFT, text: 'x'.repeat(4_001) })).toBeNull();
  });

  it('"Something else" appears only when allowed, and its own words replace the options', () => {
    const open = { ...SINGLE, allow_alternative: true };
    expect(text(render(open))).toContain(SOMETHING_ELSE);
    const typed = { ...chooseAlternative(chooseOption(open, EMPTY_DRAFT, 'a')), alternativeText: 'USD 65 from November' };
    const html = render(open, typed);
    expect(html).toContain(`aria-label="${SOMETHING_ELSE}: your answer"`);
    expect(press(open, typed, SAVE_ANSWER)).toEqual({ disposition: 'answer', payload: { alternative: 'USD 65 from November' } });
    // On a multiple choice it is one value too: ticking an option clears it, and choosing it clears the options.
    const multiple = { ...MULTIPLE, allow_alternative: true };
    const ticked = chooseOption(multiple, EMPTY_DRAFT, 'r');
    expect(chooseAlternative(ticked)).toMatchObject({ alternative: true, options: [] });
    expect(chooseOption(multiple, chooseAlternative(ticked), 'c')).toMatchObject({ alternative: false, options: ['c'] });
    expect(answerPayload(open, chooseAlternative(EMPTY_DRAFT))).toBeNull(); // nothing typed yet
  });

  it('"Not sure" appears only when allowed, and records the unknown disposition', () => {
    expect(text(render(SINGLE))).not.toContain(NOT_SURE);
    const unsure = { ...SINGLE, allow_uncertain: true };
    expect(text(render(unsure))).toContain(NOT_SURE);
    expect(press(unsure, EMPTY_DRAFT, NOT_SURE)).toEqual({ disposition: 'unknown' });
  });

  it('Skip and Later are always offered and need no answer (nothing is mandatory)', () => {
    for (const question of [SINGLE, MULTIPLE, SHORT, LONG]) {
      const html = render(question);
      expect(disabled(html, SKIP), question.control).toBe(false);
      expect(disabled(html, LATER), question.control).toBe(false);
      expect(press(question, EMPTY_DRAFT, SKIP)).toEqual({ disposition: 'skip' });
      expect(press(question, EMPTY_DRAFT, LATER)).toEqual({ disposition: 'defer' });
    }
  });

  it('as an editor (no submit) it shows its controls and no actions', () => {
    const words = text(renderToStaticMarkup(createElement(QuestionCard, { question: { ...SINGLE, allow_uncertain: true }, draft: EMPTY_DRAFT, onDraft: noop })));
    expect(words).toContain('USD 49 a month');
    for (const label of [SAVE_ANSWER, SKIP, LATER, NOT_SURE]) expect(words).not.toContain(label);
  });

  it('while saving every action is disabled and the error is announced', () => {
    const html = render({ ...SINGLE, allow_uncertain: true }, chooseOption(SINGLE, EMPTY_DRAFT, 'a'), { busy: true, error: 'Your answer was not saved. Try again.' });
    expect(disabled(html, SKIP)).toBe(true);
    expect(disabled(html, NOT_SURE)).toBe(true);
    expect(html).toContain('role="alert"');
    expect(text(html)).toContain('Saving…');
  });
});
