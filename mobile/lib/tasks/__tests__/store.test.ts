// Mock expo-secure-store
jest.mock("expo-secure-store", () => ({
  setItemAsync: jest.fn(),
  getItemAsync: jest.fn(async () => null),
  deleteItemAsync: jest.fn(),
}));

// Mock apiClient
let mockPostImpl: (path: string, body: unknown) => Promise<unknown> = async () => ({});
let mockGetImpl: (path: string) => Promise<unknown> = async () => ({});
jest.mock("../../api", () => ({
  apiClient: {
    configure: jest.fn(),
    post: jest.fn((...args: unknown[]) => mockPostImpl(args[0] as string, args[1])),
    get: jest.fn((...args: unknown[]) => mockGetImpl(args[0] as string)),
  },
}));

// Mock pocketbase subscriptions
let mockSubscribeToTaskImpl: (
  taskId: string,
  onUpdate: (record: unknown) => void,
  serverId: string
) => Promise<() => Promise<void>> = async () => async () => {};

jest.mock("../../pocketbase", () => ({
  subscribeToTask: jest.fn((...args: unknown[]) =>
    mockSubscribeToTaskImpl(
      args[0] as string,
      args[1] as (mockRec: unknown) => void,
      args[2] as string
    )
  ),
  initPocketBase: jest.fn(),
  _resetForTest: jest.fn(),
}));

// Mock crypto
jest.mock("../../crypto", () => ({
  initCrypto: jest.fn(),
}));

jest.mock("../../crypto-storage", () => ({
  loadPairingKeys: jest.fn(async () => null),
}));

import { useTaskStore, type TaskState } from "../store";

