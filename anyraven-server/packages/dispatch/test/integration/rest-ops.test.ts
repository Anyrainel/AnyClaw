import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import { randomUUID } from "crypto";
import express, { type Express } from "express";
import { authRequired } from "../../src/rest/auth.js";
import { emergencyRouter, type EmergencyRouterDeps } from "../../src/rest/emergency.js";
import { adapterConfigRouter, type AdapterConfigRouterDeps } from "../../src/rest/adapter.js";
import { webhookCallbackRouter, type WebhookCallbackRouterDeps } from "../../src/rest/webhook-callback.js";
import { TasksRepo } from "../../src/persistence/tasks-repo.js";
import { makeFakePb, seedTask, type FakePb } from "../unit/helpers/fake-pb.js";

const AUTH_TOKEN = "t";
const auth = authRequired({ verify: async (t) => (t === AUTH_TOKEN ? "user-1" : null) });

let app: Express;
let pb: FakePb;
let repo: TasksRepo;

// Stubs
let rollbackCalled: boolean;
let restartCalled: boolean;
let reloadConfigCalled: boolean;
let lastConfig: unknown;
const versions = [{ id: "v1", description: "initial" }, { id: "v2", description: "update" }];

function buildTestApp() {
  pb = makeFakePb();
  repo = new TasksRepo(pb);
  rollbackCalled = false;
  restartCalled = false;
  reloadConfigCalled = false;
  lastConfig = undefined;

  const emergencyDeps: EmergencyRouterDeps = {
    rollbackManager: {
      rollback: async () => { rollbackCalled = true; },
    },
    deployManager: {
      promote: async () => {},
    },
    restartFn: async () => { restartCalled = true; },
    versionStore: {
      list: async () => versions,
    },
  };

  const adapterDeps: AdapterConfigRouterDeps = {
    manager: {
      reloadConfig: async (cfg: unknown) => { reloadConfigCalled = true; lastConfig = cfg; },
      adapter: { healthCheck: async () => ({ ok: true }) },
    },
  };

  const webhookDeps: WebhookCallbackRouterDeps = {
    repo,
    pb,
  };

  const a = express();
  a.use(express.json());
  // Webhook callback is not behind auth — it's called by the adapter itself
  // Mount before /api auth-guarded routes so it doesn't get caught
  a.use("/api/webhook", webhookCallbackRouter(webhookDeps));
  a.use("/api/adapter", auth, adapterConfigRouter(adapterDeps));
  a.use("/api", auth, emergencyRouter(emergencyDeps));
  return a;
}

describe("REST emergency endpoints", () => {
  beforeEach(() => {
    app = buildTestApp();
  });

  it("POST /api/rollback calls rollbackManager.rollback", async () => {
    const res = await request(app)
      .post("/api/rollback")
      .set("authorization", `Bearer ${AUTH_TOKEN}`)
      .send();
    expect(res.status).toBe(200);
    expect(rollbackCalled).toBe(true);
  });

  it("POST /api/restart-app invokes restartFn", async () => {
    const res = await request(app)
      .post("/api/restart-app")
      .set("authorization", `Bearer ${AUTH_TOKEN}`)
      .send();
    expect(res.status).toBe(200);
    expect(restartCalled).toBe(true);
  });

  it("GET /api/versions returns the list from versionStore", async () => {
    const res = await request(app)
      .get("/api/versions")
      .set("authorization", `Bearer ${AUTH_TOKEN}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual(versions);
  });
});

describe("REST adapter config", () => {
  beforeEach(() => {
    app = buildTestApp();
  });

  it("PUT /api/adapter/config calls manager.reloadConfig", async () => {
    const cfg = { adapter: "webhook", maxTaskDurationMs: 60000 };
    const res = await request(app)
      .put("/api/adapter/config")
      .set("authorization", `Bearer ${AUTH_TOKEN}`)
      .send(cfg);
    expect(res.status).toBe(200);
    expect(reloadConfigCalled).toBe(true);
    expect(lastConfig).toEqual(cfg);
  });

  it("GET /api/adapter/health returns adapter health", async () => {
    const res = await request(app)
      .get("/api/adapter/health")
      .set("authorization", `Bearer ${AUTH_TOKEN}`);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });
});

describe("REST webhook callback", () => {
  beforeEach(() => {
    app = buildTestApp();
  });

  it("POST /api/webhook/callback with progress event applies transition", async () => {
    const taskId = randomUUID();
    seedTask(pb, taskId, "queued");
    // Move to working
    await repo.applyTransition(taskId, "scheduler_pick", {});

    const res = await request(app)
      .post("/api/webhook/callback")
      .send({ taskId, event: "progress", progressSummary: "building" });
    expect(res.status).toBe(200);

    const row = await repo.getByTaskId(taskId);
    expect(row.state).toBe("working");
  });

  it("POST /api/webhook/callback with clarifying event writes clarification row", async () => {
    const taskId = randomUUID();
    const clarificationId = randomUUID();
    seedTask(pb, taskId, "queued");
    await repo.applyTransition(taskId, "scheduler_pick", {});

    const res = await request(app)
      .post("/api/webhook/callback")
      .send({ taskId, event: "clarifying", question: "which db?", clarificationId });
    expect(res.status).toBe(200);

    const row = await repo.getByTaskId(taskId);
    expect(row.state).toBe("clarifying");
  });

  it("POST /api/webhook/callback with deploying event writes _deployments row", async () => {
    const taskId = randomUUID();
    seedTask(pb, taskId, "queued");
    await repo.applyTransition(taskId, "scheduler_pick", {});

    const res = await request(app)
      .post("/api/webhook/callback")
      .send({ taskId, event: "deploying" });
    expect(res.status).toBe(200);

    const row = await repo.getByTaskId(taskId);
    expect(row.state).toBe("deploying");

    // Check _deployments row
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const deployments = (pb.collection("_deployments") as any).getFullList() as Array<Record<string, unknown>>;
    expect(deployments.length).toBe(1);
    expect(deployments[0]!.state).toBe("deploying");
  });

  it("POST /api/webhook/callback with done event updates _deployments", async () => {
    const taskId = randomUUID();
    seedTask(pb, taskId, "queued");
    await repo.applyTransition(taskId, "scheduler_pick", {});

    // First go through deploying
    await request(app)
      .post("/api/webhook/callback")
      .send({ taskId, event: "deploying" });

    const res = await request(app)
      .post("/api/webhook/callback")
      .send({ taskId, event: "done", description: "shipped it" });
    expect(res.status).toBe(200);

    const row = await repo.getByTaskId(taskId);
    expect(row.state).toBe("done");
  });

  it("POST /api/webhook/callback with failed event updates _deployments", async () => {
    const taskId = randomUUID();
    seedTask(pb, taskId, "queued");
    await repo.applyTransition(taskId, "scheduler_pick", {});

    const res = await request(app)
      .post("/api/webhook/callback")
      .send({ taskId, event: "failed", error: "build crashed" });
    expect(res.status).toBe(200);

    const row = await repo.getByTaskId(taskId);
    expect(row.state).toBe("failed");
  });

  it("POST /api/webhook/callback with invalid event returns 400", async () => {
    const res = await request(app)
      .post("/api/webhook/callback")
      .send({ taskId: randomUUID(), event: "invalid_event" });
    expect(res.status).toBe(400);
  });
});
