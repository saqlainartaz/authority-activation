export const PREFERENCE_STORAGE_KEY = "aa-preferences-v1";

export type Theme = "light" | "dark";
export type LibraryViewMode = "list" | "card";

export interface Preferences {
  theme: Theme;
  sidebarCollapsed: boolean;
  libraryViewMode: LibraryViewMode;
}

export const DEFAULT_PREFERENCES: Preferences = {
  theme: "light",
  sidebarCollapsed: false,
  libraryViewMode: "list",
};

function defaults(): Preferences {
  return {
    theme: DEFAULT_PREFERENCES.theme,
    sidebarCollapsed: DEFAULT_PREFERENCES.sidebarCollapsed,
    libraryViewMode: DEFAULT_PREFERENCES.libraryViewMode,
  };
}

export function parsePreferences(raw: string | null): Preferences {
  if (!raw) return defaults();

  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return defaults();
    }

    const candidate = parsed as {
      theme?: unknown;
      sidebarCollapsed?: unknown;
      libraryViewMode?: unknown;
    };
    if (
      (candidate.theme !== "light" && candidate.theme !== "dark") ||
      typeof candidate.sidebarCollapsed !== "boolean" ||
      (
        candidate.libraryViewMode !== undefined &&
        candidate.libraryViewMode !== "list" &&
        candidate.libraryViewMode !== "card"
      )
    ) {
      return defaults();
    }

    return {
      theme: candidate.theme,
      sidebarCollapsed: candidate.sidebarCollapsed,
      libraryViewMode: candidate.libraryViewMode ?? DEFAULT_PREFERENCES.libraryViewMode,
    };
  } catch {
    return defaults();
  }
}
