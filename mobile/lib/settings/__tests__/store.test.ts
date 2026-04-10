// Mock expo-secure-store
const secureStoreData: Record<string, string> = {};
jest.mock("expo-secure-store", () => ({
  setItemAsync: jest.fn(async (key: string, value: string) => {
    secureStoreData[key] = value;
  }),
  getItemAsync: jest.fn(async (key: string) => secureStoreData[key] ?? null),
  deleteItemAsync: jest.fn(async (key: string) => {
    delete secureStoreData[key];
  }),
}));

// Mock apiClient
let mockGetImpl: (path: string) => Promise<unknown> = async () => ({});
let mockPostImpl: (path: string, body: unknown) => Promise<unknown> = async () => ({});
jest.mock("../../api", () => ({
  apiClient: {
    configure: jest.fn(),
    get: jest.fn((...args: unknown[]) => mockGetImpl(args[0] as string)),
    post: jest.fn((...args: unknown[]) => mockPostImpl(args[0] as string, args[1])),
    patch: jest.fn((...args: unknown[]) => mockPostImpl(args[0] as string, args[1])),
  },
}));

// Mock crypto modules
jest.mock("../../crypto", () => ({}));
jest.mock("../../crypto-storage", () => ({ loadPairingKeys: jest.fn() }));

import { useSettingsStore, type ClarificationMode, SETTINGS_STORE_KEY } from "../store";

function resetStore() {
  useSettingsStore.setState({
    clarificationMode: "auto-timeout",
    clarificationTimeoutMinutes: 5,
    debugEncryptedTraffic: false,
    hydrated: false,
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  for (const key of Object.keys(secureStoreData)) {
    delete secureStoreData[key];
  }
  mockGetImpl = async () => ({});
  mockPostImpl = async () => ({});
  resetStore();
});

describe("Settings store", () => {
  test("hydrate loads from SecureStore", async () => {
    secureStoreData[SETTINGS_STORE_KEY] = JSON.stringify({
      clarificationMode: "pause-indefinitely",
      clarificationTimeoutMinutes: 10,
      debugEncryptedTraffic: true,
    });

    await useSettingsStore.getState().hydrate();

    const state = useSettingsStore.getState();
    expect(state.clarificationMode).toBe("pause-indefinitely");
    expect(state.clarificationTimeoutMinutes).toBe(10);
    expect(state.debugEncryptedTraffic).toBe(true);
    expect(state.hydrated).toBe(true);
  });

  test("update clarificationMode writes SecureStore and mirrors to host via PATCH /api/settings", async () => {
    const SecureStore = require("expo-secure-store");

    await useSettingsStore
      .getState()
      .update({ clarificationMode: "pause-indefinitely" as ClarificationMode });

    // Verify SecureStore was written
    expect(SecureStore.setItemAsync).toHaveBeenCalledWith(
      SETTINGS_STORE_KEY,
      expect.any(String)
    );

    const stored = JSON.parse(
      secureStoreData[SETTINGS_STORE_KEY]
    );
    expect(stored.clarificationMode).toBe("pause-indefinitely");

    // Verify network mirror was called
    const { apiClient } = require("../../api");
    expect(apiClient.patch).toHaveBeenCalledWith("/api/settings", {
      clarificationMode: "pause-indefinitely",
    });

    // Verify store state
    const state = useSettingsStore.getState();
    expect(state.clarificationMode).toBe("pause-indefinitely");
  });

  test("update debugEncryptedTraffic writes SecureStore but does NOT hit the network", async () => {
    const { apiClient } = require("../../api");

    await useSettingsStore.getState().update({ debugEncryptedTraffic: true });

    // Verify SecureStore was written
    const stored = JSON.parse(secureStoreData[SETTINGS_STORE_KEY]);
    expect(stored.debugEncryptedTraffic).toBe(true);

    // Verify NO network call was made
    expect(apiClient.patch).not.toHaveBeenCalled();
    expect(apiClient.post).not.toHaveBeenCalled();

    // Verify store state
    expect(useSettingsStore.getState().debugEncryptedTraffic).toBe(true);
  });

  test("mirror network failure does not throw (best-effort)", async () => {
    mockPostImpl = async () => {
      throw new Error("Network error");
    };

    // Should not throw
    await useSettingsStore
      .getState()
      .update({ clarificationMode: "pause-indefinitely" as ClarificationMode });

    // State should still be updated
    expect(useSettingsStore.getState().clarificationMode).toBe(
      "pause-indefinitely"
    );
  });
});
