import { createContext, useContext } from 'react';

// Opens Settings at a section from anywhere in the client app (Cycle 5 P2.7, spec
// §7.4: "View usage MUST transition into the existing Settings section without
// stacked dialogs"). The app shell provides it; a screen rendered without it (a
// test) gets null and shows no link.
export const SettingsOpener = createContext<((section: string) => void) | null>(null);

export function useOpenSettings(): ((section: string) => void) | null {
  return useContext(SettingsOpener);
}
