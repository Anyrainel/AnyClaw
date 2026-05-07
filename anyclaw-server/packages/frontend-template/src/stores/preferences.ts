import { create } from "zustand";

interface PreferencesState {
  theme: "light" | "dark" | "system";
  language: string;
  setTheme: (theme: "light" | "dark" | "system") => void;
  setLanguage: (lang: string) => void;
}

export const usePreferences = create<PreferencesState>((set) => ({
  theme: "system",
  language: "en",
  setTheme: (theme) => set({ theme }),
  setLanguage: (language) => set({ language }),
}));
