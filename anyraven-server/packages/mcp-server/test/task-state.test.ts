import { describe, it, expect } from "vitest";
import { resumeTasksOnStartup, type TasksRepo } from "../src/task-state.js";

type Row = { id: string; taskId: string; state: string };

function repo(initial: Row[]): TasksRepo & { rows: Row[]; updates: unknown[] } {
  const rows = [...initial];
  const updates: unknown[] = [];
  return {
    rows,
    updates,
    async listActive() {
      return rows.filter((r) =>
        ["queued", "clarifying", "working", "deploying"].includes(r.state),
      ) as any;
    },
    async update(id, patch) {
      updates.push({ id, patch });
      const r = rows.find((x) => x.id === id);
      if (r) Object.assign(r, patch);
    },
    async hasPendingQuestion(_taskId: string) {
      return false;
    },
    async notifyFailure(_taskId: string, _err: string) {
      /* noop */
    },
  };
}

describe("resumeTasksOnStartup", () => {
  it("marks working/deploying tasks as failed with server_restart", async () => {
    const r = repo([
      { id: "a", taskId: "a", state: "working" },
      { id: "b", taskId: "b", state: "deploying" },
      { id: "c", taskId: "c", state: "done" },
    ]);
    await resumeTasksOnStartup(r);
    expect(r.updates).toEqual([
      { id: "a", patch: { state: "failed", error: "server_restart" } },
      { id: "b", patch: { state: "failed", error: "server_restart" } },
    ]);
  });

  it("leaves clarifying tasks alone when question still pending", async () => {
    const base = repo([{ id: "q", taskId: "q", state: "clarifying" }]);
    base.hasPendingQuestion = async () => true;
    await resumeTasksOnStartup(base);
    expect(base.updates).toEqual([]);
  });
});
