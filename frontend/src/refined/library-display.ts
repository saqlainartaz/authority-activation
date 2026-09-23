export type LibraryView = 'table' | 'board';
export type LibraryDisplay = { view: LibraryView; compactRows: boolean };

export const DEFAULT_LIBRARY_DISPLAY: LibraryDisplay = { view: 'table', compactRows: false };

export function parseLibraryDisplay(raw: string | null): LibraryDisplay {
  if (!raw) return DEFAULT_LIBRARY_DISPLAY;
  try {
    const saved = JSON.parse(raw);
    return { view: saved?.view === 'board' ? 'board' : 'table', compactRows: saved?.compactRows === true };
  } catch { return DEFAULT_LIBRARY_DISPLAY; }
}
