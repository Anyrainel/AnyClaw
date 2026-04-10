import { describe, it, expect, beforeEach } from "vitest";
import { randomUUID } from "crypto";
import express from "express";
import request from "supertest";
import { TasksRepo } from "../../src/persistence/tasks-repo.js";
import { AdapterManager, type WorktreesLike } from "../../src/adapters/manager.js";
import { NoopResourceLimits } from "../../src/resource-limits/noop.js";
import { buildApp } from "../../src/app.js";
import { makeFakePb, type FakePb } from "../unit/helpers/fake-pb.js";
import type {
  AgentAdapter,
  DispatchConfig,
  SystemContext,
  TaskHandle,
  TaskState,
  TaskStatus,
} from "../../src/adapters/types.js";

/* ------------------------------------------------------------------ */
/*  Mock adapter: drives lifecycle via a controllable script           */
/* ------------------------------------------------------------------ */

type ScriptEntry =
  | { state: "working"; progressSummary?: string }
  | { state: "clarifying"; question: string; clarificationId: string }
  | { state: "deploying" }
  | { state: "done"; versionDescription?: string }
  | { state: "failed"; error?: string };

class MockAdapter implements AgentAdapter {
  readonly name = "mock";
  private scripts = new Map<string, ScriptEntry[]>();
  private answerResolvers = new Map<string, (answer: string) => void>();

  /** Pre-configure the status sequence for a taskId. */
  setScript(taskId: string, entries: ScriptEntry[]): void {
    this.scripts.set(taskId, entries);
  }

  async healthCheck() {
    return { ok: true };
  }

  async dispatch(
    taskId: string,
    _request: string,
    _ctx: SystemContext,
    _signal: AbortSignal,
  ): Promise<TaskHandle> {
    return { taskId, adapterRef: `mock-${taskId}` };
  }

  async *subscribe(
    taskId: string,
    signal: AbortSignal,
  ): AsyncIterable<TaskStatus> {
    const script = this.scripts.get(taskId) ?? [];
    let seq = 0;
    for (const entry of script) {
      if (signal.aborted) return;
      seq++;
      if (entry.state === "clarifying") {
        // Yield clarifying status
        yield {
          state: "clarifying",
          seq,
          updatedAt: new Date().toISOString(),
          question: entry.question,
          clarificationId: entry.clarificationId,
        };
        // Wait for the answer OR abort
        await new Promise<string>((resolve) => {
          this.answerResolvers.set(entry.clarificationId, resolve);
          signal.addEventListener("abort", () => resolve("__aborted__"), {
            once: true,
          });
        });
        if (signal.aborted) return;
        // After answer, continue to the next entry
        continue;
      }
      yield {
        state: entry.state as TaskState,
        seq,
        updatedAt: new Date().toISOString(),
        progressSummary:
          entry.state === "working"
            ? (entry as { progressSummary?: string }).progressSummary
            : undefined,
        versionDescription:
          entry.state === "done"
            ? (entry as { versionDescription?: string }).versionDescription
            : undefined,
        error:
          entry.state === "failed"
            ? (entry as { error?: string }).error
            : undefined,
      };
    }
  }

  async answerQuestion(
    _taskId: string,
    clarificationId: string,
    answer: string,
  ): Promise<void> {
    const resolver = this.answerResolvers.get(clarificationId);
    if (resolver) {
      this.answerResolvers.delete(clarificationId);
      resolver(answer);
    }
  }

  async cancel(_taskId: string): Promise<void> {
    // no-op for mock
  }

  async dispose(): Promise<void> {
    // no-op
  }
}

/* ------------------------------------------------------------------ */
/*  Fake WorktreesLike that tracks calls                              */
/* ------------------------------------------------------------------ */

class FakeWorktrees implements WorktreesLike {
  created = new Set<string>();
  merged = new Set<string>();
  discarded = new Set<string>();

  async create(taskId: string): Promise<string> {
    this.created.add(taskId);
    return `/tmp/worktrees/${taskId}`;
  }

  async mergeAndRemove(taskId: string): Promise<void> {
    this.merged.add(taskId);
  }

  async discard(taskId: string): Promise<void> {
    this.discarded.add(taskId);
  }
}

/* ------------------------------------------------------------------ */
/*  Tests                                                             */
/* ------------------------------------------------------------------ */

const AUTH_TOKEN = "t";
const DEFAULT_CONFIG: DispatchConfig = {
  adapter: "claude-code",
  maxTaskDurationMs: 60_000,
  clarificationTimeoutMs: 10_000,
  clarificationTimeoutMode: "best_judgment",
  maxBudgetUsd: 5,
};

