import { labelForAtomType } from '@/lib/atom-labels';
import type { ClientAtomDecisionIn, ClientAtoms } from '@/lib/product';

export type ReviewQueueEntry = {
  atomId: string;
  label: string;
  text: string;
  sourceLabel: string;
  canDeprecate: boolean;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function requiredText(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`Atom ${field} is missing.`);
  return value;
}

export function reviewQueue(envelope: ClientAtoms): ReviewQueueEntry[] {
  if (!envelope || !Array.isArray(envelope.atoms)) throw new Error('Atom response is malformed.');
  return envelope.atoms.flatMap(atom => {
    if (!atom || typeof atom !== 'object') throw new Error('Atom response is malformed.');
    if (atom.status !== 'provisional') return [];
    if (typeof atom.can_deprecate !== 'boolean') throw new Error('Atom action state is missing.');
    return [{
      atomId: requiredText(atom.atom_id, 'id'),
      label: labelForAtomType(requiredText(atom.atom_type, 'type')),
      text: requiredText(atom.text, 'text'),
      sourceLabel: requiredText(atom.source_label, 'source label'),
      canDeprecate: atom.can_deprecate,
    }];
  });
}

export function decisionBody(
  decision: ClientAtomDecisionIn['decision'],
  idempotencyKey = crypto.randomUUID(),
): ClientAtomDecisionIn {
  if (!UUID.test(idempotencyKey)) throw new Error('Decision idempotency key must be a UUID.');
  return { decision, idempotency_key: idempotencyKey };
}

export function removeReviewed(
  queue: readonly ReviewQueueEntry[],
  atomId: string,
): ReviewQueueEntry[] | readonly ReviewQueueEntry[] {
  const index = queue.findIndex(entry => entry.atomId === atomId);
  if (index < 0) return queue;
  return [...queue.slice(0, index), ...queue.slice(index + 1)];
}
