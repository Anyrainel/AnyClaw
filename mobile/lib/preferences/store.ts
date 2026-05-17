import { create } from "zustand";
import * as SecureStore from "expo-secure-store";
import { Appearance, PixelRatio } from "react-native";
import { getLocales } from "expo-localization";
import type {
  Preferences,
  ThemeSetting,
  FontSizeSetting,
} from "./types";
import { DEFAULT_PREFERENCES, FONT_SCALE_MAP } from "./types";

const STORE_KEY = "anyraven_preferences";

// PocketBase instance — set externally via _setPb for testing
let pb: { authStore: { isValid: boolean; record: { id: string } | null }; collection: (name: string) => { getFirstListItem: (filter: string) => Promise<{ id: string; data: Preferences }>; create: (data: unknown) => Promise<unknown>; update: (id: string, data: unknown) => Promise<unknown>; }; } | null = null;

/** @internal Test helper to inject PocketBase instance */
export function _setPb(instance: typeof pb) {
  pb = instance;
}

function resolveTheme(theme: ThemeSetting): "light" | "dark" {
  if (theme === "system") {
    return Appearance.getColorScheme() === "dark" ? "dark" : "light";
  }
  return theme;
}

function resolveFontScale(fontSize: FontSizeSetting): number {
  if (fontSize === "system") {
    return PixelRatio.getFontScale();
  }
  return FONT_SCALE_MAP[fontSize];
}

function getSystemLanguage(): string {
  try {
    const locales = getLocales();
    return locales[0]?.languageTag ?? "en";
  } catch {
    return "en";
  }
}

interface PreferencesState {
  prefs: Preferences;
  resolvedTheme: "light" | "dark";
  resolvedFontScale: number;
  hydrated: boolean;
  hydrate: () => Promise<void>;
  set: (patch: Partial<Preferences>) => Promise<void>;
  reset: () => Promise<void>;
}

export const usePreferencesStore = create<PreferencesState>((setState, getState) => ({
  prefs: { ...DEFAULT_PREFERENCES },
  resolvedTheme: "light",
  resolvedFontScale: 1.0,
  hydrated: false,

  hydrate: async () => {
    // 1. Try to load from SecureStore
    let prefs: Preferences = {
      ...DEFAULT_PREFERENCES,
      language: getSystemLanguage(),
    };

    const cached = await SecureStore.getItemAsync(STORE_KEY);
    let hadCache = false;
    if (cached) {
      try {
        prefs = JSON.parse(cached) as Preferences;
        hadCache = true;
      } catch {
        // ignore corrupt cache
      }
    }

    // 2. If authenticated, try to fetch from PocketBase (best-effort)
    if (pb?.authStore?.isValid && pb.authStore.record) {
      try {
        const record = await pb
          .collection("_user_preferences")
          .getFirstListItem(`user="${pb.authStore.record.id}"`);
        if (record?.data) {
          prefs = record.data;
          // Write back to SecureStore
          await SecureStore.setItemAsync(STORE_KEY, JSON.stringify(prefs));
        }
      } catch {
        // Network failure — keep local values
      }
    }

    setState({
      prefs,
      resolvedTheme: resolveTheme(prefs.theme),
      resolvedFontScale: resolveFontScale(prefs.font_size),
      hydrated: true,
    });
  },

  set: async (patch: Partial<Preferences>) => {
    const current = getState().prefs;
    const updated = { ...current, ...patch };

    // Always write SecureStore first
    await SecureStore.setItemAsync(STORE_KEY, JSON.stringify(updated));

    setState({
      prefs: updated,
      resolvedTheme: resolveTheme(updated.theme),
      resolvedFontScale: resolveFontScale(updated.font_size),
    });

    // Best-effort PocketBase upsert
    if (pb?.authStore?.isValid && pb.authStore.record) {
      try {
        await pb
          .collection("_user_preferences")
          .update(pb.authStore.record.id, { data: updated });
      } catch {
        // ignore
      }
    }
  },

  reset: async () => {
    const defaults: Preferences = {
      ...DEFAULT_PREFERENCES,
      language: getSystemLanguage(),
    };

    await SecureStore.deleteItemAsync(STORE_KEY);
    await SecureStore.setItemAsync(STORE_KEY, JSON.stringify(defaults));

    setState({
      prefs: defaults,
      resolvedTheme: resolveTheme(defaults.theme),
      resolvedFontScale: resolveFontScale(defaults.font_size),
    });
  },
}));
