// Mock dependencies before imports
jest.mock("expo-router", () => ({
  useRouter: () => ({
    replace: jest.fn(),
    push: jest.fn(),
    back: jest.fn(),
  }),
}));

jest.mock("react-native-webview", () => {
  const React = require("react");
  const { View } = require("react-native");
  return {
    __esModule: true,
    default: React.forwardRef((props: Record<string, unknown>, ref: unknown) =>
      React.createElement(View, { testID: "mock-webview", ref })
    ),
    WebView: React.forwardRef((props: Record<string, unknown>, ref: unknown) =>
      React.createElement(View, { testID: "mock-webview", ref })
    ),
  };
});

jest.mock("@/lib/connection/store", () => ({
  useConnectionStore: jest.fn((selector: (s: Record<string, unknown>) => unknown) =>
    selector({
      serverUrl: null,
      sessionToken: null,
      connectionState: "disconnected",
    })
  ),
}));

jest.mock("@/lib/preferences/store", () => ({
  usePreferencesStore: jest.fn((selector: (s: Record<string, unknown>) => unknown) =>
    selector({
      prefs: {
        theme: "light",
        font_size: "medium",
        font_family: "sans",
        language: "en",
        accent_color: "#6366f1",
        onboarding_completed_at: null,
      },
      resolvedTheme: "light",
      resolvedFontScale: 1.0,
    })
  ),
}));

jest.mock("@/lib/versions/store", () => ({
  useVersionsStore: Object.assign(jest.fn(() => ({})), {
    getState: jest.fn(() => ({ fetchVersions: jest.fn() })),
  }),
}));

jest.mock("@/lib/bridge", () => ({
  parseBridgeMessage: jest.fn(),
  buildResolvedPreferencesPayload: jest.fn().mockReturnValue({
    theme: "light",
    fontScale: 1.0,
    fontFamily: "sans",
    language: "en",
    accent: "#6366f1",
  }),
  inject: jest.fn(),
}));

jest.mock("@/lib/pocketbase", () => ({
  subscribeToDeployments: jest.fn().mockResolvedValue(jest.fn()),
}));

jest.mock("@/lib/broker", () => ({
  refreshBrokerJwt: jest.fn(),
}));

import React from "react";
import { render } from "@testing-library/react-native";
import HomeScreen from "../index";

describe("HomeScreen", () => {
  it("renders 'Not Connected' when no server URL", () => {
    const { getByTestId, getByText } = render(<HomeScreen />);
    expect(getByTestId("home-no-server")).toBeTruthy();
    expect(getByText("Not Connected")).toBeTruthy();
  });
});
