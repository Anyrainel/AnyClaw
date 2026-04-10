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
let mockHealthImpl: () => Promise<unknown> = async () => ({ ok: true });
jest.mock("../../api", () => ({
  apiClient: {
    configure: jest.fn(),
    get: jest.fn((..._args: unknown[]) => mockHealthImpl()),
  },
}));

// Mock broker
let mockRefreshImpl: () => Promise<string> = async () => "new-jwt";
jest.mock("../../broker", () => ({
  refreshBrokerJwt: jest.fn((..._args: unknown[]) => mockRefreshImpl()),
  establishTunnel: jest.fn(async () => ({
    relayUrl: "https://relay.example.com",
    sessionToken: "session-tok",
    pbAuthToken: "pb-tok",
  })),
}));

// Mock pocketbase
jest.mock("../../pocketbase", () => ({
  initPocketBase: jest.fn(),
  _resetForTest: jest.fn(),
}));

import { useConnectionStore } from "../store";

// Helper to reset store between tests
function resetStore() {
  useConnectionStore.setState({
    isAuthenticated: false,
    isConnected: false,
    serverUrl: null,
    sessionToken: null,
    pbAuthToken: null,
    connectionState: "disconnected",
    _backoffAttempt: 0,
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  for (const key of Object.keys(secureStoreData)) {
    delete secureStoreData[key];
  }
  mockHealthImpl = async () => ({ ok: true });
  mockRefreshImpl = async () => "new-jwt";
  resetStore();
});

describe("Connection store", () => {
  test("restoreSession with no JWT -> state unchanged", async () => {
    await useConnectionStore.getState().restoreSession();

    const state = useConnectionStore.getState();
    expect(state.isAuthenticated).toBe(false);
    expect(state.connectionState).toBe("disconnected");
  });

  test("restoreSession with JWT and session -> health check passes -> connected", async () => {
    secureStoreData["broker_jwt"] = "test-jwt";
    secureStoreData["session_token"] = "session-tok";
    secureStoreData["server_url"] = "https://server.example.com";

    await useConnectionStore.getState().restoreSession();

    const state = useConnectionStore.getState();
    expect(state.isAuthenticated).toBe(true);
    expect(state.isConnected).toBe(true);
    expect(state.connectionState).toBe("connected");
  });

  test("restoreSession health check fails -> transitions to reconnecting", async () => {
    secureStoreData["broker_jwt"] = "test-jwt";
    secureStoreData["session_token"] = "session-tok";
    secureStoreData["server_url"] = "https://server.example.com";

    // Health check fails
    mockHealthImpl = async () => {
      throw new Error("HTTP 500");
    };

    // Mock reconnect to resolve quickly (we'll test reconnect separately)
    // The store should transition to reconnecting
    const promise = useConnectionStore.getState().restoreSession();

    // Let the promise settle
    await promise;

    const state = useConnectionStore.getState();
    expect(state.connectionState).toBe("reconnecting");
  });

  test("reconnect delays follow backoff schedule [1000, 2000, 4000, 8000, 16000, 30000, 30000, ...]", async () => {
    // Set up state as if we need to reconnect
    useConnectionStore.setState({
      isAuthenticated: true,
      serverUrl: "https://server.example.com",
      sessionToken: "session-tok",
      connectionState: "reconnecting",
    });

    // Track delay calls
    const delays: number[] = [];
    let healthCallCount = 0;

    // Health fails first 6 times, succeeds on 7th (producing 7 delays)
    mockHealthImpl = async () => {
      healthCallCount++;
      if (healthCallCount <= 6) throw new Error("HTTP 500");
      return { ok: true };
    };

    // Inject a delay function that records but doesn't actually wait
    const result = await useConnectionStore.getState().reconnect((ms) => {
      delays.push(ms);
      return Promise.resolve();
    });

    expect(delays).toEqual([1000, 2000, 4000, 8000, 16000, 30000, 30000]);
  });

  test("reconnect calls refreshBrokerJwt exactly once on attempt 0", async () => {
    const { refreshBrokerJwt } = require("../../broker");

    useConnectionStore.setState({
      isAuthenticated: true,
      serverUrl: "https://server.example.com",
      sessionToken: "session-tok",
      connectionState: "reconnecting",
    });

    let healthCallCount = 0;
    mockHealthImpl = async () => {
      healthCallCount++;
      if (healthCallCount <= 2) throw new Error("HTTP 500");
      return { ok: true };
    };

    await useConnectionStore.getState().reconnect((ms) => Promise.resolve());

    expect(refreshBrokerJwt).toHaveBeenCalledTimes(1);
  });

  test("logout clears all three SecureStore keys and resets state", async () => {
    const SecureStore = require("expo-secure-store");

    secureStoreData["broker_jwt"] = "jwt";
    secureStoreData["session_token"] = "tok";
    secureStoreData["server_url"] = "https://server.example.com";

    useConnectionStore.setState({
      isAuthenticated: true,
      isConnected: true,
      serverUrl: "https://server.example.com",
      sessionToken: "tok",
      connectionState: "connected",
    });

    await useConnectionStore.getState().logout();

    expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith("broker_jwt");
    expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith("session_token");
    expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith("server_url");

    const state = useConnectionStore.getState();
    expect(state.isAuthenticated).toBe(false);
    expect(state.isConnected).toBe(false);
    expect(state.connectionState).toBe("disconnected");
    expect(state.sessionToken).toBeNull();
    expect(state.serverUrl).toBeNull();
  });
});
