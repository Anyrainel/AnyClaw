import { describe, it, expect } from "vitest";
import { AdapterManager } from "../../src/adapters/manager.js";
import { NoopResourceLimits } from "../../src/resource-limits/noop.js";
import { TasksRepo } from "../../src/persistence/tasks-repo.js";
import { makeFakePb, seedTask } from "./helpers/fake-pb.js";
import type {
  AgentAdapter,
  TaskStatus,
  SystemContext,
  TaskHandle,
} from "../../src/adapters/types.js";
import type { FakePb } from "./helpers/fake-pb.js";

class MockAdapter implements AgentAdapter {
  readonly name = "Mock";
  resumed: string[] = [];
  async healthCheck() {
    return { ok: true };
  }
  async dispatch(taskId: string): Promise<TaskHandle> {
    return { taskId, adapterRef: "a" };
  }
  async *subscribe(): AsyncIterable<TaskStatus> {
    /* empty */
  }
  async answerQuestion(): Promise<void> {}
  async cancel(): Promise<void> {}
  async dispose(): Promise<void> {}
  async resumeTask(taskId: string): Promise<void> {
    this.resumed.push(taskId);
  }
}

const makeMgr = (adapter: AgentAdapter, pb: FakePb) => {
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
  return { repo, mgr };
};

describe("AdapterManager.onStartup", () => {
  it("sweeps working tasks to failed and discards worktrees", async () => {
    const adapter = new MockAdapter();
    const pb = makeFakePb();
    seedTask(pb, "w1", "working");
    const { repo, mgr } = makeMgr(adapter, pb);
    await mgr.onStartup();
    const row = await repo.getByTaskId("w1");
    expect(row.state).toBe("failed");
    expect(row.error).toBe("server_restart");
  });

  it("resumes clarifying task whose clarification is already answered", async () => {
    const adapter = new MockAdapter();
    const pb = makeFakePb();
    // Seed a clarifying task
    seedTask(pb, "c1", "clarifying");
    // Seed an answered clarification for c1
    pb.collection("_task_clarifications").create({
      taskId: "c1",
      clarificationId: "cl-1",
      question: "What color?",
      status: "answered",
      answer: "blue",
    });
    const { mgr } = makeMgr(adapter, pb);
    await mgr.onStartup();
    expect(adapter.resumed).toContain("c1");
  });

  it("leaves clarifying task alone when clarification is still pending", async () => {
    const adapter = new MockAdapter();
    const pb = makeFakePb();
    seedTask(pb, "c2", "clarifying");
    // Seed a pending clarification for c2
    pb.collection("_task_clarifications").create({
      taskId: "c2",
      clarificationId: "cl-2",
      question: "What size?",
      status: "pending",
    });
    const { mgr } = makeMgr(adapter, pb);
    await mgr.onStartup();
    expect(adapter.resumed).not.toContain("c2");
  });

  it("marks clarifying task as failed when adapter lacks resumeTask", async () => {
    // Use adapter without resumeTask
    const adapter: AgentAdapter = {
      name: "NoResume",
      async healthCheck() {
        return { ok: true };
      },
      async dispatch(taskId: string): Promise<TaskHandle> {
        return { taskId, adapterRef: "a" };
      },
      async *subscribe(): AsyncIterable<TaskStatus> {},
      async answerQuestion(): Promise<void> {},
      async cancel(): Promise<void> {},
      async dispose(): Promise<void> {},
    };
    const pb = makeFakePb();
    seedTask(pb, "c3", "clarifying");
    pb.collection("_task_clarifications").create({
      taskId: "c3",
      clarificationId: "cl-3",
      question: "Q?",
      status: "answered",
      answer: "a",
    });
    const { repo, mgr } = makeMgr(adapter, pb);
    await mgr.onStartup();
    const row = await repo.getByTaskId("c3");
    expect(row.state).toBe("failed");
  });
});
