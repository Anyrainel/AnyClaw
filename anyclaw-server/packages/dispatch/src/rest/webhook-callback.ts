import { Router } from "express";
import { z } from "zod";
import type { TasksRepo } from "../persistence/tasks-repo.js";
import type { PocketBaseLike } from "../persistence/tasks-repo.js";

const CallbackBody = z.discriminatedUnion("event", [
  z.object({ taskId: z.string(), event: z.literal("progress"), progressSummary: z.string().optional() }),
  z.object({ taskId: z.string(), event: z.literal("clarifying"), question: z.string(), clarificationId: z.string() }),
  z.object({ taskId: z.string(), event: z.literal("deploying") }),
  z.object({ taskId: z.string(), event: z.literal("done"), description: z.string().optional() }),
  z.object({ taskId: z.string(), event: z.literal("failed"), error: z.string().optional() }),
]);

export interface WebhookCallbackRouterDeps {
  repo: TasksRepo;
  pb: PocketBaseLike;
}

export function webhookCallbackRouter(deps: WebhookCallbackRouterDeps): Router {
  const r = Router();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const deployCol = () => deps.pb.collection("_deployments") as any;

  r.post("/callback", async (req, res, next) => {
    try {
      const parsed = CallbackBody.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: "bad_request", details: parsed.error.flatten() });
        return;
      }
      const data = parsed.data;

      switch (data.event) {
        case "progress":
          await deps.repo.applyTransition(data.taskId, "progress", {
            progressSummary: data.progressSummary,
          });
          break;

        case "clarifying":
          await deps.repo.applyTransition(data.taskId, "ask_user", {
            question: data.question,
            clarificationId: data.clarificationId,
          });
          // Write clarification row
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (deps.pb.collection("_task_clarifications") as any).create({
            taskId: data.taskId,
            clarificationId: data.clarificationId,
            question: data.question,
            status: "pending",
          });
          break;

        case "deploying":
          await deps.repo.applyTransition(data.taskId, "deploy_called", {});
          deployCol().create({
            taskId: data.taskId,
            state: "deploying",
          });
          break;

        case "done":
          await deps.repo.applyTransition(data.taskId, "validation_pass", {
            versionDescription: data.description,
          });
          // Try to update the _deployments row
          try {
            const dep = await deployCol().getFirstListItem(`taskId = "${data.taskId}"`);
            deployCol().update(dep.id, { state: "deployed", description: data.description });
          } catch {
            // No deployment row to update — create one
            deployCol().create({
              taskId: data.taskId,
              state: "deployed",
              description: data.description,
            });
          }
          break;

        case "failed":
          await deps.repo.applyTransition(data.taskId, "validation_fail", {
            error: data.error,
          });
          // Try to update the _deployments row
          try {
            const dep = await deployCol().getFirstListItem(`taskId = "${data.taskId}"`);
            deployCol().update(dep.id, { state: "failed", error: data.error });
          } catch {
            deployCol().create({
              taskId: data.taskId,
              state: "failed",
              error: data.error,
            });
          }
          break;
      }

      res.json({ ok: true });
    } catch (e) {
      next(e);
    }
  });

  return r;
}
