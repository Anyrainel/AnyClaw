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

// Mock crypto — use inline fn to avoid hoisting issues
let mockDecryptJSONImpl: (env: unknown, theirPk: unknown, mySk: unknown) => unknown = () => ({});
jest.mock("../crypto", () => ({
  decryptJSON: jest.fn((...args: unknown[]) => mockDecryptJSONImpl(args[0], args[1], args[2])),
}));

// Mock crypto-storage — use inline fn
let mockLoadPairingKeysImpl: () => Promise<unknown> = async () => null;
jest.mock("../crypto-storage", () => ({
  loadPairingKeys: jest.fn((..._args: unknown[]) => mockLoadPairingKeysImpl()),
}));

// Mock PocketBase
const mockSubscribe = jest.fn();
const mockUnsubscribe = jest.fn();
const mockGetOne = jest.fn();

const mockCollection = jest.fn(() => ({
  subscribe: mockSubscribe,
  unsubscribe: mockUnsubscribe,
  getOne: mockGetOne,
}));

jest.mock("pocketbase", () => {
  return jest.fn().mockImplementation(() => ({
    collection: mockCollection,
    authStore: { save: jest.fn() },
  }));
});

import {
  initPocketBase,
  getPocketBase,
  subscribeToTask,
  subscribeToDeployments,
  _resetForTest,
} from "../pocketbase";

const FAKE_KEYS = {
  publicKey: new Uint8Array([1, 2, 3]),
  secretKey: new Uint8Array([4, 5, 6]),
  serverPublicKey: new Uint8Array([7, 8, 9]),
};

beforeEach(() => {
  jest.clearAllMocks();
  _resetForTest();
  mockLoadPairingKeysImpl = async () => FAKE_KEYS;
  mockDecryptJSONImpl = () => ({});
});

describe("PocketBase SSE wrapper", () => {
  test("getPocketBase before initPocketBase throws", () => {
    expect(() => getPocketBase()).toThrow("PocketBase not initialized");
  });

  test("subscribeToTask decrypts the incoming envelope and passes plaintext to callback", async () => {
    initPocketBase("https://relay.example.com", "pb-token-123", "srv-1");

    const decryptedRecord = { id: "task-1", state: "working", prompt: "hello" };
    mockDecryptJSONImpl = () => decryptedRecord;

    mockSubscribe.mockImplementation(
      async (
        topic: string,
        callback: (data: { action: string; record: unknown }) => void
      ) => {
        callback({
          action: "update",
          record: { ciphertext: "abc", nonce: "def" },
        });
      }
    );

    const onUpdate = jest.fn();
    await subscribeToTask("task-1", onUpdate, "srv-1");

    expect(mockCollection).toHaveBeenCalledWith("_tasks");
    expect(onUpdate).toHaveBeenCalledWith(decryptedRecord);
  });

  test("unsubscribe function calls pb.collection.unsubscribe", async () => {
    initPocketBase("https://relay.example.com", "pb-token-123", "srv-1");
    mockSubscribe.mockResolvedValue(undefined);

    const unsub = await subscribeToTask("task-1", jest.fn(), "srv-1");
    await unsub();

    expect(mockUnsubscribe).toHaveBeenCalled();
  });

  test("subscribeToDeployments only fires onDeploy on action === 'create'", async () => {
    initPocketBase("https://relay.example.com", "pb-token-123", "srv-1");

    const decryptedRecord = { id: "dep-1", version: "v2" };
    mockDecryptJSONImpl = () => decryptedRecord;

    mockSubscribe.mockImplementation(
      async (
        topic: string,
        callback: (data: { action: string; record: unknown }) => void
      ) => {
        callback({
          action: "create",
          record: { ciphertext: "abc", nonce: "def" },
        });
        callback({
          action: "update",
          record: { ciphertext: "ghi", nonce: "jkl" },
        });
      }
    );

    const onDeploy = jest.fn();
    await subscribeToDeployments(onDeploy, "srv-1");

    expect(onDeploy).toHaveBeenCalledTimes(1);
    expect(onDeploy).toHaveBeenCalledWith(decryptedRecord);
  });

  test("SSE error triggers reconnectPolicy that refetches via REST", async () => {
    initPocketBase("https://relay.example.com", "pb-token-123", "srv-1");

    const decryptedRecord = { id: "task-1", state: "working" };
    mockDecryptJSONImpl = () => decryptedRecord;
    mockGetOne.mockResolvedValue({ ciphertext: "abc", nonce: "def" });

    let errorCallback: ((err: unknown) => void) | null = null;
    mockSubscribe.mockImplementation(
      async (
        topic: string,
        callback: (data: { action: string; record: unknown }) => void,
        options?: { filter?: string; onerror?: (err: unknown) => void }
      ) => {
        if (options?.onerror) {
          errorCallback = options.onerror;
        }
      }
    );

    const onUpdate = jest.fn();
    await subscribeToTask("task-1", onUpdate, "srv-1");

    expect(errorCallback).not.toBeNull();
    await (errorCallback as unknown as (err: unknown) => Promise<void>)(
      new Error("connection lost")
    );

    expect(mockGetOne).toHaveBeenCalledWith("task-1");
    expect(onUpdate).toHaveBeenCalledWith(decryptedRecord);
  });
});
