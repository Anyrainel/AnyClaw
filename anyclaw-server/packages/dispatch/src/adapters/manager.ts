import {
  isTerminal,
  type AgentAdapter,
  type DispatchConfig,
  type SystemContext,
  type TaskStatus,
} from "./types.js";
import type { TasksRepo } from "../persistence/tasks-repo.js";
import type { ResourceLimits } from "../resource-limits/types.js";

export interface WorktreesLike {
  create(taskId: string): Promise<unknown>;
  mergeAndRemove(taskId: string): Promise<void>;
  discard(taskId: string): Promise<void>;
}

export interface AdapterManagerDeps {
  adapter: AgentAdapter;
  repo: TasksRepo;
  worktrees: WorktreesLike;
  resourceLimits: ResourceLimits;
  config: DispatchConfig;
  buildSystemContext: (taskId: string) => Promise<SystemContext>;
}

export class AdapterManager {
  private running: string | null = null;
  private controllers = new Map<string, AbortController>();

  constructor(private readonly deps: AdapterManagerDeps) {}

  async onStartup(): Promise<void> {
    const swept = await this.deps.repo.sweepOnStartup();
    for (const row of swept) {
      try {
        await this.deps.worktrees.discard(row.taskId);
      } catch {
        // best effort
      }
    }
    // resume of clarifying tasks — see Task 12.
  }

  async processQueue(): Promise<void> {
    if (this.running) return;
    const next = await this.deps.repo.popNextQueued();
    if (!next) return;
    this.running = next.taskId;
    const ctrl = new AbortController();
    this.controllers.set(next.taskId, ctrl);
    const timeout = AbortSignal.timeout(this.deps.config.maxTaskDurationMs);
    const signal = AbortSignal.any([ctrl.signal, timeout]);
    try {
      await this.deps.repo.applyTransition(next.taskId, "scheduler_pick", {});
      const ctx = await this.deps.buildSystemContext(next.taskId);
      await this.deps.adapter.dispatch(next.taskId, next.request, ctx, signal);
      for await (const status of this.deps.adapter.subscribe(
        next.taskId,
        signal,
      )) {
        await this.applyStatus(next.taskId, status);
        if (isTerminal(status.state)) break;
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      try {
        await this.deps.repo.applyTransition(next.taskId, "validation_fail", {
          error: msg,
        });
      } catch {
        // best effort
      }
    } finally {
      this.controllers.delete(next.taskId);
      this.running = null;
      const final = await this.deps.repo.getByTaskId(next.taskId);
      if (final.state === "done") {
        await this.deps.worktrees.mergeAndRemove(next.taskId);
      } else if (final.state === "failed" || final.state === "cancelled") {
        await this.deps.worktrees.discard(next.taskId);
      }
    }
  }

  private async applyStatus(
    taskId: string,
    status: TaskStatus,
  ): Promise<void> {
    switch (status.state) {
      case "working":
        await this.deps.repo.applyTransition(taskId, "progress", {
          progressSummary: status.progressSummary,
        });
        break;
      case "clarifying":
        await this.deps.repo.applyTransition(taskId, "ask_user", {
          question: status.question,
          clarificationId: status.clarificationId,
        });
        break;
      case "deploying":
        await this.deps.repo.applyTransition(taskId, "deploy_called", {});
        break;
      case "done":
        await this.deps.repo.applyTransition(taskId, "validation_pass", {
          versionDescription: status.versionDescription,
        });
        break;
      case "failed":
        await this.deps.repo.applyTransition(taskId, "validation_fail", {
          error: status.error,
        });
        break;
    }
  }

  async cancel(taskId: string): Promise<void> {
    this.controllers.get(taskId)?.abort();
    await this.deps.adapter.cancel(taskId);
    await this.deps.repo.applyTransition(taskId, "cancel", {});
  }
}
