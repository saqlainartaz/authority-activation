import { describe, expect, it } from 'vitest';
import { DEFAULT_LIBRARY_DISPLAY, parseLibraryDisplay } from '@/refined/library-display';

describe('Library display settings', () => {
  it('starts with Table and compact rows off', () => {
    expect(parseLibraryDisplay(null)).toEqual(DEFAULT_LIBRARY_DISPLAY);
  });

  it('restores Board and compact rows independently', () => {
    expect(parseLibraryDisplay('{"view":"board","compactRows":true}')).toEqual({ view: 'board', compactRows: true });
    expect(parseLibraryDisplay('{"view":"table","compactRows":true}')).toEqual({ view: 'table', compactRows: true });
  });

  it('falls back safely for malformed or unknown values', () => {
    expect(parseLibraryDisplay('{')).toEqual(DEFAULT_LIBRARY_DISPLAY);
    expect(parseLibraryDisplay('{"view":"grid","compactRows":"yes"}')).toEqual(DEFAULT_LIBRARY_DISPLAY);
  });
});
