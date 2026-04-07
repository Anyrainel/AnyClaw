export interface Preferences {
  theme: "light" | "dark" | "system";
  locale: string;
}

export interface UsePreferencesResult {
  preferences: Preferences;
  loading: boolean;
  error: Error | null;
}

/**
 * Plan 1 scaffold: returns hardcoded defaults so the template builds and
 * components can be authored against a stable shape. Plan 6 replaces the
 * body with real PocketBase `_preferences` collection reads.
 */
export function usePreferences(): UsePreferencesResult {
  return {
    preferences: { theme: "system", locale: "en-US" },
    loading: false,
    error: null,
  };
}
