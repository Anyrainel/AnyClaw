import sodium from "libsodium-wrappers";
import { initCrypto, encryptJSON, decryptJSON } from "../crypto";
import type { Envelope } from "../crypto";

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

// Mock crypto-storage
let mockPairingKeys: {
  publicKey: Uint8Array;
  secretKey: Uint8Array;
  serverPublicKey: Uint8Array;
} | null = null;

jest.mock("../crypto-storage", () => ({
  loadPairingKeys: jest.fn(async () => mockPairingKeys),
}));

// Mock fetch
const mockFetch = jest.fn();
global.fetch = mockFetch as unknown as typeof fetch;

import { ApiClient, logBuffer } from "../api";

let serverKp: { publicKey: Uint8Array; privateKey: Uint8Array };
let clientKp: { publicKey: Uint8Array; privateKey: Uint8Array };

beforeAll(async () => {
  await initCrypto();
  serverKp = sodium.crypto_box_keypair();
  clientKp = sodium.crypto_box_keypair();
});

beforeEach(() => {
  for (const key of Object.keys(mockSecureStore)) {
    delete mockSecureStore[key];
  }
  mockFetch.mockReset();
  logBuffer.clear();

  mockPairingKeys = {
    publicKey: clientKp.publicKey,
    secretKey: clientKp.privateKey,
    serverPublicKey: serverKp.publicKey,
  };
});

describe("ApiClient", () => {
  test("post encrypts body and attaches the three expected headers", async () => {
    const client = new ApiClient();
    client.configure({
      baseUrl: "https://example.com/api",
      sessionToken: "tok-123",
      serverId: "srv-1",
    });

    // Mock response: server encrypts a response
    const responseData = { ok: true, id: "task-1" };
    const responseEnvelope = encryptJSON(
      responseData,
      clientKp.publicKey,
      serverKp.privateKey
    );

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => responseEnvelope,
    });

    await client.post("/tasks", { prompt: "hello" });

    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe("https://example.com/api/tasks");
    expect(opts.method).toBe("POST");
    expect(opts.headers["content-type"]).toBe("application/x-nacl-box");
    expect(opts.headers["authorization"]).toBe("Bearer tok-123");
    expect(opts.headers["x-anyclaw-client-pk"]).toBeDefined();

    // Body should be an encrypted envelope (JSON with ciphertext and nonce)
    const body = JSON.parse(opts.body);
    expect(body.ciphertext).toBeDefined();
    expect(body.nonce).toBeDefined();
  });

  test("post decrypts response and returns plaintext typed value", async () => {
    const client = new ApiClient();
    client.configure({
      baseUrl: "https://example.com/api",
      sessionToken: "tok-123",
      serverId: "srv-1",
    });

    const responseData = { status: "created", taskId: "t-42" };
    const responseEnvelope = encryptJSON(
      responseData,
      clientKp.publicKey,
      serverKp.privateKey
    );

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => responseEnvelope,
    });

    const result = await client.post<{ status: string; taskId: string }>(
      "/tasks",
      { prompt: "build something" }
    );

    expect(result.status).toBe("created");
    expect(result.taskId).toBe("t-42");
  });

  test("get returns decrypted response", async () => {
    const client = new ApiClient();
    client.configure({
      baseUrl: "https://example.com/api",
      sessionToken: "tok-123",
      serverId: "srv-1",
    });

    const responseData = { versions: [{ id: "v1" }, { id: "v2" }] };
    const responseEnvelope = encryptJSON(
      responseData,
      clientKp.publicKey,
      serverKp.privateKey
    );

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => responseEnvelope,
    });

    const result = await client.get<{ versions: Array<{ id: string }> }>(
      "/versions"
    );

    expect(result.versions).toHaveLength(2);
    expect(result.versions[0].id).toBe("v1");
  });

  test("HTTP 500 -> throws 'HTTP 500'", async () => {
    const client = new ApiClient();
    client.configure({
      baseUrl: "https://example.com/api",
      sessionToken: "tok-123",
      serverId: "srv-1",
    });

    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
    });

    await expect(client.get("/health")).rejects.toThrow("HTTP 500");
  });

  test("debug mode -> plaintext request and response land in ring buffer; caps at 500", async () => {
    const client = new ApiClient();
    client.configure({
      baseUrl: "https://example.com/api",
      sessionToken: "tok-123",
      serverId: "srv-1",
      debug: true,
    });

    const responseData = { ok: true };
    const responseEnvelope = encryptJSON(
      responseData,
      clientKp.publicKey,
      serverKp.privateKey
    );

    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => responseEnvelope,
    });

    // Make requests to fill the buffer
    for (let i = 0; i < 502; i++) {
      await client.post("/tasks", { i });
    }

    // Buffer should be capped at 500
    expect(logBuffer.entries().length).toBeLessThanOrEqual(500);
    expect(logBuffer.entries().length).toBeGreaterThan(0);
  });

  test("calling post before configure -> throws 'api client not configured'", async () => {
    const client = new ApiClient();

    await expect(
      client.post("/tasks", { prompt: "test" })
    ).rejects.toThrow("api client not configured");
  });
});
