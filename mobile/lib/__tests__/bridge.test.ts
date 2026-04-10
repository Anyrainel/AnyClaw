// Mock react-native WebView ref
jest.mock("expo-secure-store", () => ({
  setItemAsync: jest.fn(),
  getItemAsync: jest.fn(async () => null),
  deleteItemAsync: jest.fn(),
}));

import {
  parseBridgeMessage,
  buildResolvedPreferencesPayload,
  inject,
  type BridgeMessage,
} from "../bridge";

describe("Bridge protocol", () => {
  test("parseBridgeMessage accepts valid JSON with a string type", () => {
    const msg = parseBridgeMessage(
      JSON.stringify({ type: "session-token", token: "abc-123" })
    );
    expect(msg).not.toBeNull();
    expect(msg!.type).toBe("session-token");
    expect((msg as { type: string; token: string }).token).toBe("abc-123");
  });

  test("malformed JSON -> null", () => {
    const msg = parseBridgeMessage("not valid json {{{");
    expect(msg).toBeNull();
  });

  test("missing type -> null", () => {
    const msg = parseBridgeMessage(JSON.stringify({ data: "hello" }));
    expect(msg).toBeNull();
  });

  test("buildResolvedPreferencesPayload never includes 'system' in theme or font_size output", () => {
    const payload = buildResolvedPreferencesPayload(
      {
        theme: "system",
        font_size: "system",
        font_family: "sans",
        language: "en",
        accent_color: "#6366f1",
        onboarding_completed_at: null,
      },
      "dark", // resolved theme
      1.0 // resolved font scale
    );

    expect(payload.theme).not.toBe("system");
    expect(payload.theme).toBe("dark");
    expect(payload.fontScale).toBe(1.0);
    // Verify no 'system' anywhere in the output
    expect(Object.values(payload)).not.toContain("system");
  });

  test("buildResolvedPreferencesPayload with font_size 'large' -> fontScale 1.2", () => {
    const payload = buildResolvedPreferencesPayload(
      {
        theme: "light",
        font_size: "large",
        font_family: "serif",
        language: "fr",
        accent_color: "#ff0000",
        onboarding_completed_at: "2026-01-01",
      },
      "light",
      1.2
    );

    expect(payload.fontScale).toBe(1.2);
    expect(payload.theme).toBe("light");
    expect(payload.fontFamily).toBe("serif");
    expect(payload.language).toBe("fr");
    expect(payload.accent).toBe("#ff0000");
  });

  test("inject sends postMessage to webview ref", () => {
    const mockPostMessage = jest.fn();
    const webviewRef = {
      current: {
        postMessage: mockPostMessage,
      },
    };

    const message: BridgeMessage = {
      type: "session-token",
      token: "test-token",
    };

    inject(webviewRef as unknown as React.RefObject<{ postMessage: (msg: string) => void }>, message);

    expect(mockPostMessage).toHaveBeenCalledTimes(1);
    const sent = JSON.parse(mockPostMessage.mock.calls[0][0]);
    expect(sent.type).toBe("session-token");
    expect(sent.token).toBe("test-token");
  });
});
