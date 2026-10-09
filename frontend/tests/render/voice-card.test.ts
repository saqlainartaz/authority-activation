import { createElement, isValidElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { GuidancePanel, voiceCardFor } from '@/refined/GuidancePanel';
import VoiceCard, { VoiceCardView } from '@/refined/VoiceCard';
import { INITIAL_EDITOR, STALE_GUIDANCE_COPY, guidanceReducer } from '@/refined/guidance';
import {
  GENERAL_VOICE, SAMPLE_LABEL, SAVED_COPY, STARTING_PROPOSAL_COPY,
  initialCard, voiceReducer, type VoiceAction, type VoiceCard as Card, type VoiceOption, type VoiceVersion,
} from '@/refined/voice';

/**
 * Cycle 5 P5.3 (spec 6; A13, A14, A16): the voice card in each state, and its
 * absence under M1. Show a sample, edit the guidance, Save: Compare, the fact
 * screen with Restore and a voice's own guidance were removed as
 * over-engineered, 2026-10-08, with their tests.
 */

const noop = () => {};
const PERSON: VoiceOption = { key: 'personal:a', label: 'Ada Lovelace (as yourself)', perspective: { mode: 'personal', authorId: 'a' } };
const OPTIONS = [GENERAL_VOICE, PERSON];
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
const button = (html: string, label: string) => {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = html.match(new RegExp(`<button([^>]*)>${escaped}</button>`));
  return match ? { disabled: /\sdisabled(=""|\s|>|$)/.test(match[1]) } : null;
};
const render = (card: Card) => renderToStaticMarkup(createElement(VoiceCardView, {
  card, options: OPTIONS,
  onChoose: noop, onStyle: noop, onGenerate: noop, onRetry: noop, onUse: noop, onAdjustOpen: noop, onAdjustText: noop,
  onAdjustSend: noop, onAdjustCancel: noop, onEditGuidance: noop, onSave: noop, onReload: noop, onReset: noop,
}));

const version = (n: number, extra: Partial<VoiceVersion> = {}): VoiceVersion => ({
  previewId: `p-${n}`, sample: `Sample number ${n}`, proposedGuidance: `- Guidance ${n}`, startingProposal: false, ...extra,
});
const run = (...actions: VoiceAction[]) => actions.reduce(voiceReducer, initialCard());
const previewed = (v: VoiceVersion, kind: 'generate' | 'adjust' = 'generate', base: VoiceVersion | null = null) => [
  { type: 'request', pending: { previewId: v.previewId, kind, instruction: kind === 'adjust' ? 'warmer' : null, base } },
  { type: 'preview', version: v, approaching: null },
] as VoiceAction[];

describe('the voice card', () => {
  it('starts with a voice picker, an optional example box and Generate; nothing to save yet', () => {
    const html = render(initialCard());
    const words = text(html);
    expect(html).toContain('aria-label="Voice"');
    expect(words).toContain('General (all your writing)');
    expect(words).toContain('Ada Lovelace (as yourself)');
    expect(html).toContain('aria-label="Your example or style (optional)"');
    expect(button(html, 'Generate a sample')).toEqual({ disabled: false });
    expect(html).not.toContain('Guidance to save');
    expect(words).toContain('Nothing is saved until you press Save');
  });

  it('labels the sample as generated and not saved, and a starting proposal as such (A13)', () => {
    const html = render(run(...previewed(version(1, { startingProposal: true }))));
    const words = text(html);
    expect(words).toContain(SAMPLE_LABEL);
    expect(words).toContain(STARTING_PROPOSAL_COPY);
    expect(words).toContain('Sample number 1');
    for (const label of ['Use this voice', 'Adjust', 'Start again']) expect(button(html, label)).toEqual({ disabled: false });
    // Compare and the fact screen were removed (2026-10-08).
    expect(button(html, 'Compare another version')).toBeNull();
    expect(html).not.toContain('Restore');
    expect(html).not.toContain('Guidance to save');
    expect(button(html, 'Save')).toBeNull();
  });

  it('Use this voice shows the guidance that will be saved, editable, with Save', () => {
    const html = render(run(...previewed(version(1)), { type: 'use', version: version(1) }));
    expect(text(html)).toContain('Guidance that will be saved for all your writing');
    expect(html).toMatch(/<textarea[^>]*aria-label="Guidance to save"[^>]*>- Guidance 1<\/textarea>/);
    expect(button(html, 'Save')).toEqual({ disabled: false });
    expect(button(html, 'Use this voice')).toBeNull();
  });

  it('an adjusted version shows its revised guidance before any save (A14)', () => {
    const html = render(run(...previewed(version(1)), ...previewed(version(2), 'adjust', version(1))));
    expect(text(html)).toContain('Sample number 2');
    expect(html).toMatch(/aria-label="Guidance to save"[^>]*>- Guidance 2</);
  });

  it('shows the named limit and offers Try again under the same generation', () => {
    const card = run(
      { type: 'request', pending: { previewId: 'p-1', kind: 'generate', instruction: null, base: null } },
      { type: 'refused', message: "Today's writing limit is reached. It resets at 00:00 UTC.", retry: 'same' },
    );
    const html = render(card);
    expect(html).toContain('role="alert"');
    expect(text(html)).toContain("Today's writing limit is reached. It resets at 00:00 UTC.");
    expect(button(html, 'Try again')).toEqual({ disabled: false });
  });

  it('a stale save shows the P5.1 prompt with Reload and blocks Save; the text stays', () => {
    const html = render(run(...previewed(version(1)), { type: 'use', version: version(1) }, { type: 'saving' }, { type: 'saved', result: { kind: 'stale' } }));
    expect(text(html)).toContain(STALE_GUIDANCE_COPY);
    expect(button(html, 'Reload')).toEqual({ disabled: false });
    expect(button(html, 'Save')).toEqual({ disabled: true });
    expect(html).toContain('- Guidance 1');
  });

  it('after Save, in any voice, says all writing will use the one general guidance', () => {
    const saved = { kind: 'saved' as const, saved: { guidelineId: 'g', revision: 1, text: '- Guidance 1' } };
    const general = render(run(...previewed(version(1)), { type: 'use', version: version(1) }, { type: 'saving' }, { type: 'saved', result: saved }));
    expect(text(general)).toContain(SAVED_COPY);

    const person = [{ type: 'choose', voice: PERSON }] as VoiceAction[];
    const html = render(run(...person, ...previewed(version(1)), { type: 'use', version: version(1) }));
    expect(text(html)).toContain('Guidance that will be saved for all your writing');
    expect(text(html)).toContain('Saving replaces your general writing guidance above.');
    expect(text(html)).not.toContain('instead of your general guidance');
  });

  it('over 2,000 characters blocks Save and says by how much', () => {
    const html = render(run(...previewed(version(1)), { type: 'use', version: version(1) }, { type: 'edit-guidance', text: 'x'.repeat(2_001) }));
    expect(text(html)).toContain('That is 1 character over the 2,000 limit.');
    expect(button(html, 'Save')).toEqual({ disabled: true });
  });
});

describe('where the card lives', () => {
  const panel = (voiceCard: ReturnType<typeof voiceCardFor>) => renderToStaticMarkup(createElement(GuidancePanel, {
    editor: guidanceReducer(INITIAL_EDITOR, { type: 'loaded', saved: null }), usedInWriting: true,
    onDraft: noop, onSave: noop, onClear: noop, onReload: noop, onUseKept: noop, voiceCard,
  }));

  it('under ke, the Guidance slot holds the voice card', () => {
    const card = voiceCardFor('ke');
    expect(isValidElement(card) && card.type === VoiceCard).toBe(true);
    // Rendered with a stand-in so the slot is shown without a data provider.
    const html = panel(createElement('div', { className: 'rf-voice-card' }, 'card'));
    expect(html).toMatch(/data-slot="voice-card"><div class="rf-voice-card">card<\/div><\/div>/);
  });

  it('under M1 (and before the engine is known) there is no card', () => {
    expect(voiceCardFor('m1')).toBeNull();
    expect(voiceCardFor(null)).toBeNull();
    expect(panel(voiceCardFor('m1'))).toContain('data-slot="voice-card"></div>');
  });
});
