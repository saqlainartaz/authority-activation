import { describe, expect, it } from 'vitest';
import { instantInZone } from '@/lib/zoned-instant';
import { rescheduleSlotInstant, scheduleZone } from '@/refined/schedule-zone';

describe('schedule time zone after a client setting change', () => {
  it('uses the current client zone for a new schedule', () => {
    const zone = scheduleZone({ slotId: null, slotZone: null }, 'Europe/Warsaw');
    expect(zone).toBe('Europe/Warsaw');
    expect(instantInZone('2026-12-01', '09:00', zone!)).toBe('2026-12-01T08:00:00.000Z');
  });

  it('reschedules in the existing slot zone, not the changed client zone', () => {
    const post = { slotId: 'existing-slot', slotZone: 'America/New_York' };
    const zone = scheduleZone(post, 'Europe/Warsaw');
    expect(zone).toBe('America/New_York');
    expect(rescheduleSlotInstant(post, '2026-12-01', '09:00')).toBe('2026-12-01T14:00:00.000Z');
  });

  it('refuses to guess a zone for a persisted slot with missing metadata', () => {
    expect(scheduleZone({ slotId: 'existing-slot', slotZone: null }, 'Europe/Warsaw')).toBeNull();
    expect(() => rescheduleSlotInstant({ slotZone: null }, '2026-12-01', '09:00')).toThrow('Schedule time zone unavailable');
  });
});
