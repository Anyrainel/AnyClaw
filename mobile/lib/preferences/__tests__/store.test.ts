import type { Preferences } from "../types";

// Mock expo-secure-store
const mockSecureStore: Record<string, string> = {};
jest.mock("expo-secure-store", () => ({
  setItemAsync: jest.fn(async (key: string, value: string) => {
    mockSecureStore[key] = value;
  }),
  getItemAsync: jest.fn(async (key: string) => mockSecureStore[key] ?? null),
  deleteItemAsync: jest.fn(async (key: string) => {
    delete mockSecureStore[key];
  }),
}));

// Mock react-native
let mockColorScheme: "light" | "dark" = "light";
let mockFontScale = 1.0;
jest.mock("react-native", () => ({
  Appearance: {
    getColorScheme: () => mockColorScheme,
  },
  PixelRatio: {
    getFontScale: () => mockFontScale,
  },
  AppState: {
    addEventListener: jest.fn(() => ({ remove: jest.fn() })),
    currentState: "active",
  },
}));

// Mock expo-localization
jest.mock("expo-localization", () => ({
  getLocales: () => [{ languageTag: "fr-FR" }],
}));

// Mock pocketbase
const mockPbCollection = {
  getFirstListItem: jest.fn(),
  create: jest.fn(),
  update: jest.fn(),
};
jest.mock("pocketbase", () => {
  return jest.fn().mockImplementation(() => ({
    collection: () => mockPbCollection,
    authStore: { isValid: false, record: null },
  }));
});

import { usePreferencesStore, _setPb } from "../store";

beforeEach(() => {
  // Clear mocks and store
  for (const key of Object.keys(mockSecureStore)) {
    delete mockSecureStore[key];
  }
  mockColorScheme = "light";
  mockFontScale = 1.0;
  jest.clearAllMocks();

  // Reset the zustand store to initial state
  usePreferencesStore.setState({
    prefs: {
      theme: "system",
      font_size: "system",
      font_family: "sans",
      language: "en",
      accent_color: "#6366f1",
      onboarding_completed_at: null,
    },
    resolvedTheme: "light",
    resolvedFontScale: 1.0,
    hydrated: false,
  });
  _setPb(null);
});

describe("preferences store", () => {
  test("first-ever hydrate (no cache, not authenticated) -> defaults with language from locale", async () => {
    await usePreferencesStore.getState().hydrate();

    const state = usePreferencesStore.getState();
    expect(state.hydrated).toBe(true);
    expect(state.prefs.theme).toBe("system");
    expect(state.prefs.language).toBe("fr-FR"); // from mock locale
    expect(state.prefs.font_size).toBe("system");
  });

  test("hydrate with SecureStore cache -> cached values, no PB call", async () => {
    const cached: Preferences = {
      theme: "dark",
      font_size: "large",
      font_family: "serif",
      language: "de-DE",
      accent_color: "#ff0000",
      onboarding_completed_at: "2024-01-01",
    };
    mockSecureStore["anyclaw_preferences"] = JSON.stringify(cached);

    await usePreferencesStore.getState().hydrate();

    const state = usePreferencesStore.getState();
    expect(state.prefs.theme).toBe("dark");
    expect(state.prefs.font_size).toBe("large");
    expect(state.prefs.language).toBe("de-DE");
    expect(mockPbCollection.getFirstListItem).not.toHaveBeenCalled();
  });

  test("hydrate authenticated with remote row -> remote overrides local and writes back to SecureStore", async () => {
    const localPrefs: Preferences = {
      theme: "light",
      font_size: "small",
      font_family: "sans",
      language: "en",
      accent_color: "#000",
      onboarding_completed_at: null,
    };
    mockSecureStore["anyclaw_preferences"] = JSON.stringify(localPrefs);

    const remotePrefs: Preferences = {
      theme: "dark",
      font_size: "large",
      font_family: "serif",
      language: "ja-JP",
      accent_color: "#fff",
      onboarding_completed_at: "2024-06-01",
    };

    const pbInstance = {
      collection: () => mockPbCollection,
      authStore: { isValid: true, record: { id: "user1" } },
    };
    mockPbCollection.getFirstListItem.mockResolvedValueOnce({
      id: "pref1",
      data: remotePrefs,
    });

    _setPb(pbInstance as never);
    await usePreferencesStore.getState().hydrate();

    const state = usePreferencesStore.getState();
    expect(state.prefs.theme).toBe("dark");
    expect(state.prefs.language).toBe("ja-JP");

    // Verify it was written back to SecureStore
    const stored = JSON.parse(mockSecureStore["anyclaw_preferences"]);
    expect(stored.theme).toBe("dark");
  });

  test("hydrate authenticated with PB network failure -> local values preserved", async () => {
    const localPrefs: Preferences = {
      theme: "light",
      font_size: "medium",
      font_family: "sans",
      language: "en",
      accent_color: "#123",
      onboarding_completed_at: null,
    };
    mockSecureStore["anyclaw_preferences"] = JSON.stringify(localPrefs);

    const pbInstance = {
      collection: () => mockPbCollection,
      authStore: { isValid: true, record: { id: "user1" } },
    };
    mockPbCollection.getFirstListItem.mockRejectedValueOnce(
      new Error("Network error")
    );

    _setPb(pbInstance as never);
    await usePreferencesStore.getState().hydrate();

    const state = usePreferencesStore.getState();
    expect(state.prefs.theme).toBe("light");
    expect(state.prefs.language).toBe("en");
  });

  test("set({ theme: 'dark' }) -> SecureStore written before PB call", async () => {
    await usePreferencesStore.getState().hydrate();

    const SecureStore = require("expo-secure-store");
    await usePreferencesStore.getState().set({ theme: "dark" });

    expect(SecureStore.setItemAsync).toHaveBeenCalled();
    const stored = JSON.parse(mockSecureStore["anyclaw_preferences"]);
    expect(stored.theme).toBe("dark");
  });

  test("resolve() with theme: 'system' and system dark -> resolvedTheme: 'dark'", async () => {
    mockColorScheme = "dark";
    await usePreferencesStore.getState().hydrate();

    const state = usePreferencesStore.getState();
    expect(state.prefs.theme).toBe("system");
    expect(state.resolvedTheme).toBe("dark");
  });

  test("resolve() with font_size: 'large' -> resolvedFontScale: 1.2", async () => {
    await usePreferencesStore.getState().hydrate();
    await usePreferencesStore.getState().set({ font_size: "large" });

    const state = usePreferencesStore.getState();
    expect(state.resolvedFontScale).toBe(1.2);
  });

  test("reset() clears onboarding_completed_at and reseeds language", async () => {
    const cached: Preferences = {
      theme: "dark",
      font_size: "large",
      font_family: "serif",
      language: "de-DE",
      accent_color: "#ff0000",
      onboarding_completed_at: "2024-01-01",
    };
    mockSecureStore["anyclaw_preferences"] = JSON.stringify(cached);

    await usePreferencesStore.getState().hydrate();
    expect(usePreferencesStore.getState().prefs.onboarding_completed_at).toBe("2024-01-01");

    await usePreferencesStore.getState().reset();

    const state = usePreferencesStore.getState();
    expect(state.prefs.onboarding_completed_at).toBeNull();
    expect(state.prefs.language).toBe("fr-FR"); // reseeded from locale mock
    expect(state.prefs.theme).toBe("system"); // back to default
  });
});
