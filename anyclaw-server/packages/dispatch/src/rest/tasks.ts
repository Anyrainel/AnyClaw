import { Router } from "express";
import { z } from "zod";
import type { TasksRepo } from "../persistence/tasks-repo.js";
import type { AdapterManager } from "../adapters/manager.js";
import { isTerminal, type AgentAdapter } from "../adapters/types.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SubmitBody = z.object({
  taskId: z.string().regex(UUID_RE),
  request: z.string().min(1).max(8000),
});
const AnswerBody = z.object({
  clarificationId: z.string().min(1),
  answer: z.string().min(1).max(8000),
});

export interface TasksRouterDeps {
  repo: TasksRepo;
  manager: Pick<AdapterManager, "cancel" | "processQueue">;
  adapter: Pick<AgentAdapter, "sendMessage">;
  buildSystemContext: (taskId: string) => Promise<unknown>;
  worktrees: { create(taskId: string): Promise<string> };
}

export function tasksRouter(deps: TasksRouterDeps): Router {
  const r = Router();

  r.post("/", async (req, res, next) => {
    try {
      const parsed = SubmitBody.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: "bad_request", details: parsed.error.flatten() });
        return;
      }
      const { taskId, request: taskRequest } = parsed.data;

      const existing = await deps.repo.tryGet(taskId);
      if (existing) {
        res.json({ taskId, state: existing.state, seq: existing.seq });
        return;
      }

      const worktreePath = await deps.worktrees.create(taskId);
      const systemContext = await deps.buildSystemContext(taskId);
      const row = await deps.repo.createIfAbsent({
        taskId,
        request: taskRequest,
        adapterType: "claude-code",
        systemContext: JSON.stringify(systemContext),
        worktreePath,
      });
      await deps.repo.enqueue(taskId);
      deps.manager.processQueue().catch(() => {});
      res.json({ taskId, state: row.state, seq: row.seq });
    } catch (e) {
      next(e);
    }
  });

  r.post("/:taskId/answer", async (req, res, next) => {
    try {
      const parsed = AnswerBody.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: "bad_request" });
        return;
      }
      await deps.repo.writeClarificationAnswer(parsed.data.clarificationId, parsed.data.answer);
      res.status(204).end();
    } catch (e) {
      next(e);
    }
  });

  r.post("/:taskId/cancel", async (req, res, next) => {
    try {
      await deps.manager.cancel(req.params.taskId);
      const row = await deps.repo.getByTaskId(req.params.taskId);
      res.json({ taskId: row.taskId, state: row.state, seq: row.seq });
    } catch (e) {
      next(e);
    }
  });

  r.get("/active", async (_req, res, next) => {
    try {
      const tasks = await deps.repo.listAll();
      const active = tasks
        .filter((task) => !isTerminal(task.state))
        .sort((a, b) =>
          String(b.updated ?? b.created ?? "").localeCompare(
            String(a.updated ?? a.created ?? ""),
          ),
        )[0];
      res.json(active ?? null);
    } catch (e) {
      next(e);
    }
  });

  r.get("/:taskId", async (req, res, next) => {
    try {
      res.json(await deps.repo.getByTaskId(req.params.taskId));
    } catch (e) {
      next(e);
    }
  });

  r.get("/", async (_req, res, next) => {
    try {
      res.json(await deps.repo.listAll());
    } catch (e) {
      next(e);
    }
  });

  r.post("/:taskId/message", async (req, res, next) => {
    try {
      const { message } = z.object({ message: z.string().min(1).max(8000) }).parse(req.body);
      const taskId = req.params.taskId;
      const row = await deps.repo.getByTaskId(taskId);
      if (!row) {
        res.status(404).json({ error: "not_found" });
        return;
      }
      if (!deps.adapter.sendMessage) {
        res.status(501).json({ error: "not_implemented", detail: "Adapter does not support messaging" });
        return;
      }
      await deps.adapter.sendMessage(taskId, message);
      res.status(204).end();
    } catch (e) {
      next(e);
    }
  });

  return r;
}
