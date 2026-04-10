import { create } from "zustand";
import { apiClient } from "../api";
import { subscribeToTask } from "../pocketbase";

export type TaskState =
  | "idle"
  | "input"
  | "clarifying"
  | "working"
  | "deploying"
  | "done"
  | "failed";

export interface QAEntry {
  question: string;
  answer: string;
}

export interface ActiveTask {
  id: string | null;
  state: TaskState;
  request: string;
  idempotencyKey: string;
  qaHistory: QAEntry[];
  question: string | null;
  error: string | null;
}

function generateIdempotencyKey(): string {
  return `idem_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

interface TaskStore {
  activeTask: ActiveTask | null;
  pastTasks: ActiveTask[];
  _unsubscribe: (() => Promise<void>) | null;

  submitTask: (request: string, serverId: string) => Promise<void>;
  answerQuestion: (answer: string, serverId: string) => Promise<void>;
  cancelTask: (serverId: string) => Promise<void>;
  retryTask: (serverId: string) => Promise<void>;
  dismissTask: () => Promise<void>;
  resumeActiveTask: (serverId: string) => Promise<void>;
  _applyServerRecord: (record: Record<string, unknown>) => void;
}

export const useTaskStore = create<TaskStore>((set, get) => ({
  activeTask: null,
  pastTasks: [],
  _unsubscribe: null,

  submitTask: async (request: string, serverId: string) => {
    const idempotencyKey = generateIdempotencyKey();

    // Optimistic: create active task in input state
    set({
      activeTask: {
        id: null,
        state: "input",
        request,
        idempotencyKey,
        qaHistory: [],
        question: null,
        error: null,
      },
    });

    try {
      const result = (await apiClient.post("/api/tasks", {
        request,
        idempotencyKey,
      })) as { id: string; state: string };

      // Subscribe to SSE for this task
      const unsub = await subscribeToTask(
        result.id,
        (record) => {
          get()._applyServerRecord(record as Record<string, unknown>);
        },
        serverId
      );

      set({
        activeTask: {
          id: result.id,
          state: "working",
          request,
          idempotencyKey,
          qaHistory: [],
          question: null,
          error: null,
        },
        _unsubscribe: unsub,
      });
    } catch (err) {
      set({
        activeTask: {
          id: null,
          state: "failed",
          request,
          idempotencyKey,
          qaHistory: get().activeTask?.qaHistory ?? [],
          question: null,
          error: err instanceof Error ? err.message : "Unknown error",
        },
      });
    }
  },

  answerQuestion: async (answer: string, serverId: string) => {
    const { activeTask } = get();
    if (!activeTask || activeTask.state !== "clarifying") return;

    const qa: QAEntry = {
      question: activeTask.question ?? "",
      answer,
    };

    // Optimistic transition to working
    set({
      activeTask: {
        ...activeTask,
        state: "working",
        question: null,
        qaHistory: [...activeTask.qaHistory, qa],
      },
    });

    await apiClient.post(`/api/tasks/${activeTask.id}/answer`, { answer });
  },

  cancelTask: async (serverId: string) => {
    const { activeTask, _unsubscribe } = get();
    if (!activeTask || !activeTask.id) return;

    await apiClient.post(`/api/tasks/${activeTask.id}/cancel`, {});

    // Dismiss after cancel
    if (_unsubscribe) {
      await _unsubscribe();
    }

    const { pastTasks } = get();
    const updated = [activeTask, ...pastTasks].slice(0, 50);

    set({
      activeTask: null,
      pastTasks: updated,
      _unsubscribe: null,
    });
  },

  retryTask: async (serverId: string) => {
    const { activeTask } = get();
    if (!activeTask || activeTask.state !== "failed") return;

    const originalRequest = activeTask.request;
    await get().submitTask(originalRequest, serverId);
  },

  dismissTask: async () => {
    const { activeTask, _unsubscribe, pastTasks } = get();
    if (!activeTask) return;

    if (_unsubscribe) {
      await _unsubscribe();
    }

    const updated = [activeTask, ...pastTasks].slice(0, 50);

    set({
      activeTask: null,
      pastTasks: updated,
      _unsubscribe: null,
    });
  },

  resumeActiveTask: async (serverId: string) => {
    try {
      const result = (await apiClient.get("/api/tasks/active")) as {
        id: string;
        state: string;
        request: string;
        question: string | null;
      } | null;

      if (!result) return;

      const unsub = await subscribeToTask(
        result.id,
        (record) => {
          get()._applyServerRecord(record as Record<string, unknown>);
        },
        serverId
      );

      set({
        activeTask: {
          id: result.id,
          state: result.state as TaskState,
          request: result.request,
          idempotencyKey: generateIdempotencyKey(),
          qaHistory: [],
          question: result.question ?? null,
          error: null,
        },
        _unsubscribe: unsub,
      });
    } catch {
      // No active task or network error — no-op
    }
  },

  _applyServerRecord: (record: Record<string, unknown>) => {
    const { activeTask } = get();
    if (!activeTask) return;

    set({
      activeTask: {
        ...activeTask,
        ...(record.state !== undefined && {
          state: record.state as TaskState,
        }),
        ...(record.question !== undefined && {
          question: record.question as string | null,
        }),
        ...(record.error !== undefined && {
          error: record.error as string | null,
        }),
      },
    });
  },
}));
