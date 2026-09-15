"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  DEFAULT_PREFERENCES,
  parsePreferences,
  PREFERENCE_STORAGE_KEY,
  type Preferences,
} from "./preferences-contract";

type PreferencesContextValue = Preferences & {
  preferencesReady: boolean;
  setPreferences: (patch: Partial<Preferences>) => void;
};

const PreferencesContext = createContext<PreferencesContextValue | null>(null);

export function PreferencesProvider({ children }: { children: ReactNode }) {
  const [preferences, setPreferencesState] = useState<Preferences>(DEFAULT_PREFERENCES);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    try {
      // Hydration reads the browser-only contract after the server render.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPreferencesState(parsePreferences(localStorage.getItem(PREFERENCE_STORAGE_KEY)));
    } catch {
      setPreferencesState(DEFAULT_PREFERENCES);
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    document.documentElement.dataset.theme = preferences.theme;
  }, [hydrated, preferences.theme]);

  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem(PREFERENCE_STORAGE_KEY, JSON.stringify(preferences));
    } catch {
      /* Preferences remain usable when browser storage is unavailable. */
    }
  }, [hydrated, preferences]);

  const setPreferences = useCallback((patch: Partial<Preferences>) => {
    setPreferencesState((current) => ({
      theme: patch.theme ?? current.theme,
      sidebarCollapsed: patch.sidebarCollapsed ?? current.sidebarCollapsed,
      libraryViewMode: patch.libraryViewMode ?? current.libraryViewMode,
    }));
  }, []);

  const value = useMemo<PreferencesContextValue>(
    () => ({
      theme: preferences.theme,
      sidebarCollapsed: preferences.sidebarCollapsed,
      libraryViewMode: preferences.libraryViewMode,
      preferencesReady: hydrated,
      setPreferences,
    }),
    [hydrated, preferences, setPreferences],
  );

  return <PreferencesContext.Provider value={value}>{children}</PreferencesContext.Provider>;
}

export function usePreferences(): PreferencesContextValue {
  const preferences = useContext(PreferencesContext);
  if (!preferences) {
    throw new Error("usePreferences must be used inside <PreferencesProvider>");
  }
  return preferences;
}
