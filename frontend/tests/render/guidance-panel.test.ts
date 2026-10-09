import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { GuidancePanel } from '@/refined/GuidancePanel';
import {
  GENERAL_GUIDANCE_COPY, INITIAL_EDITOR, NO_GUIDANCE_COPY, STALE_GUIDANCE_COPY, guidanceReducer,
  type GuidanceEditor, type SavedGuidance,
} from '@/refined/guidance';

/**
 * Cycle 5 P5.1 (spec 6, D06, A13, A16): Train Your AI -> Guidance, rendered as
 * the client sees it in each state.
 */

const noop = () => {};
const render = (editor: GuidanceEditor, usedInWriting = true) => renderToStaticMarkup(createElement(GuidancePanel, {
  editor, usedInWriting, onDraft: noop, onSave: noop, onClear: noop, onReload: noop, onUseKept: noop,
}));
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
/** The editor's box: its value is what the client is typing or was saved. */
const box = (html: string) => {
  const match = html.match(/<textarea[^>]*aria-label="Writing guidance"[^>]*>([\s\S]*?)<\/textarea>/);
  if (!match) throw new Error('no guidance box');
  return match[1].replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
};
const button = (html: string, label: string) => {
  const match = html.match(new RegExp(`<button([^>]*)>${label}</button>`));
  if (!match) return null;
  return { disabled: /\sdisabled(=""|\s|>|$)/.test(match[1]) };
};

const SAVED: SavedGuidance = { guidelineId: 'g-1', revision: 2, text: '- Short paragraphs\n\n- Plain words' };
const loaded = (saved: SavedGuidance | null) => guidanceReducer(INITIAL_EDITOR, { type: 'loaded', saved });
const typed = (saved: SavedGuidance | null, draft: string) => guidanceReducer(loaded(saved), { type: 'edit', draft });

// The demo's packaged rules: an inferred default that must never appear as saved.
const DEMO_RULES = ['Never name a competitor.', 'Write like I am talking to one person.', 'Always end on a question.'];

describe('Train Your AI -> Guidance', () => {
  it('says nothing is saved yet, offers an empty box and the voice card slot, and shows no default as saved', () => {
    const html = render(loaded(null));
    const words = text(html);
    expect(words).toContain(NO_GUIDANCE_COPY);
    expect(box(html)).toBe('');
    expect(words).toContain('0 / 2,000');
    expect(html).toContain('data-slot="voice-card"');
    expect(button(html, 'Clear')).toBeNull();
    expect(button(html, 'Save guidance')).toEqual({ disabled: true });
    expect(words).not.toMatch(/\bSaved\b/);
    for (const rule of DEMO_RULES) expect(html).not.toContain(rule);
  });

  it('shows saved guidance editable, with its count against 2,000, Save and Clear', () => {
    const html = render(loaded(SAVED));
    const words = text(html);
    expect(box(html)).toBe(SAVED.text);
    expect(words).toContain(`${Array.from(SAVED.text).length} / 2,000`);
    expect(words).toContain('Saved');
    expect(words).not.toContain(NO_GUIDANCE_COPY);
    expect(button(html, 'Clear')).toEqual({ disabled: false });
    // Nothing changed yet, so there is nothing to save.
    expect(button(html, 'Save guidance')).toEqual({ disabled: true });
    expect(button(render(typed(SAVED, `${SAVED.text}\n- One more`)), 'Save guidance')).toEqual({ disabled: false });
  });

  it('accepts exactly 2,000 characters and blocks 2,001 before sending', () => {
    const atLimit = render(typed(SAVED, 'x'.repeat(2000)));
    expect(text(atLimit)).toContain('2,000 / 2,000');
    expect(button(atLimit, 'Save guidance')).toEqual({ disabled: false });
    expect(text(atLimit)).not.toMatch(/over the/);

    const over = render(typed(SAVED, 'x'.repeat(2001)));
    expect(text(over)).toContain('2,001 / 2,000');
    expect(text(over)).toContain('That is 1 character over the 2,000 limit. Shorten it to save.');
    expect(button(over, 'Save guidance')).toEqual({ disabled: true });
    // Nothing was cut: the box still holds every character typed.
    expect(box(over)).toHaveLength(2001);
    expect(over).not.toMatch(/maxlength/i);
  });

  it('says before saving that edge blank space will be removed', () => {
    const html = render(typed(null, '\n  - Plain words  \n'));
    expect(text(html)).toContain('Blank space at the start and end will be removed when you save.');
    expect(text(html)).toContain('13 / 2,000');
    expect(text(render(typed(null, '- Plain words')))).not.toContain('Blank space');
  });

  it('on a stale save, keeps the typed text and asks the client to reload', () => {
    const editor = guidanceReducer(typed(SAVED, '- My newer idea'), { type: 'written', result: { kind: 'stale' } });
    const html = render(editor);
    expect(text(html)).toContain(STALE_GUIDANCE_COPY);
    expect(box(html)).toBe('- My newer idea');
    expect(button(html, 'Reload')).toEqual({ disabled: false });
    expect(button(html, 'Save guidance')).toEqual({ disabled: true });
    expect(button(html, 'Clear')).toEqual({ disabled: true });
  });

  it('after reload, shows the latest and keeps the unsaved text beside it', () => {
    const stale = guidanceReducer(typed(SAVED, '- My newer idea'), { type: 'written', result: { kind: 'stale' } });
    const html = render(guidanceReducer(stale, { type: 'loaded', saved: { guidelineId: 'g-1', revision: 3, text: '- Their change' } }));
    expect(box(html)).toBe('- Their change');
    expect(html).toContain('aria-label="Your unsaved guidance"');
    expect(html).toContain('- My newer idea');
    expect(text(html)).not.toContain(STALE_GUIDANCE_COPY);
  });

  it('says it is the one general guidance used for all writing (D06)', () => {
    expect(GENERAL_GUIDANCE_COPY).toBe('General writing guidance — used for all your writing.');
    for (const editor of [loaded(null), loaded(SAVED)]) {
      expect(text(render(editor))).toContain(GENERAL_GUIDANCE_COPY);
    }
  });

  it('says honestly when the engine serving this client does not read guidance yet', () => {
    expect(text(render(loaded(SAVED), true))).not.toContain('does not read it yet');
    expect(text(render(loaded(SAVED), false))).toContain('The current writing engine does not read it yet.');
  });
});
