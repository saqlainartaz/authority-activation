import { describe, expect, it } from 'vitest';

import { trainingBadgeCount } from '@/refined/questions';

describe('Train your AI navigation badge', () => {
  it('never derives a connected badge from demo-question answers', () => {
    expect(trainingBadgeCount(false, {})).toBe(0);
  });

  it('retains the packaged question count in demo mode', () => {
    expect(trainingBadgeCount(true, {})).toBeGreaterThan(0);
  });
});
