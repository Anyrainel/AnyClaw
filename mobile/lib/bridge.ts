import type { Preferences } from "./preferences/types";

/**
 * Discriminated union of all bridge message types between the native
 * shell and the WebView.
 */
export type BridgeMessage =
  | { type: "session-token"; token: string }
  | { type: "reload" }
  | { type: "preferences-update"; preferences: ResolvedPreferencesPayload }
  | { type: "navigation"; route: string }
  | { type: "ready" };

/**
 * The resolved preferences payload sent to the WebView.
 * Never contains 'system' values — all resolved to concrete values.
 */
export interface ResolvedPreferencesPayload {
  theme: "light" | "dark";
  fontScale: number;
  fontFamily: string;
  language: string;
  accent: string;
}

/**
 * Parse a raw string into a BridgeMessage. Returns null if the
 * string is not valid JSON or lacks a string `type` field.
 */
export function parseBridgeMessage(raw: string): BridgeMessage | null {
  try {
    const parsed = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed === "object" &&
      typeof parsed.type === "string"
    ) {
      return parsed as BridgeMessage;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Build a resolved preferences payload from internal preferences and
 * the resolved theme/fontScale values. Ensures no 'system' values
 * leak into the external payload.
 */
export function buildResolvedPreferencesPayload(
  prefs: Preferences,
  resolvedTheme: "light" | "dark",
  resolvedFontScale: number
): ResolvedPreferencesPayload {
  return {
    theme: resolvedTheme,
    fontScale: resolvedFontScale,
    fontFamily: prefs.font_family,
    language: prefs.language,
    accent: prefs.accent_color,
  };
}

/**
 * Inject a bridge message into the WebView by serializing to JSON
 * and calling postMessage.
 */
export function inject(
  webviewRef: React.RefObject<{ postMessage: (msg: string) => void }>,
  message: BridgeMessage
): void {
  if (webviewRef.current) {
    webviewRef.current.postMessage(JSON.stringify(message));
  }
}
