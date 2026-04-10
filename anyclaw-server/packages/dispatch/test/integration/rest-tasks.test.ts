import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import { randomUUID } from "crypto";
import express, { type Express } from "express";
import { authRequired } from "../../src/rest/auth.js";
import { tasksRouter, type TasksRouterDeps } from "../../src/rest/tasks.js";
import { TasksRepo } from "../../src/persistence/tasks-repo.js";
import { makeFakePb, type FakePb } from "../unit/helpers/fake-pb.js";

let app: Express;
let pb: FakePb;
let repo: TasksRepo;
let cancelledIds: string[];

const AUTH_TOKEN = "t";

function buildTestApp() {
  pb = makeFakePb();
  repo = new TasksRepo(pb);
  cancelledIds = [];

  const deps: TasksRouterDeps = {
    repo,
    manager: {
      cancel: async (taskId: string) => { cancelledIds.push(taskId); },
      processQueue: async () => {},
    } as unknown as TasksRouterDeps["manager"],
    buildSystemContext: async () => ({}),
    worktrees: { create: async () => "/tmp/wt" },
  };

  const a = express();
  a.use(express.json());
  a.use(
    "/api/tasks",
    authRequired({ verify: async (t) => (t === AUTH_TOKEN ? "user-1" : null) }),
    tasksRouter(deps),
  );
  return a;
}

describe("REST /api/tasks", () => {
  beforeEach(() => {
    app = buildTestApp();
  });

  it("POST /api/tasks with new UUID returns queued", async () => {
    const taskId = randomUUID();
    const res = await request(app)
      .post("/api/tasks")
      .set("authorization", `Bearer ${AUTH_TOKEN}`)
      .send({ taskId, request: "build it" });
    expect(res.status).toBe(200);
    expect(res.body.state).toBe("queued");
    expect(res.body.taskId).toBe(taskId);
  });

  it("POST /api/tasks with existing UUID is idempotent", async () => {
    const taskId = randomUUID();
    const a = await request(app)
      .post("/api/tasks")
      .set("authorization", `Bearer ${AUTH_TOKEN}`)
      .send({ taskId, request: "build it" });
    const b = await request(app)
      .post("/api/tasks")
      .set("authorization", `Bearer ${AUTH_TOKEN}`)
      .send({ taskId, request: "build it" });
    expect(a.body.seq).toBe(b.body.seq);

    // Only one row exists
    const rows = await repo.listAll();
    const matching = rows.filter((r) => r.taskId === taskId);
    expect(matching.length).toBe(1);
  });

  it("POST /api/tasks rejects malformed taskId", async () => {
    const res = await request(app)
      .post("/api/tasks")
      .set("authorization", `Bearer ${AUTH_TOKEN}`)
      .send({ taskId: "not-a-uuid", request: "x" });
    expect(res.status).toBe(400);
  });

  it("POST /api/tasks/:id/answer writes clarification answer and returns 204", async () => {
    // Seed a clarification row
    const taskId = randomUUID();
    const clarificationId = randomUUID();
    pb.collection("_task_clarifications").create({
      taskId,
      clarificationId,
      question: "which db?",
      status: "pending",
    });

    const res = await request(app)
      .post(`/api/tasks/${taskId}/answer`)
      .set("authorization", `Bearer ${AUTH_TOKEN}`)
      .send({ clarificationId, answer: "postgres" });
    expect(res.status).toBe(204);

    // Verify the row was updated
    const row = pb.collection("_task_clarifications").getFirstListItem(
      `clarificationId = "${clarificationId}"`,
    );
    expect((row as Record<string, unknown>).answer).toBe("postgres");
    expect((row as Record<string, unknown>).status).toBe("answered");
  });

  it("POST /api/tasks/:id/cancel calls manager.cancel and returns current status", async () => {
    const taskId = randomUUID();
    // Create a task in working state
    await repo.createIfAbsent({
      taskId,
      request: "build it",
      adapterType: "claude-code",
      systemContext: "{}",
      worktreePath: "/w",
    });
    // Move to working state
    await repo.applyTransition(taskId, "scheduler_pick", {});

    const res = await request(app)
      .post(`/api/tasks/${taskId}/cancel`)
      .set("authorization", `Bearer ${AUTH_TOKEN}`)
      .send();
    expect(res.status).toBe(200);
    expect(cancelledIds).toContain(taskId);
  });

  it("missing auth returns 401", async () => {
    const res = await request(app)
      .post("/api/tasks")
      .send({ taskId: randomUUID(), request: "build" });
    expect(res.status).toBe(401);
  });

  it("GET /api/tasks/:taskId returns the task", async () => {
    const taskId = randomUUID();
    await request(app)
      .post("/api/tasks")
      .set("authorization", `Bearer ${AUTH_TOKEN}`)
      .send({ taskId, request: "build it" });

    const res = await request(app)
      .get(`/api/tasks/${taskId}`)
      .set("authorization", `Bearer ${AUTH_TOKEN}`);
    expect(res.status).toBe(200);
    expect(res.body.taskId).toBe(taskId);
  });

  it("GET /api/tasks returns all tasks", async () => {
    await request(app)
      .post("/api/tasks")
      .set("authorization", `Bearer ${AUTH_TOKEN}`)
      .send({ taskId: randomUUID(), request: "a" });
    await request(app)
      .post("/api/tasks")
      .set("authorization", `Bearer ${AUTH_TOKEN}`)
      .send({ taskId: randomUUID(), request: "b" });

    const res = await request(app)
      .get("/api/tasks")
      .set("authorization", `Bearer ${AUTH_TOKEN}`);
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(2);
  });
});
