// Mock expo-secure-store
jest.mock("expo-secure-store", () => ({
  setItemAsync: jest.fn(),
  getItemAsync: jest.fn(async () => null),
  deleteItemAsync: jest.fn(),
}));

// Mock apiClient
let mockGetImpl: (path: string) => Promise<unknown> = async () => ({});
let mockPostImpl: (path: string, body: unknown) => Promise<unknown> = async () => ({});
jest.mock("../../api", () => ({
  apiClient: {
    configure: jest.fn(),
    get: jest.fn((...args: unknown[]) => mockGetImpl(args[0] as string)),
    post: jest.fn((...args: unknown[]) => mockPostImpl(args[0] as string, args[1])),
  },
}));

// Mock crypto modules to avoid transitive import issues
jest.mock("../../crypto", () => ({}));
jest.mock("../../crypto-storage", () => ({ loadPairingKeys: jest.fn() }));

import { useVersionsStore } from "../store";

function resetStore() {
  useVersionsStore.setState({
    versions: [],
    isLoading: false,
    error: null,
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockGetImpl = async () => ({});
  mockPostImpl = async () => ({});
  resetStore();
});

describe("Versions store", () => {
  test("fetchVersions success populates versions and clears error", async () => {
    const mockVersions = [
      { id: "v1", label: "1.0.0", createdAt: "2026-01-01" },
      { id: "v2", label: "1.1.0", createdAt: "2026-02-01" },
    ];

    mockGetImpl = async (path) => {
      if (path === "/api/versions") return { versions: mockVersions };
      return {};
    };

    // Set a pre-existing error to verify it gets cleared
    useVersionsStore.setState({ error: "old error" });

    await useVersionsStore.getState().fetchVersions();

    const state = useVersionsStore.getState();
    expect(state.versions).toEqual(mockVersions);
    expect(state.error).toBeNull();
    expect(state.isLoading).toBe(false);
  });

  test("fetchVersions failure sets error and clears isLoading", async () => {
    mockGetImpl = async () => {
      throw new Error("HTTP 500");
    };

    await useVersionsStore.getState().fetchVersions();

    const state = useVersionsStore.getState();
    expect(state.error).toBe("HTTP 500");
    expect(state.isLoading).toBe(false);
  });

  test("rollbackTo posts then refetches", async () => {
    const mockVersions = [
      { id: "v1", label: "1.0.0", createdAt: "2026-01-01" },
    ];

    mockPostImpl = async (path, body) => {
      expect(path).toBe("/api/rollback");
      expect(body).toEqual({ versionId: "v1" });
      return { ok: true };
    };

    mockGetImpl = async (path) => {
      if (path === "/api/versions") return { versions: mockVersions };
      return {};
    };

    await useVersionsStore.getState().rollbackTo("v1");

    const state = useVersionsStore.getState();
    expect(state.versions).toEqual(mockVersions);

    const { apiClient } = require("../../api");
    expect(apiClient.post).toHaveBeenCalledWith("/api/rollback", {
      versionId: "v1",
    });
  });

  test("rollbackTo error propagates", async () => {
    mockPostImpl = async () => {
      throw new Error("Rollback failed");
    };

    await expect(
      useVersionsStore.getState().rollbackTo("v1")
    ).rejects.toThrow("Rollback failed");
  });
});