describe("end-to-end lifecycle", () => {
  let pb: FakePb;
  let repo: TasksRepo;
  let adapter: MockAdapter;
  let worktrees: FakeWorktrees;
  let manager: AdapterManager;

  function buildTestApp() {
    pb = makeFakePb();
    repo = new TasksRepo(pb);
    adapter = new MockAdapter();
    worktrees = new FakeWorktrees();
    manager = new AdapterManager({
      adapter,
      repo,
      worktrees,
      resourceLimits: new NoopResourceLimits(),
      config: DEFAULT_CONFIG,
      buildSystemContext: async () => ({
        cwd: "/tmp",
        mcpEndpointUrl: "http://localhost/mcp",
        mcpBearerToken: "tok",
        mcpConfigPath: "/tmp/mcp.json",
        systemPrompt: "test",
        allowedTools: [],
      }),
    });

    const app = express();
    app.use(express.json());

    buildApp(app, {
      pb,
      repo,
      manager,
      worktrees: { create: async (taskId) => worktrees.create(taskId) },
      adapter,
      config: DEFAULT_CONFIG,
      authVerify: async (t) => (t === AUTH_TOKEN ? "user-1" : null),
    });

    return app;
  }

  it("walks queued -> working -> clarifying -> working -> deploying -> done", async () => {
    const app = buildTestApp();
    const taskId = randomUUID();
    const clarificationId = randomUUID();

    // Script: working -> clarifying -> working -> deploying -> done
    adapter.setScript(taskId, [
      { state: "working", progressSummary: "analyzing" },
      {
        state: "clarifying",
        question: "which db?",
        clarificationId,
      },
      { state: "working", progressSummary: "building" },
      { state: "deploying" },
      { state: "done", versionDescription: "v1 shipped" },
    ]);

    // Write the clarification row that the repo expects
    pb.collection("_task_clarifications").create({
      taskId,
      clarificationId,
      question: "which db?",
      status: "pending",
    });

    // Create the task directly in the repo (bypassing REST to avoid
    // the background processQueue race)
    await repo.createIfAbsent({
      taskId,
      request: "build the feature",
      adapterType: "claude-code",
      systemContext: "{}",
      worktreePath: `/tmp/worktrees/${taskId}`,
    });

    // Start processQueue in the background; it will block at clarifying
    const queuePromise = manager.processQueue();

    // Give the adapter a tick to reach clarifying state
    await new Promise((r) => setTimeout(r, 50));

    // Verify we're in clarifying state
    const midRow = await repo.getByTaskId(taskId);
    expect(midRow.state).toBe("clarifying");

    // Answer the clarification via REST
    const answerRes = await request(app)
      .post(`/api/tasks/${taskId}/answer`)
      .set("authorization", `Bearer ${AUTH_TOKEN}`)
      .send({ clarificationId, answer: "postgres" });
    expect(answerRes.status).toBe(204);

    // Unblock the adapter
    await adapter.answerQuestion(taskId, clarificationId, "postgres");

    // Wait for processQueue to complete
    await queuePromise;

    // Verify final state
    const finalRow = await repo.getByTaskId(taskId);
    expect(finalRow.state).toBe("done");

    // Verify worktree was merged (done state)
    expect(worktrees.merged.has(taskId)).toBe(true);
  });

  it("failure path discards worktree and sets state to failed", async () => {
    buildTestApp();
    const taskId = randomUUID();

    adapter.setScript(taskId, [
      { state: "working", progressSummary: "analyzing" },
      { state: "failed", error: "build crashed" },
    ]);

    // Create task directly in the repo
    await repo.createIfAbsent({
      taskId,
      request: "build something",
      adapterType: "claude-code",
      systemContext: "{}",
      worktreePath: `/tmp/worktrees/${taskId}`,
    });

    // Process queue
    await manager.processQueue();

    const row = await repo.getByTaskId(taskId);
    expect(row.state).toBe("failed");

    // Verify worktree was discarded
    expect(worktrees.discarded.has(taskId)).toBe(true);
    expect(worktrees.merged.has(taskId)).toBe(false);
  });

  it("cancel mid-working kills adapter and discards worktree", async () => {
    buildTestApp();
    const taskId = randomUUID();
    const clarificationId = randomUUID();

    // Script that blocks on clarification so we can cancel mid-flight
    adapter.setScript(taskId, [
      { state: "working", progressSummary: "analyzing" },
      {
        state: "clarifying",
        question: "which db?",
        clarificationId,
      },
      // The adapter will never reach here because cancel will be called
      { state: "done", versionDescription: "never" },
    ]);

    pb.collection("_task_clarifications").create({
      taskId,
      clarificationId,
      question: "which db?",
      status: "pending",
    });

    // Create task directly in the repo
    await repo.createIfAbsent({
      taskId,
      request: "build something",
      adapterType: "claude-code",
      systemContext: "{}",
      worktreePath: `/tmp/worktrees/${taskId}`,
    });

    // Start processing in background
    const queuePromise = manager.processQueue();

    // Wait for adapter to reach clarifying
    await new Promise((r) => setTimeout(r, 50));

    // Cancel via the manager (the REST endpoint calls this internally)
    await manager.cancel(taskId);

    // Wait for processQueue to finish (the abort signal causes the
    // subscribe generator to exit cleanly)
    await queuePromise;

    const row = await repo.getByTaskId(taskId);
    expect(row.state).toBe("cancelled");

    // Worktree should be discarded
    expect(worktrees.discarded.has(taskId)).toBe(true);
    expect(worktrees.merged.has(taskId)).toBe(false);
  });

  it("startup sweep marks stranded working tasks as failed", async () => {
    buildTestApp();
    // Seed a stranded task
    pb.collection("_tasks").create({
      taskId: "stranded-1",
      state: "working",
      seq: 2,
      request: "old task",
      adapterType: "claude-code",
      systemContext: "{}",
      worktreePath: "/w",
    });

    await manager.onStartup();

    const row = await repo.getByTaskId("stranded-1");
    expect(row.state).toBe("failed");
    // Worktree should have been discarded
    expect(worktrees.discarded.has("stranded-1")).toBe(true);
  });
});
