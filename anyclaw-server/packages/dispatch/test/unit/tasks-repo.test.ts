import { describe, it, expect, beforeEach } from "vitest";
import { TasksRepo } from "../../src/persistence/tasks-repo.js";
import { makeFakePb, seedTask } from "./helpers/fake-pb.js";
import type { FakePb } from "./helpers/fake-pb.js";

describe("TasksRepo", () => {
  let pb: FakePb;
  let repo: TasksRepo;
  beforeEach(() => {
    pb = makeFakePb();
    repo = new TasksRepo(pb as any);
  });

  it("createIfAbsent returns existing row without duplicating", async () => {
    const a = await repo.createIfAbsent({
      taskId: "u1",
      request: "r",
      adapterType: "claude-code",
      systemContext: "{}",
      worktreePath: "/w",
    });
    const b = await repo.createIfAbsent({
      taskId: "u1",
      request: "r",
      adapterType: "claude-code",
      systemContext: "{}",
      worktreePath: "/w",
    });
    expect(a.id).toBe(b.id);
    expect((await pb.collection("_tasks").getFullList()).length).toBe(1);
  });

  it("applyTransition validates against state machine and bumps seq", async () => {
    await repo.createIfAbsent({
      taskId: "u2",
      request: "r",
      adapterType: "claude-code",
      systemContext: "{}",
      worktreePath: "/w",
    });
    await repo.applyTransition("u2", "scheduler_pick", {});
    const row = await repo.getByTaskId("u2");
    expect(row.state).toBe("working");
    expect(row.seq).toBe(1);
  });

  it("applyTransition rejects illegal transitions", async () => {
    await repo.createIfAbsent({
      taskId: "u3",
      request: "r",
      adapterType: "claude-code",
      systemContext: "{}",
      worktreePath: "/w",
    });
    await expect(
      repo.applyTransition("u3", "answer", {}),
    ).rejects.toThrow(/illegal/);
  });

  it("sweepOnStartup moves working/deploying to failed", async () => {
    seedTask(pb, "a", "working");
    seedTask(pb, "b", "deploying");
    seedTask(pb, "c", "clarifying");
    const swept = await repo.sweepOnStartup();
    expect(swept.map((s) => s.taskId).sort()).toEqual(["a", "b"]);
    expect((await repo.getByTaskId("c")).state).toBe("clarifying");
  });

  it("sweepOnStartup bumps seq for swept rows", async () => {
    seedTask(pb, "x", "working");
    await repo.sweepOnStartup();
    const row = await repo.getByTaskId("x");
    expect(row.state).toBe("failed");
    expect(row.seq).toBe(1);
    expect(row.error).toBe("server_restart");
  });
});