function resetStore() {
  useTaskStore.setState({
    activeTask: null,
    pastTasks: [],
    _unsubscribe: null,
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockPostImpl = async () => ({});
  mockGetImpl = async () => ({});
  mockSubscribeToTaskImpl = async () => async () => {};
  resetStore();
});

describe("Task store", () => {
  test("submitTask success: optimistic input -> working, subscription installed, idempotency key sent", async () => {
    const mockUnsub = jest.fn();
    mockSubscribeToTaskImpl = async (_id, _onUpdate, _serverId) => {
      return async () => { mockUnsub(); };
    };

    mockPostImpl = async (_path, body) => {
      // Verify idempotency key is sent
      expect((body as Record<string, unknown>).idempotencyKey).toBeDefined();
      return { id: "task-1", state: "working" };
    };

    await useTaskStore.getState().submitTask("Build a landing page", "srv-1");

    const state = useTaskStore.getState();
    expect(state.activeTask).not.toBeNull();
    expect(state.activeTask!.state).toBe("working");
    expect(state.activeTask!.request).toBe("Build a landing page");
    expect(state.activeTask!.idempotencyKey).toBeDefined();
    // Subscription should be installed (unsub function stored)
    expect(state._unsubscribe).not.toBeNull();
  });

  test("submitTask failure: state becomes failed with error message, no subscription", async () => {
    mockPostImpl = async () => {
      throw new Error("HTTP 500");
    };
    mockSubscribeToTaskImpl = async () => {
      throw new Error("should not subscribe on failure");
    };

    await useTaskStore.getState().submitTask("Build something", "srv-1");

    const state = useTaskStore.getState();
    expect(state.activeTask).not.toBeNull();
    expect(state.activeTask!.state).toBe("failed");
    expect(state.activeTask!.error).toBe("HTTP 500");
    expect(state._unsubscribe).toBeNull();
  });

  test("answerQuestion in wrong state is a no-op", async () => {
    // Set activeTask in 'working' state (not 'clarifying')
    useTaskStore.setState({
      activeTask: {
        id: "task-1",
        state: "working",
        request: "test",
        idempotencyKey: "key-1",
        qaHistory: [],
        question: null,
        error: null,
      },
    });

    await useTaskStore.getState().answerQuestion("my answer", "srv-1");

    // State should not have changed
    const state = useTaskStore.getState();
    expect(state.activeTask!.state).toBe("working");
    expect(state.activeTask!.qaHistory).toHaveLength(0);
  });

  test("answerQuestion appends to qaHistory, clears question, transitions to working", async () => {
    mockPostImpl = async () => ({ ok: true });

    useTaskStore.setState({
      activeTask: {
        id: "task-1",
        state: "clarifying",
        request: "test",
        idempotencyKey: "key-1",
        qaHistory: [],
        question: "What color?",
        error: null,
      },
    });

    await useTaskStore.getState().answerQuestion("Blue", "srv-1");

    const state = useTaskStore.getState();
    expect(state.activeTask!.state).toBe("working");
    expect(state.activeTask!.question).toBeNull();
    expect(state.activeTask!.qaHistory).toEqual([
      { question: "What color?", answer: "Blue" },
    ]);

    // Verify API was called
    const { apiClient } = require("../../api");
    expect(apiClient.post).toHaveBeenCalledWith(
      "/api/tasks/task-1/answer",
      { answer: "Blue" }
    );
  });

  test("_applyServerRecord with state clarifying and question updates the store", () => {
    useTaskStore.setState({
      activeTask: {
        id: "task-1",
        state: "working",
        request: "test",
        idempotencyKey: "key-1",
        qaHistory: [],
        question: null,
        error: null,
      },
    });

    useTaskStore.getState()._applyServerRecord({
      id: "task-1",
      state: "clarifying",
      question: "Which framework?",
    });

    const state = useTaskStore.getState();
    expect(state.activeTask!.state).toBe("clarifying");
    expect(state.activeTask!.question).toBe("Which framework?");
  });

  test("dismissTask unsubscribes and pushes to pastTasks capped at 50", async () => {
    const mockUnsub = jest.fn();

    // Fill pastTasks to 49
    const pastTasks = Array.from({ length: 49 }, (_, i) => ({
      id: `past-${i}`,
      state: "done" as TaskState,
      request: `past task ${i}`,
      idempotencyKey: `key-${i}`,
      qaHistory: [],
      question: null,
      error: null,
    }));

    useTaskStore.setState({
      activeTask: {
        id: "task-current",
        state: "done",
        request: "current task",
        idempotencyKey: "key-current",
        qaHistory: [],
        question: null,
        error: null,
      },
      pastTasks,
      _unsubscribe: async () => { mockUnsub(); },
    });

    await useTaskStore.getState().dismissTask();

    const state = useTaskStore.getState();
    expect(state.activeTask).toBeNull();
    expect(state._unsubscribe).toBeNull();
    expect(mockUnsub).toHaveBeenCalled();
    expect(state.pastTasks).toHaveLength(50);
    expect(state.pastTasks[0].id).toBe("task-current");

    // Add one more to verify cap
    useTaskStore.setState({
      activeTask: {
        id: "task-overflow",
        state: "done",
        request: "overflow task",
        idempotencyKey: "key-overflow",
        qaHistory: [],
        question: null,
        error: null,
      },
    });

    await useTaskStore.getState().dismissTask();
    expect(useTaskStore.getState().pastTasks).toHaveLength(50);
  });

  test("retryTask only runs from failed, reuses original request", async () => {
    mockPostImpl = async () => ({ id: "task-2", state: "working" });
    mockSubscribeToTaskImpl = async () => async () => {};

    useTaskStore.setState({
      activeTask: {
        id: "task-1",
        state: "failed",
        request: "Build a dashboard",
        idempotencyKey: "key-1",
        qaHistory: [],
        question: null,
        error: "HTTP 500",
      },
    });

    await useTaskStore.getState().retryTask("srv-1");

    const state = useTaskStore.getState();
    expect(state.activeTask!.state).toBe("working");
    expect(state.activeTask!.request).toBe("Build a dashboard");
    // New idempotency key
    expect(state.activeTask!.idempotencyKey).not.toBe("key-1");

    // Test no-op when not failed
    useTaskStore.setState({
      activeTask: {
        id: "task-2",
        state: "working",
        request: "test",
        idempotencyKey: "key-2",
        qaHistory: [],
        question: null,
        error: null,
      },
    });

    const prevKey = useTaskStore.getState().activeTask!.idempotencyKey;
    await useTaskStore.getState().retryTask("srv-1");
    expect(useTaskStore.getState().activeTask!.idempotencyKey).toBe(prevKey);
  });

  test("resumeActiveTask fetches newest non-terminal task and re-subscribes; no-op if none found", async () => {
    const mockUnsub = jest.fn();
    mockSubscribeToTaskImpl = async () => async () => { mockUnsub(); };

    // Mock GET to return a task
    mockGetImpl = async (path) => {
      if (path === "/api/tasks/active") {
        return {
          id: "task-99",
          state: "working",
          request: "Existing task",
          question: null,
        };
      }
      return {};
    };

    await useTaskStore.getState().resumeActiveTask("srv-1");

    const state = useTaskStore.getState();
    expect(state.activeTask).not.toBeNull();
    expect(state.activeTask!.id).toBe("task-99");
    expect(state.activeTask!.state).toBe("working");
    expect(state._unsubscribe).not.toBeNull();

    // Test no-op when no active task
    resetStore();
    mockGetImpl = async () => null;

    await useTaskStore.getState().resumeActiveTask("srv-1");
    expect(useTaskStore.getState().activeTask).toBeNull();
  });

  test("cancelTask posts to cancel endpoint then dismisses", async () => {
    const mockUnsub = jest.fn();
    mockPostImpl = async () => ({ ok: true });

    useTaskStore.setState({
      activeTask: {
        id: "task-1",
        state: "working",
        request: "test",
        idempotencyKey: "key-1",
        qaHistory: [],
        question: null,
        error: null,
      },
      _unsubscribe: async () => { mockUnsub(); },
    });

    await useTaskStore.getState().cancelTask("srv-1");

    const { apiClient } = require("../../api");
    expect(apiClient.post).toHaveBeenCalledWith(
      "/api/tasks/task-1/cancel",
      {}
    );

    const state = useTaskStore.getState();
    expect(state.activeTask).toBeNull();
    expect(mockUnsub).toHaveBeenCalled();
  });
});
