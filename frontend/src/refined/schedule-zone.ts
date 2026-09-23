import { instantInZone } from '@/lib/zoned-instant';

/** A live slot keeps the zone it was created with, even if tenant settings change. */
export function scheduleZone(
  post: { slotId?: string | null; slotZone?: string | null } | null,
  currentClientZone: string,
): string | null {
  if (post?.slotId && !post.slotZone) return null;
  return post?.slotZone || currentClientZone;
}

export function rescheduleSlotInstant(
  post: { slotZone?: string | null },
  date: string,
  time: string,
): string {
  if (!post.slotZone) throw new Error('Schedule time zone unavailable. Refresh and try again.');
  return instantInZone(date, time, post.slotZone);
}
