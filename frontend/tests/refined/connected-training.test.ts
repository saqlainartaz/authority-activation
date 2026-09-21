import { describe, expect, it } from 'vitest';

import type { ClientAtoms } from '@/lib/product';
import { decisionBody, removeReviewed, reviewQueue } from '@/refined/connected-training';

function envelope(): ClientAtoms {
  return {
    client_id: 'client-a',
    atoms: [
      { atom_id: 'confirmed', atom_type: 'tldr', can_deprecate: true, text: 'Already confirmed', status: 'confirmed', created_at: '2026-09-20T09:00:00Z', source_label: 'Onboarding', document_id: 'doc-1', untrusted_fields: ['text'], trust: 'untrusted' },
      { atom_id: 'first', atom_type: 'insight', can_deprecate: true, text: '<b>Full client text</b> & no truncation', status: 'provisional', created_at: '2026-09-20T10:00:00Z', source_label: 'Interview transcript', document_id: 'doc-2', untrusted_fields: ['text'], trust: 'untrusted' },
      { atom_id: 'second', atom_type: 'proof_point', can_deprecate: false, text: 'Twelve documentary episodes.', status: 'provisional', created_at: '2026-09-20T11:00:00Z', source_label: 'Onboarding', document_id: 'doc-3', untrusted_fields: ['text'], trust: 'untrusted' },
      { atom_id: 'deprecated', atom_type: 'quote', can_deprecate: false, text: 'Old text', status: 'deprecated', created_at: '2026-09-20T12:00:00Z', source_label: 'Upload', document_id: 'doc-4', untrusted_fields: ['text'], trust: 'untrusted' },
    ],
    atom_counts: { tldr: 1, insight: 1, proof_point: 1, quote: 1 },
    generated_at: '2026-09-20T12:10:00Z',
  };
}

describe('connected Train Your AI review queue', () => {
  it('keeps only provisional atoms in server order with client-safe labels and complete plain text', () => {
    expect(reviewQueue(envelope())).toEqual([
      {
        atomId: 'first',
        label: 'Brand strategy',
        text: '<b>Full client text</b> & no truncation',
        sourceLabel: 'Interview transcript',
        canDeprecate: true,
      },
      {
        atomId: 'second',
        label: 'Evidence',
        text: 'Twelve documentary episodes.',
        sourceLabel: 'Onboarding',
        canDeprecate: false,
      },
    ]);
  });

  it('uses the filtered queue itself as the authoritative waiting count', () => {
    const queue = reviewQueue(envelope());
    expect(queue).toHaveLength(2);
    expect(envelope().atom_counts).not.toEqual({ insight: 1, proof_point: 1 });
  });

  it('refuses malformed trusted labels or client text rather than coercing them', () => {
    const badText = envelope();
    badText.atoms[1] = { ...badText.atoms[1], text: undefined as never };
    expect(() => reviewQueue(badText)).toThrow(/text/i);

    const badSource = envelope();
    badSource.atoms[1] = { ...badSource.atoms[1], source_label: '' };
    expect(() => reviewQueue(badSource)).toThrow(/source/i);
  });

  it('builds only a confirm or deprecate request with a UUID idempotency key', () => {
    const confirm = decisionBody('confirm');
    expect(confirm).toEqual({ decision: 'confirm', idempotency_key: expect.any(String) });
    expect(confirm.idempotency_key).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    expect(decisionBody('deprecate', '11111111-1111-4111-8111-111111111111')).toEqual({
      decision: 'deprecate',
      idempotency_key: '11111111-1111-4111-8111-111111111111',
    });
  });

  it('removes exactly one decided card without mutating the failed/retry input queue', () => {
    const queue = reviewQueue(envelope());
    const before = structuredClone(queue);
    expect(removeReviewed(queue, 'first')).toEqual([queue[1]]);
    expect(queue).toEqual(before);
    expect(removeReviewed(queue, 'missing')).toBe(queue);
  });
});
