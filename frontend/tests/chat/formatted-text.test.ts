import { describe, expect, it } from 'vitest';

import { formattedTokens } from '@/refined/FormattedText';

describe('draft text formatting', () => {
  it('renders bold and italic markers without interpreting arbitrary HTML', () => {
    expect(formattedTokens('Use **strong proof** and _plain emphasis_ <script>.')).toEqual([
      { kind: 'text', text: 'Use ' },
      { kind: 'bold', text: 'strong proof' },
      { kind: 'text', text: ' and ' },
      { kind: 'italic', text: 'plain emphasis' },
      { kind: 'text', text: ' <script>.' },
    ]);
  });
});
