export type TaskRow = {
  id: string;
  taskId: string;
  state:
    | "queued"
    | "clarifying"
    | "working"
    | "deploying"
    | "done"
    | "failed"
    | "cancelled";
};

export type TasksRepo = {
  listActive(): Promise<TaskRow[]>;
  update(
    id: string,
    patch: Partial<TaskRow> & { error?: string },
  ): Promise<void>;
  hasPendingQuestion(taskId: string): Promise<boolean>;
  notifyFailure(taskId: string, error: string): Promise<void>;
};

/**
 * Decision #40 exactly-once with crash recovery:
 * - working/deploying → failed(server_restart)
 * - queued/clarifying → left for dispatcher to re-spawn (we cannot tell if a question is
 *   still pending without checking _agent_messages).
 */
export async function resumeTasksOnStartup(repo: TasksRepo): Promise<void> {
  const active = await repo.listActive();
  for (const row of active) {
    if (row.state === "working" || row.state === "deploying") {
      await repo.update(row.id, { state: "failed", error: "server_restart" });
      await repo.notifyFailure(row.taskId, "server_restart");
    }
    // queued / clarifying: leave for dispatcher. If a question is pending we simply
    // do nothing; the dispatcher will re-subscribe via anyraven_ask_user resume.
  }
}

/** Concrete PocketBase-backed repo used by the dispatch process. */
export function pocketBaseTasksRepo(
  pb: import("pocketbase").default,
): TasksRepo {
  return {
    async listActive() {
      const rows = await pb.collection("_tasks").getFullList({
        filter: `state = "queued" || state = "clarifying" || state = "working" || state = "deploying"`,
      });
      return rows.map((r: any) => ({
        id: r.id,
        taskId: r.taskId,
        state: r.state,
      }));
    },
    async update(id, patch) {
      await pb.collection("_tasks").update(id, patch);
    },
    async hasPendingQuestion(taskId) {
      const q = await pb.collection("_agent_messages").getList(1, 1, {
        filter: `taskId = "${taskId}" && type = "question"`,
        sort: "-created",
      });
      if (q.items.length === 0) return false;
      const qid = q.items[0]!.id;
      const a = await pb.collection("_agent_messages").getList(1, 1, {
        filter: `questionId = "${qid}" && type = "answer"`,
      });
      return a.items.length === 0;
    },
    async notifyFailure(taskId, error) {
      await pb.collection("_agent_messages").create({
        taskId,
        direction: "agent_to_user",
        type: "progress",
        content: `Task failed during resume: ${error}`,
        phase: "working",
      });
    },
  };
}
