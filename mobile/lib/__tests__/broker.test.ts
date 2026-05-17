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

// Mock expo-auth-session
const mockAuthRequest = {
  promptAsync: jest.fn(),
};
jest.mock("expo-auth-session", () => ({
  AuthRequest: jest.fn().mockImplementation(() => mockAuthRequest),
  makeRedirectUri: jest.fn(() => "anyraven://auth"),
}));

// Mock expo-web-browser
jest.mock("expo-web-browser", () => ({
  maybeCompleteAuthSession: jest.fn(),
}));

// Mock global fetch
const mockFetch = jest.fn();
global.fetch = mockFetch as unknown as typeof fetch;

import {
  loginWithProvider,
  refreshBrokerJwt,
  fetchServers,
  requestPairing,
} from "../broker";

beforeEach(() => {
  for (const key of Object.keys(mockSecureStore)) {
    delete mockSecureStore[key];
  }
  jest.clearAllMocks();
});

describe("broker", () => {
  test("loginWithProvider('google') success -> SecureStore has both tokens", async () => {
    mockAuthRequest.promptAsync.mockResolvedValueOnce({
      type: "success",
      params: { code: "auth-code-123" },
    });

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        access_token: "jwt-abc",
        refresh_token: "refresh-xyz",
      }),
    });

    await loginWithProvider("google");

    expect(mockSecureStore["broker_jwt"]).toBe("jwt-abc");
    expect(mockSecureStore["broker_refresh"]).toBe("refresh-xyz");
  });

  test("loginWithProvider cancelled -> throws and does not touch SecureStore", async () => {
    mockAuthRequest.promptAsync.mockResolvedValueOnce({
      type: "cancel",
    });

    await expect(loginWithProvider("google")).rejects.toThrow("OAuth cancelled");
    expect(mockSecureStore["broker_jwt"]).toBeUndefined();
    expect(mockSecureStore["broker_refresh"]).toBeUndefined();
  });

  test("refreshBrokerJwt with no refresh token -> throws", async () => {
    await expect(refreshBrokerJwt()).rejects.toThrow();
  });

  test("refreshBrokerJwt on 401 -> throws 'Refresh failed'", async () => {
    mockSecureStore["broker_refresh"] = "old-refresh";

    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
    });

    await expect(refreshBrokerJwt()).rejects.toThrow("Refresh failed");
  });

  test("fetchServers 401 then 200 -> single refresh, then retry succeeds", async () => {
    mockSecureStore["broker_jwt"] = "expired-jwt";
    mockSecureStore["broker_refresh"] = "valid-refresh";

    // First call: 401
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
    });

    // Refresh call: success
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        access_token: "new-jwt",
        refresh_token: "new-refresh",
      }),
    });

    // Retry: success
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ servers: [{ id: "s1", name: "My Server" }] }),
    });

    const result = await fetchServers();
    expect(result.servers).toHaveLength(1);
    expect(mockSecureStore["broker_jwt"]).toBe("new-jwt");
  });

  test("fetchServers 401 then 401 -> throws", async () => {
    mockSecureStore["broker_jwt"] = "expired-jwt";
    mockSecureStore["broker_refresh"] = "bad-refresh";

    // First call: 401
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
    });

    // Refresh call: 401
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
    });

    await expect(fetchServers()).rejects.toThrow("Refresh failed");
  });

  test("requestPairing correctly base64-encodes client pk and base64-decodes response", async () => {
    mockSecureStore["broker_jwt"] = "valid-jwt";

    const clientPk = new Uint8Array(32);
    for (let i = 0; i < 32; i++) clientPk[i] = i;

    const serverPkBase64 = Buffer.from(
      new Uint8Array(32).fill(0xab)
    ).toString("base64");

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ serverPublicKey: serverPkBase64 }),
    });

    const result = await requestPairing("server-1", clientPk);

    // Verify the request body had base64-encoded client key
    const callArgs = mockFetch.mock.calls[0];
    const body = JSON.parse(callArgs[1].body);
    expect(body.clientPublicKey).toBe(
      Buffer.from(clientPk).toString("base64")
    );

    // Verify the returned serverPublicKey is a Uint8Array
    expect(result.serverPublicKey).toBeInstanceOf(Uint8Array);
    expect(result.serverPublicKey.length).toBe(32);
    expect(result.serverPublicKey[0]).toBe(0xab);
  });
});
