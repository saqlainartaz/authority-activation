import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { DnaOut, DnaProfile, DnaSectionId } from '@/lib/product';
import { dnaViewFor } from '@/refined/BusinessDna';
import { DnaInventoryView, type DnaViewProps, type VoiceSample } from '@/refined/DnaInventory';
import { STILL_BUILDING, VOICE_NOT_SET } from '@/refined/dna';
import { SAMPLE_LABEL } from '@/refined/voice';

/**
 * Cycle 5 P9.4 (spec 3.1-3.2; A01-A03, A35): the Business DNA inventory, rendered.
 * - Each empty state word for word; the still-building state with the files' real status
 *   and its two actions; nothing invented (no score, percentage or gauge).
 * - The selector only with two or more profiles; the selection state when none is chosen.
 * - A plan, a report and an interpretation are labelled; the correction form opens inside
 *   its own section only.
 * - Voice: "Voice not set" with a way to the voice card; with guidance, a button and no
 *   sample until asked; a sample is labelled as generated writing.
 * - Under M1 (or the demo, or an unknown engine) the questionnaire view is chosen.
 */

const text = (html: string) => html.replace(/<!-- -->/g, '').replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'")
  .replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
const noop = () => undefined;

const ACCOUNT: DnaProfile = { id: 'account', name: 'Acme Physio', kind: 'account' };
const ACME: DnaProfile = { id: '11111111-1111-4111-8111-111111111111', name: 'Acme Physio', kind: 'organization' };
const ANN: DnaProfile = { id: '22222222-2222-4222-8222-222222222222', name: 'Ann Lee', kind: 'person' };
const IDS: DnaSectionId[] = ['identity', 'audience', 'offers', 'positioning', 'proof', 'voice'];

const item = (statement: string, extra: Record<string, unknown> = {}) => ({
  knowledge_id: `k-${statement}`, meaning_id: 'x', statement, modality: 'asserted', reported_by: null, interpretation: false, ...extra,
});

function dna(profile: DnaProfile, filled: Partial<Record<DnaSectionId, ReturnType<typeof item>[]>> = {}, extra: Partial<DnaOut> = {}): DnaOut {
  const sections = IDS.map(id => ({ id, items: filled[id] ?? [] }));
  return { profile, sections, relationships: [], empty: sections.every(section => !section.items.length), ...extra };
}

function render(overrides: Partial<DnaViewProps> = {}) {
  const props: DnaViewProps = {
    page: { kind: 'open', profiles: [ACCOUNT], dna: dna(ACCOUNT), processing: 'Your files: 1 Processing.' },
    embedded: true, expanded: new Set(), correcting: null, voice: { kind: 'not-set' },
    onSelect: noop, onToggle: noop, onCorrect: noop, onAddFiles: noop, onSetVoice: noop, onSample: noop, onRetry: noop,
    correction: id => createElement('div', { className: 'test-correction' }, `form:${id}`),
    ...overrides,
  };
  return renderToStaticMarkup(createElement(DnaInventoryView, props));
}

function section(html: string, id: DnaSectionId): string {
  const start = html.indexOf(`data-section="${id}"`);
  expect(start).toBeGreaterThan(-1);
  const next = IDS.slice(IDS.indexOf(id) + 1).map(other => html.indexOf(`data-section="${other}"`)).find(at => at > -1);
  return text(html.slice(start, next ?? undefined));
}

describe('an empty profile (spec 3.2, A03)', () => {
  const html = render();

  it('says it is still being built, with the files’ real status and both actions', () => {
    expect(text(html)).toContain(`${STILL_BUILDING} Your files: 1 Processing. Add files Tell us about your business`);
  });

  it('shows each section’s empty state word for word', () => {
    expect(section(html, 'identity')).toContain('Acme Physio Your account No description added yet.');
    expect(section(html, 'audience')).toContain('Audience details not added yet');
    expect(section(html, 'positioning')).toContain('Tell us what makes your approach different.');
    expect(section(html, 'proof')).toContain('No examples added yet');
    expect(section(html, 'voice')).toContain(`${VOICE_NOT_SET} Set up your voice`);
  });

  it('fills nothing in: no score, percentage or gauge', () => {
    expect(text(html)).not.toMatch(/%|score|complete/i);
    expect(html).not.toContain('role="progressbar"');
    expect(html).not.toContain('<select');
  });

  it('leaves out the status line when the files could not be read', () => {
    const page: DnaViewProps['page'] = { kind: 'open', profiles: [ACCOUNT], dna: dna(ACCOUNT), processing: null };
    expect(text(render({ page }))).toContain(`${STILL_BUILDING} Add files`);
  });
});

