import { create } from "zustand";
import * as SecureStore from "expo-secure-store";
import { apiClient } from "../api";

export const SETTINGS_STORE_KEY = "anyclaw_settings";

export type ClarificationMode = "auto-timeout" | "pause-indefinitely";

/** Fields that are mirrored to the dispatch server. */
const NETWORK_MIRRORED_FIELDS = new Set<string>([
  "clarificationMode",
  "clarificationTimeoutMinutes",
]);

interface SettingsData {
  clarificationMode: ClarificationMode;
  clarificationTimeoutMinutes: number;
  debugEncryptedTraffic: boolean;
}

const DEFAULT_SETTINGS: SettingsData = {
  clarificationMode: "auto-timeout",
  clarificationTimeoutMinutes: 5,
  debugEncryptedTraffic: false,
};

interface SettingsStore extends SettingsData {
  hydrated: boolean;
  hydrate: () => Promise<void>;
  update: (patch: Partial<SettingsData>) => Promise<void>;
}

export const useSettingsStore = create<SettingsStore>((set, get) => ({
  ...DEFAULT_SETTINGS,
  hydrated: false,

  hydrate: async () => {
    let data: SettingsData = { ...DEFAULT_SETTINGS };

    const cached = await SecureStore.getItemAsync(SETTINGS_STORE_KEY);
    if (cached) {
      try {
        data = { ...DEFAULT_SETTINGS, ...(JSON.parse(cached) as Partial<SettingsData>) };
      } catch {
        // ignore corrupt cache
      }
    }

    set({ ...data, hydrated: true });
  },

  update: async (patch: Partial<SettingsData>) => {
    const current: SettingsData = {
      clarificationMode: get().clarificationMode,
      clarificationTimeoutMinutes: get().clarificationTimeoutMinutes,
      debugEncryptedTraffic: get().debugEncryptedTraffic,
    };

    const updated = { ...current, ...patch };

    // Write to SecureStore
    await SecureStore.setItemAsync(
      SETTINGS_STORE_KEY,
      JSON.stringify(updated)
    );

    // Update store state
    set(updated);

    // Mirror network-mirrored fields to the dispatch server (best-effort)
    const networkPatch: Record<string, unknown> = {};
    for (const key of Object.keys(patch)) {
      if (NETWORK_MIRRORED_FIELDS.has(key)) {
        networkPatch[key] = (patch as Record<string, unknown>)[key];
      }
    }

    if (Object.keys(networkPatch).length > 0) {
      try {
        await (apiClient as unknown as { patch: (path: string, body: unknown) => Promise<unknown> }).patch(
          "/api/settings",
          networkPatch
        );
      } catch {
        // Best-effort — network failure is non-fatal
      }
    }
  },
}));
