import { describe, expect, it } from 'vitest';

import { versionFromReceipt } from '@/refined/evidence';
import { paraText } from '@/shared/data';

describe('connected draft evidence', () => {
  it('maps server receipt code-point offsets to highlighted claims and source detail', () => {
    const body = 'A 🚀 launch moved faster.\n\nClients asked why.';
    const chars = Array.from(body);
    const start = chars.indexOf('l');
    const end = start + Array.from('launch moved faster').length;
    const version = versionFromReceipt(body, [{
      ordinal: 7,
      claim_text: 'launch moved faster',
      quoted_span: 'We shipped the launch in eleven days.',
      body_start: start,
      body_end: end,
      source_label: 'March delivery call',
      line: 18,
      timecode: '00:14:22',
      speaker: 'Sam',
    }]);

    expect(version.paras.map(paraText)).toEqual(['A 🚀 launch moved faster.', 'Clients asked why.']);
    expect(version.paras[0].segs.find(segment => segment.claim)?.t).toBe('launch moved faster');
    expect(version.paras[0].segs.find(segment => segment.claim)?.claim?.n).toBe('7');
    expect(version.sources).toEqual([{ n: '7', t: 'March delivery call', loc: 'Sam · 00:14:22 · line 18', quote: 'We shipped the launch in eleven days.' }]);
  });

  it('keeps a truthful source entry without inventing missing locator text', () => {
    const version = versionFromReceipt('A supported claim.', [{
      ordinal: 1,
      claim_text: 'supported claim',
      quoted_span: null,
      body_start: 2,
      body_end: 17,
      source_label: 'Source document',
      line: null,
      timecode: null,
      speaker: null,
    }]);

    expect(version.sources[0]).toMatchObject({ loc: '' });
    expect(version.sources[0].quote).toBeUndefined();
  });
});
