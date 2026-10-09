import { describe, expect, it } from 'vitest';

import {
  appendLine, canSave, CONTRIBUTION_KINDS, contributionIntent, summarizeContribution,
} from '@/refined/client-contributions';
import { retryIntent, isSettled, type ClientQuestion } from '@/refined/client-questions';
import type { ContributionOut } from '@/lib/product';

/**
 * Cycle 5 P6.8: the browser rules behind the review's fixes.
 * - I-4 (simplified 2026-10-08): a note's intent key is reused on a retry of the
 *   same note and kind; the reply is a fact added or a proposed line; a proposed
 *   line is appended to the guidance for the client to save, never saved here;
 * - I-3: an unapplied answer is retried under ITS key and payload, never a new key.
 */

let serial = 0;
const mint = () => `key-${++serial}`;

describe('contribution intents', () => {
  it('reuses the key for the same note and kind and mints one for another', () => {
    const first = contributionIntent(null, 'We now open on Sundays.', 'fact', mint);
    expect(first.kind).toBe('fact');
    expect(contributionIntent(first, 'We now open on Sundays.', 'fact', mint)).toBe(first);
    expect(contributionIntent(first, 'We now open on Mondays.', 'fact', mint).key).not.toBe(first.key);
    expect(contributionIntent(first, 'We now open on Sundays.', 'writing', mint).key).not.toBe(first.key);
  });

  it('carries the Business DNA section it was sent from, and a new section is a new note (P9 fix round 1)', () => {
    const plain = contributionIntent(null, 'Office workers.', 'fact', mint);
    expect('section' in plain).toBe(false);
    const audience = contributionIntent(null, 'Office workers.', 'fact', mint, 'audience');
    expect(audience.section).toBe('audience');
    expect(contributionIntent(audience, 'Office workers.', 'fact', mint, 'audience')).toBe(audience);
    expect(contributionIntent(audience, 'Office workers.', 'fact', mint, 'offers').key).not.toBe(audience.key);
  });

  it('defaults to something about me or my business', () => {
    expect(contributionIntent(null, 'We now open on Sundays.').kind).toBe('fact');
    expect(CONTRIBUTION_KINDS.map(option => option.kind)).toEqual(['fact', 'writing']);
    expect(CONTRIBUTION_KINDS[0].label).toBe('Something about me or my business');
    expect(CONTRIBUTION_KINDS[1].label).toBe('How I want my posts written');
  });
});

describe('a contribution reply', () => {
  const reply = (extra: Partial<ContributionOut> = {}): ContributionOut => ({
    id: 'c-1', text: 'x', kind: 'fact', application_state: 'applied', pending_reason: null, application_note: null,
    what_changed: '', created_at: '2026-10-08T12:00:00Z', replayed: false,
    effects: [{ kind: 'fact', change: 'added', summary: 'Added for Acme: We now serve teams.' }],
    ...extra,
  });

  it('a fact note is the fact added', () => {
    expect(summarizeContribution(reply())).toEqual({
      facts: ['Added for Acme: We now serve teams.'], proposals: [], pending: null, notes: [],
    });
  });

  it('a writing note is one proposed line', () => {
    const writing = reply({ kind: 'writing', effects: [
      { kind: 'guidance', change: 'proposed', instruction: 'Never name Sam.', summary: 'Suggested.' }] });
    expect(summarizeContribution(writing)).toEqual({ facts: [], proposals: ['Never name Sam.'], pending: null, notes: [] });
  });

  it('says when nothing is applied yet, and why it failed when it did', () => {
    expect(summarizeContribution(reply({ application_state: 'pending', effects: [] })).pending).toContain("apply it yet");
    expect(summarizeContribution(reply({ application_state: 'failed', effects: [], application_note: 'Not applied: x.' })).notes)
      .toEqual(['Not applied: x.']);
  });
});

describe('Add to my guidance', () => {
  it('appends the line to the saved guidance, once, for the client to save', () => {
    expect(appendLine(null, 'Never name Sam.')).toBe('Never name Sam.');
    expect(appendLine('Write warmly.\n', 'Never name Sam.')).toBe('Write warmly.\nNever name Sam.');
    expect(appendLine('Write warmly.\nNever name Sam.', 'Never name Sam.')).toBe('Write warmly.\nNever name Sam.');
  });

  it('can be saved only within the guidance rules', () => {
    expect(canSave('Never name Sam.')).toBe(true);
    expect(canSave('   ')).toBe(false);
    expect(canSave('x'.repeat(2_001))).toBe(false);
  });
});

describe('an unapplied answer (I-3)', () => {
  const question = (extra: Partial<ClientQuestion> = {}): ClientQuestion => ({
    id: 'q-1', control: 'long', prompt: 'Who?', why: 'So.', options: [], allow_alternative: false, allow_uncertain: true,
    packet_id: null, origin: 'monthly', status: 'open', evidence_refs: [], created_at: '2026-10-08T12:00:00Z', ...extra,
  });

  it('a pending answer is retried under its own key and payload; a refused one is not retried (N2)', () => {
    const saved = { id: 'a-1', idempotency_key: 'saved-key', disposition: 'answer' as const, payload: { text: 'Families.' },
      what_changed: 'Saved.' };
    const again = retryIntent(question({ pending_answer: { ...saved, application_state: 'pending' } }));
    expect(again).toMatchObject({ questionId: 'q-1', key: 'saved-key', body: { disposition: 'answer', payload: { text: 'Families.' } } });
    expect(retryIntent(question({ pending_answer: { ...saved, application_state: 'failed' } }))).toBeNull();
    expect(retryIntent(question())).toBeNull();
  });

  it('only an applied or no-change answer is settled', () => {
    expect(['applied', 'no_change', 'pending', 'failed'].map(state => isSettled({ application_state: state as never })))
      .toEqual([true, true, false, false]);
  });
});
