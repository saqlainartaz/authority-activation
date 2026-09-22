import { describe, expect, it } from 'vitest';

import { CHANNELS, CHANNEL_KEYS, DEFAULT_CHANNEL, channelsFromIntent } from '@/shared/channels';

describe('closed social channel intent', () => {
  it('defaults a new writing session to LinkedIn', () => {
    expect(DEFAULT_CHANNEL).toBe('li');
    expect(CHANNELS[DEFAULT_CHANNEL].label).toBe('LinkedIn');
  });

  it('recognises all four platform names in ordinary punctuation', () => {
    expect(channelsFromIntent('Write for LinkedIn, Instagram, X, and Facebook.')).toEqual(CHANNEL_KEYS);
  });

  it('does not mistake an x inside another word for the X platform', () => {
    expect(channelsFromIntent('Explain the next example.')).toEqual([]);
  });
});
