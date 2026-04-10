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
