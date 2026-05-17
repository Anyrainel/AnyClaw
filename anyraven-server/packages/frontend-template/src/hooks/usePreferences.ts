import { useState, useEffect, useRef } from "react";
import type { UnsubscribeFunc } from "pocketbase";
import pb from "../lib/pocketbase.js";

export interface Preferences {
  theme: "system" | "light" | "dark";
  fontSize: "small" | "medium" | "large";
  fontFamily: "sans" | "serif";
  accent: "blue" | "teal" | "green" | "amber" | "rose" | "violet";
  language: string; // BCP-47
}

const DEFAULTS: Preferences = {
  theme: "system",
  fontSize: "medium",
  fontFamily: "sans",
  accent: "blue",
  language: typeof navigator !== "undefined" ? navigator.language : "en-US",
};

function toPreferences(record: Record<string, unknown>): Preferences {
  return {
    theme: (record.theme as Preferences["theme"]) ?? DEFAULTS.theme,
    fontSize: (record.fontSize as Preferences["fontSize"]) ?? DEFAULTS.fontSize,
    fontFamily:
      (record.fontFamily as Preferences["fontFamily"]) ?? DEFAULTS.fontFamily,
    accent: (record.accent as Preferences["accent"]) ?? DEFAULTS.accent,
    language: (record.language as string) ?? DEFAULTS.language,
  };
}

/**
 * Reads user preferences from the PocketBase `user_preferences` collection.
 * Falls back to sensible defaults if PocketBase is unreachable.
 * Subscribes to real-time updates and cleans up on unmount.
 */
export function usePreferences(): Preferences {
  const [prefs, setPrefs] = useState<Preferences>(DEFAULTS);
  const unsubRef = useRef<UnsubscribeFunc | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function init(): Promise<void> {
      try {
        const records = await pb
          .collection("user_preferences")
          .getList(1, 1);
        if (!cancelled && records.items.length > 0) {
          setPrefs(toPreferences(records.items[0] as Record<string, unknown>));
        }
      } catch (err) {
        // PocketBase unreachable — keep defaults, log for debugging
        console.warn("[usePreferences] fetch failed, using defaults:", err);
      }

      try {
        const unsub = await pb
          .collection("user_preferences")
          .subscribe("*", (e) => {
            if (!cancelled && e.action !== "delete") {
              setPrefs(toPreferences(e.record as Record<string, unknown>));
            }
          });
        if (cancelled) {
          unsub();
        } else {
          unsubRef.current = unsub;
        }
      } catch {
        // SSE unavailable — still functional with initial fetch
      }
    }

    init();

    return () => {
      cancelled = true;
      unsubRef.current?.();
    };
  }, []);

  return prefs;
}
