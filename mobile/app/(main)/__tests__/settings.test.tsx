// Mock dependencies before imports
jest.mock("expo-router", () => ({
  useRouter: () => ({
    replace: jest.fn(),
    push: jest.fn(),
    back: jest.fn(),
  }),
}));

jest.mock("react-native-reanimated", () => ({}));
jest.mock("react-native-gesture-handler", () => ({}));
jest.mock("react-native-worklets", () => ({
  getUseOfValueInStyleWarning: () => undefined,
}));

const mockPrefs = {
  theme: "system" as const,
  font_size: "medium" as const,
  font_family: "sans" as const,
  language: "en",
  accent_color: "#6366f1",
  onboarding_completed_at: null,
};

const mockPreferencesStore = {
  prefs: mockPrefs,
  set: jest.fn(),
};

jest.mock("@/lib/preferences/store", () => ({
  usePreferencesStore: jest.fn((selector: (s: typeof mockPreferencesStore) => unknown) =>
    selector(mockPreferencesStore)
  ),
}));

const mockSettingsStore = {
  clarificationMode: "auto-timeout" as const,
  clarificationTimeoutMinutes: 5,
  debugEncryptedTraffic: false,
  update: jest.fn(),
};

jest.mock("@/lib/settings/store", () => ({
  useSettingsStore: jest.fn((selector: (s: typeof mockSettingsStore) => unknown) =>
    selector(mockSettingsStore)
  ),
}));

const mockConnectionStore = {
  connectionState: "connected",
  serverUrl: "https://myserver.example.com",
  logout: jest.fn(),
};

jest.mock("@/lib/connection/store", () => ({
  useConnectionStore: jest.fn((selector: (s: typeof mockConnectionStore) => unknown) =>
    selector(mockConnectionStore)
  ),
}));

import React from "react";
import { render } from "@testing-library/react-native";
import SettingsScreen from "../settings";

describe("SettingsScreen", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("renders settings screen with all sections", () => {
    const { getByTestId, getByText } = render(<SettingsScreen />);
    expect(getByTestId("settings-screen")).toBeTruthy();
    expect(getByText("Theme")).toBeTruthy();
    expect(getByText("Font Size")).toBeTruthy();
    expect(getByText("Font Family")).toBeTruthy();
    expect(getByText("Accent Color")).toBeTruthy();
    expect(getByText("Language")).toBeTruthy();
    expect(getByText("Clarification Timeout")).toBeTruthy();
    expect(getByText("Connection")).toBeTruthy();
    expect(getByText("Debug")).toBeTruthy();
    expect(getByText("About")).toBeTruthy();
  });

  it("shows server URL and connection status", () => {
    const { getByTestId } = render(<SettingsScreen />);
    expect(getByTestId("settings-server-url")).toBeTruthy();
    expect(getByTestId("settings-connection-status")).toBeTruthy();
  });

  it("shows app version", () => {
    const { getByTestId } = render(<SettingsScreen />);
    expect(getByTestId("settings-app-version")).toBeTruthy();
  });

  it("renders disconnect and repair buttons", () => {
    const { getByTestId } = render(<SettingsScreen />);
    expect(getByTestId("settings-disconnect")).toBeTruthy();
    expect(getByTestId("settings-repair")).toBeTruthy();
  });

  it("renders debug toggle", () => {
    const { getByTestId } = render(<SettingsScreen />);
    expect(getByTestId("settings-debug-toggle")).toBeTruthy();
  });

  it("renders theme options", () => {
    const { getByTestId } = render(<SettingsScreen />);
    expect(getByTestId("theme-system")).toBeTruthy();
    expect(getByTestId("theme-light")).toBeTruthy();
    expect(getByTestId("theme-dark")).toBeTruthy();
  });

  it("renders accent color swatches", () => {
    const { getByTestId } = render(<SettingsScreen />);
    expect(getByTestId("accent-blue")).toBeTruthy();
    expect(getByTestId("accent-teal")).toBeTruthy();
    expect(getByTestId("accent-green")).toBeTruthy();
    expect(getByTestId("accent-amber")).toBeTruthy();
    expect(getByTestId("accent-rose")).toBeTruthy();
    expect(getByTestId("accent-violet")).toBeTruthy();
  });
});
