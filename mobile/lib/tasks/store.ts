import { create } from "zustand";
import { apiClient } from "../api";
import { subscribeToTask } from "../pocketbase";

export type TaskState =
  | "idle"
  | "input"
  | "queued"
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
  clarificationId?: string | null;
  qaHistory: QAEntry[];
  question: string | null;
  error: string | null;
}

function generateTaskId(): string {
  const randomUUID = globalThis.crypto?.randomUUID;
  if (typeof randomUUID === "function") {
    return randomUUID.call(globalThis.crypto);
  }

  return "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) => {
    const value = Number(c);
    return (
      value ^
      (Math.floor(Math.random() * 256) & (15 >> (value / 4)))
    ).toString(16);
  });
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
    const taskId = generateTaskId();

    // Optimistic: create active task in input state
    set({
      activeTask: {
        id: taskId,
        state: "input",
        request,
        idempotencyKey: taskId,
        clarificationId: null,
        qaHistory: [],
        question: null,
        error: null,
      },
    });

    try {
      const result = (await apiClient.post("/api/tasks", {
        taskId,
        request,
      })) as { taskId: string; state: string; seq: number };

      // Subscribe to SSE for this task
      const unsub = await subscribeToTask(
        result.taskId,
        (record) => {
          get()._applyServerRecord(record as Record<string, unknown>);
        },
        serverId
      );

      set({
        activeTask: {
          id: result.taskId,
          state: result.state as TaskState,
          request,
          idempotencyKey: result.taskId,
          clarificationId: null,
          qaHistory: [],
          question: null,
          error: null,
        },
        _unsubscribe: unsub,
      });
    } catch (err) {
      set({
        activeTask: {
          id: taskId,
          state: "failed",
          request,
          idempotencyKey: taskId,
          clarificationId: null,
          qaHistory: get().activeTask?.qaHistory ?? [],
          question: null,
          error: err instanceof Error ? err.message : "Unknown error",
        },
      });
    }
  },

  answerQuestion: async (answer: string, serverId: string) => {
    const { activeTask } = get();
    if (
      !activeTask ||
      activeTask.state !== "clarifying" ||
      !activeTask.clarificationId
    ) {
      return;
    }

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

    await apiClient.post(`/api/tasks/${activeTask.id}/answer`, {
      clarificationId: activeTask.clarificationId,
      answer,
    });
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
        taskId?: string;
        state: string;
        request: string;
        question: string | null;
        clarificationId?: string | null;
      } | null;

      if (!result) return;

      const unsub = await subscribeToTask(
        result.taskId ?? result.id,
        (record) => {
          get()._applyServerRecord(record as Record<string, unknown>);
        },
        serverId
      );

      set({
        activeTask: {
          id: result.taskId ?? result.id,
          state: result.state as TaskState,
          request: result.request,
          idempotencyKey: result.taskId ?? result.id,
          clarificationId: result.clarificationId ?? null,
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
        ...(record.clarificationId !== undefined && {
          clarificationId: record.clarificationId as string | null,
        }),
        ...(record.error !== undefined && {
          error: record.error as string | null,
        }),
      },
    });
  },
}));
