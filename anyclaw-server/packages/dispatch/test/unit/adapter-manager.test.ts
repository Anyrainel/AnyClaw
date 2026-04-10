import { describe, it, expect } from "vitest";
import { AdapterManager } from "../../src/adapters/manager.js";
import { NoopResourceLimits } from "../../src/resource-limits/noop.js";
import { TasksRepo } from "../../src/persistence/tasks-repo.js";
import { makeFakePb } from "./helpers/fake-pb.js";
import type { AgentAdapter, TaskStatus, SystemContext, TaskHandle } from "../../src/adapters/types.js";

class MockAdapter implements AgentAdapter {
  readonly name = "Mock";
  script: TaskStatus[] = [];
  dispatched: string[] = [];
  cancelled: string[] = [];

  async healthCheck() {
    return { ok: true };
  }

  async dispatch(taskId: string): Promise<TaskHandle> {
    this.dispatched.push(taskId);
    return { taskId, adapterRef: "a" };
  }

  async *subscribe(): AsyncIterable<TaskStatus> {
    for (const s of this.script) yield s;
  }

  async answerQuestion(): Promise<void> {}

  async cancel(taskId: string): Promise<void> {
    this.cancelled.push(taskId);
  }

  async dispose(): Promise<void> {}
}

const makeMgr = (adapter: AgentAdapter) => {
  const pb = makeFakePb();
  const repo = new TasksRepo(pb as any);
  const worktrees = {
    create: async () => "/tmp/wt",
    mergeAndRemove: async () => {},
    discard: async () => {},
  };
  const mgr = new AdapterManager({
    adapter,
    repo,
    worktrees: worktrees as any,
    resourceLimits: new NoopResourceLimits(),
    config: {
      adapter: "claude-code",
      maxTaskDurationMs: 60_000,
      clarificationTimeoutMs: 10_000,
      clarificationTimeoutMode: "best_judgment",
      maxBudgetUsd: 1,
    },
    buildSystemContext: async (): Promise<SystemContext> => ({
      cwd: "/tmp",
      mcpEndpointUrl: "http://127.0.0.1:4100/mcp",
      mcpBearerToken: "t",
      mcpConfigPath: "/tmp/m.json",
      systemPrompt: "",
      allowedTools: [],
    }),
  });
  return { pb, repo, mgr };
};

describe("AdapterManager", () => {
  it("processQueue dispatches and drives to done", async () => {
    const adapter = new MockAdapter();
    adapter.script = [
      { state: "working", seq: 1, updatedAt: new Date().toISOString() },
      {
        state: "done",
        seq: 2,
        updatedAt: new Date().toISOString(),
        versionDescription: "v1",
      },
    ];
    const { repo, mgr } = makeMgr(adapter);
    await repo.createIfAbsent({
      taskId: "t1",
      request: "r",
      adapterType: "claude-code",
      systemContext: "{}",
      worktreePath: "/tmp/wt",
    });
    // task starts in queued state from createIfAbsent
    await mgr.processQueue();
    expect(adapter.dispatched).toEqual(["t1"]);
    expect((await repo.getByTaskId("t1")).state).toBe("done");
  });

  it("cancel on working task calls adapter.cancel and transitions to cancelled", async () => {
    const adapter = new MockAdapter();
    const { repo, mgr } = makeMgr(adapter);
    await repo.createIfAbsent({
      taskId: "t2",
      request: "r",
      adapterType: "claude-code",
      systemContext: "{}",
      worktreePath: "/tmp/wt",
    });
    await repo.applyTransition("t2", "scheduler_pick", {});
    await mgr.cancel("t2");
    expect(adapter.cancelled).toContain("t2");
    expect((await repo.getByTaskId("t2")).state).toBe("cancelled");
  });
});
