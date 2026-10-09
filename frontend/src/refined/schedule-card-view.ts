import type { ScheduleProposal } from '@/lib/product';

/**
 * What a schedule card says and offers, decided in one pure place.
 *
 * The operator's design (2026-09-24): a pending card STATES the plan -- "goes
 * out Friday 3 October, 09:00" -- with the exact post and Confirm, and Change
 * opens an editor inside the card; after Confirm the same card is the receipt;
 * a card that no longer acts says why and offers nothing to click. Kept out of
 * the component so every state is testable without a DOM.
 *
 * The delivery line says how the post reaches its channel -- automatically, by
 * the client's own hand, or once they connect the account -- from the
 * server's publishing state (main's social publishing, merged 2026-09-25). A
 * card shows only what is true, so a card whose moment has passed drops it.
 *
 * A post-now card is the same card: the plan ("goes out now"), the post, and
 * Confirm; there is no time to change.
 */
export type ScheduleCardView = {
  eyebrow: string | null;
  title: string;
  preview: string | null;
  delivery: string | null;
  note: string | null;
  actions: readonly ('confirm' | 'change' | 'dismiss')[];
  tone: 'open' | 'done' | 'stale';
  /** What Confirm says while it runs. */
  busyLabel: string;
};

export function scheduleCardView(proposal: ScheduleProposal): ScheduleCardView {
  const now = proposal.kind === 'post_now';
  const common = { delivery: null, busyLabel: now ? 'Posting…' : 'Scheduling…' } as const;
  switch (proposal.status) {
    case 'pending':
      return now
        ? {
            ...common,
            eyebrow: 'Post this now',
            title: 'Goes out as soon as you confirm',
            preview: proposal.preview,
            delivery: proposal.delivery.line,
            note: null,
            actions: ['confirm', 'dismiss'],
            tone: 'open',
          }
        : {
            ...common,
            eyebrow: 'Schedule this post',
            title: `Goes out ${proposal.goes_out}`,
            preview: proposal.preview,
            delivery: proposal.delivery.line,
            note: null,
            actions: ['confirm', 'change', 'dismiss'],
            tone: 'open',
          };
    case 'confirmed':
      return {
        ...common,
        eyebrow: null,
        title: now ? '✓ Sent for publishing' : `✓ Scheduled for ${proposal.goes_out}`,
        preview: null,
        delivery: proposal.delivery.line,
        note: null,
        actions: [],
        tone: 'done',
      };
    case 'declined':
      return {
        ...common,
        eyebrow: null,
        title: now ? 'Post now' : proposal.goes_out,
        preview: null,
        note: now ? 'Dismissed. Nothing was published.' : 'Dismissed. Nothing was scheduled.',
        actions: [],
        tone: 'stale',
      };
    case 'superseded':
      return {
        ...common,
        eyebrow: null,
        title: now ? 'Post now' : proposal.goes_out,
        preview: null,
        note: now
          ? 'Replaced by a newer card, or the post changed. Nothing was published from this card.'
          : 'Replaced by a newer time, or the post changed. Nothing was scheduled from this card.',
        actions: [],
        tone: 'stale',
      };
    case 'expired':
      return {
        ...common,
        eyebrow: null,
        title: now ? 'Post now' : proposal.goes_out,
        preview: null,
        note: now ? 'This card expired. Ask again to post it now.' : 'This card expired. Ask again for a time.',
        actions: [],
        tone: 'stale',
      };
  }
}