describe('a filled profile', () => {
  const filled = dna(ANN, {
    audience: [item('Runners in Leeds.')],
    positioning: [item('A second clinic next year.', { modality: 'planned' })],
    proof: [item('Pain halved.', { modality: 'reported', reported_by: 'A patient' }), item('Patience is the method.', { interpretation: true }),
      item('Ran a marathon.'), item('Coached 200 runners.')],
  }, { relationships: [{ profile: ACME, relation: 'founder of', direction: 'outgoing' }] });
  const page: DnaViewProps['page'] = { kind: 'open', profiles: [ANN], dna: filled, processing: null };

  it('shows what is known with plans, reports and interpretations labelled, and no still-building state', () => {
    const html = render({ page });
    expect(text(html)).not.toContain(STILL_BUILDING);
    expect(section(html, 'audience')).toContain('Runners in Leeds.');
    expect(section(html, 'positioning')).toContain('A second clinic next year. Plan');
    expect(section(html, 'proof')).toContain('Pain halved. Reported by A patient');
    expect(section(html, 'identity')).toContain('Ann Lee Person Ann Lee founder of Acme Physio');
    expect(section(html, 'offers')).toContain('No offers added yet. Tell us about one.');
  });

  it('is compact until expanded in place', () => {
    expect(section(render({ page }), 'proof')).toContain('Show all 4');
    expect(section(render({ page }), 'proof')).not.toContain('Coached 200 runners.');
    const open = section(render({ page, expanded: new Set(['proof']) }), 'proof');
    expect(open).toContain('Coached 200 runners.');
    expect(open).toContain('Show fewer');
    expect(section(render({ page }), 'proof')).toContain('Patience is the method. Interpretation');
  });

  it('opens the correction form inside the section it came from, and nowhere else', () => {
    const html = render({ page, correcting: 'audience' });
    expect(section(html, 'audience')).toContain('form:audience');
    expect(html.match(/test-correction/g)).toHaveLength(1);
  });
});

describe('the selector (A01, A02)', () => {
  it('is not shown with one profile', () => {
    expect(render({ page: { kind: 'open', profiles: [ACME], dna: dna(ACME), processing: null } })).not.toContain('<select');
  });

  it('is shown with two, set to the open profile', () => {
    const html = render({ page: { kind: 'open', profiles: [ACME, ANN], dna: dna(ANN), processing: null } });
    expect(html).toContain('aria-label="Business"');
    expect(html).toMatch(new RegExp(`<option value="${ANN.id}" selected="">Ann Lee</option>`));
  });

  it('asks which business to view when none is chosen (a revoked selection lands here)', () => {
    const html = render({ page: { kind: 'choose', profiles: [ACME, ANN] } });
    expect(text(html)).toContain('Choose which business to view Business Choose… Acme Physio Ann Lee');
    expect(html).not.toContain('data-section=');
  });
});

describe('the voice sample', () => {
  const page: DnaViewProps['page'] = { kind: 'open', profiles: [ACCOUNT], dna: dna(ACCOUNT, { audience: [item('Runners.')] }), processing: null };
  const voice = (state: VoiceSample) => section(render({ page, voice: state }), 'voice');

  it('offers a sample but shows none until the client asks', () => {
    const ready = voice({ kind: 'ready' });
    expect(ready).toContain('Show a sample');
    expect(ready).not.toContain(SAMPLE_LABEL);
  });

  it('labels a sample as generated writing, not evidence', () => {
    expect(voice({ kind: 'shown', sample: 'Hello from Acme.' })).toContain(
      `${SAMPLE_LABEL} Hello from Acme. This is generated writing to show your voice. It is not information about your business.`);
  });

  it('says why a sample failed', () => {
    expect(voice({ kind: 'failed', message: 'Your daily writing limit is reached.' })).toContain('Your daily writing limit is reached.');
  });
});

describe('which view renders', () => {
  it('the inventory only on the new engine; the M1 questionnaire otherwise', () => {
    expect(dnaViewFor(false, 'ke')).toBe('inventory');
    expect(dnaViewFor(false, 'm1')).toBe('questionnaire');
    expect(dnaViewFor(false, null)).toBe('questionnaire');
    expect(dnaViewFor(true, 'ke')).toBe('questionnaire');
  });

  it('an error offers Try again rather than an empty page', () => {
    expect(text(render({ page: { kind: 'error', message: 'Business DNA could not be loaded.' } })))
      .toContain('Business DNA could not be loaded. Try again');
  });
});
