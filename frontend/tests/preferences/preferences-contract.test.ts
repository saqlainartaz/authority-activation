import { describe, expect, it } from "vitest";

import { DEFAULT_PREFERENCES, parsePreferences } from "@/lib/preferences-contract";

describe("preferences contract", () => {
  it("defaults the Library to table view for a new visitor", () => {
    expect(parsePreferences(null)).toEqual(DEFAULT_PREFERENCES);
    expect(DEFAULT_PREFERENCES.libraryViewMode).toBe("list");
  });

  it("preserves preferences saved before Library view mode existed", () => {
    expect(parsePreferences(JSON.stringify({ theme: "dark", sidebarCollapsed: true }))).toEqual({
      theme: "dark",
      sidebarCollapsed: true,
      libraryViewMode: "list",
    });
  });

  it("accepts a valid persisted Library view and rejects an invalid one", () => {
    expect(parsePreferences(JSON.stringify({
      theme: "light",
      sidebarCollapsed: false,
      libraryViewMode: "card",
    }))).toEqual({
      theme: "light",
      sidebarCollapsed: false,
      libraryViewMode: "card",
    });

    expect(parsePreferences(JSON.stringify({
      theme: "dark",
      sidebarCollapsed: true,
      libraryViewMode: "grid",
    }))).toEqual(DEFAULT_PREFERENCES);
  });
});
