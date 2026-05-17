import type PocketBase from "pocketbase";
import { transition, type TaskEvent } from "../lifecycle/state-machine.js";
import type { TaskState } from "../adapters/types.js";

/** Minimal PocketBase-shaped interface for unit testing. */
export interface PocketBaseLike {
  collection(name: string): {
    create(data: Record<string, unknown>): unknown;
    getFirstListItem(filter: string): unknown;
    update(id: string, data: Record<string, unknown>): unknown;
    getFullList(opts?: { filter?: string }): unknown;
  };
}

export interface CreateTaskInput {
  taskId: string;
  request: string;
  adapterType: string;
  systemContext: string;
  worktreePath: string;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export interface TaskRow {
  id: string;
  taskId: string;
  state: TaskState;
  seq: number;
  request: string;
  adapterType: string;
  systemContext: string;
  worktreePath: string;
  error?: string | undefined;
  [key: string]: unknown;
}

export class TasksRepo {
  constructor(private readonly pb: PocketBase | PocketBaseLike) {}

  private col() {
    return this.pb.collection("_tasks") as any;
  }

  /**
   * Insert a _tasks row if no row with this taskId exists yet.
   * Returns the existing or newly created row.
   */
  async createIfAbsent(input: CreateTaskInput): Promise<TaskRow> {
    try {
      const existing = await this.col().getFirstListItem(
        `taskId = "${input.taskId}"`,
      );
      return existing as TaskRow;
    } catch (e: any) {
      if (e?.status !== 404) throw e;
    }
    const row = await this.col().create({
      taskId: input.taskId,
      state: "queued" as TaskState,
      seq: 0,
      request: input.request,
      adapterType: input.adapterType,
      systemContext: input.systemContext,
      worktreePath: input.worktreePath,
    });
    return row as TaskRow;
  }

  /** Read a single _tasks row by taskId, or null if not found. */
  async tryGet(taskId: string): Promise<TaskRow | null> {
    try {
      const row = await this.col().getFirstListItem(`taskId = "${taskId}"`);
      return row as TaskRow;
    } catch (e: any) {
      if (e?.status === 404) return null;
      throw e;
    }
  }

  /**
   * Mark a task as enqueued. For now this is a no-op since createIfAbsent
   * already sets state = "queued". Kept as a hook for future queue logic.
   */
  async enqueue(_taskId: string): Promise<void> {
    // state is already "queued" from createIfAbsent
  }

  /** Write a clarification answer to _task_clarifications. */
  async writeClarificationAnswer(clarificationId: string, answer: string): Promise<void> {
    const col = this.pb.collection("_task_clarifications") as any;
    const row = await col.getFirstListItem(`clarificationId = "${clarificationId}"`);
    await col.update(row.id, { answer, status: "answered" });
  }

  /** List all tasks. */
  async listAll(): Promise<TaskRow[]> {
    return (await this.col().getFullList()) as TaskRow[];
  }

  /** Read a single _tasks row by taskId. Throws if missing. */
  async getByTaskId(taskId: string): Promise<TaskRow> {
    const row = await this.col().getFirstListItem(`taskId = "${taskId}"`);
    return row as TaskRow;
  }

  /**
   * Apply a state-machine event to a task.
   * Validates the transition, bumps seq, and writes extra patch fields.
   */
  async applyTransition(
    taskId: string,
    event: TaskEvent,
    patch: Record<string, unknown>,
  ): Promise<TaskRow> {
    const row = (await this.getByTaskId(taskId)) as TaskRow;
    const nextState = transition(row.state, event);
    const updated = await this.col().update(row.id, {
      state: nextState,
      seq: row.seq + 1,
      ...patch,
    });
    return updated as TaskRow;
  }

  /**
   * Return the oldest _tasks row in state = "queued", or null.
   */
  async popNextQueued(): Promise<TaskRow | null> {
    const rows = (await this.col().getFullList({
      filter: 'state = "queued"',
    })) as TaskRow[];
    if (rows.length === 0) return null;
    // Return the first (oldest) queued row
    return rows[0]!;
  }

  /** List all _tasks rows in a given state. */
  async listByState(state: TaskState): Promise<TaskRow[]> {
    return (await this.col().getFullList({
      filter: `state = "${state}"`,
    })) as TaskRow[];
  }

  /**
   * Check if a task has any pending (unanswered) clarification.
   * Returns true if there is at least one row with status = "pending".
   */
  async hasPendingClarification(taskId: string): Promise<boolean> {
    const rows = (await this.pb
      .collection("_task_clarifications")
      .getFullList({
        filter: `taskId = "${taskId}" && status = "pending"`,
      })) as unknown[];
    return rows.length > 0;
  }

  /** Update the session ID for a task (used by Claude Code adapter). */
  async updateSessionId(taskId: string, sessionId: string): Promise<void> {
    const row = await this.getByTaskId(taskId);
    await this.col().update(row.id, { sessionId });
  }

  /** Read session ID for a task (used for resume). */
  async getSessionId(taskId: string): Promise<string | undefined> {
    const row = await this.getByTaskId(taskId);
    return row.sessionId as string | undefined;
  }

  /**
   * On server startup, sweep tasks stuck in working/deploying
   * (crash recovery per Decision #40).
   */
  async sweepOnStartup(): Promise<TaskRow[]> {
    const stuck = (await this.col().getFullList({
      filter: 'state = "working" || state = "deploying"',
    })) as TaskRow[];
    const swept: TaskRow[] = [];
    for (const row of stuck) {
      const updated = (await this.col().update(row.id, {
        state: "failed" as TaskState,
        seq: row.seq + 1,
        error: "server_restart",
      })) as TaskRow;
      swept.push(updated);
    }
    return swept;
  }
}
