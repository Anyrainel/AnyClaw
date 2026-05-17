import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import express, { type Express } from "express";
import { authRequired } from "../../src/rest/auth.js";
import { settingsRouter, type SettingsRouterDeps } from "../../src/rest/settings.js";
import { makeFakePb, type FakePb } from "../unit/helpers/fake-pb.js";

let app: Express;
let pb: FakePb;

const AUTH_TOKEN = "t";

function buildTestApp() {
  pb = makeFakePb();
  const deps: SettingsRouterDeps = { pb };

  const a = express();
  a.use(express.json());
  a.use(
    "/api/settings",
    authRequired({ verify: async (t) => (t === AUTH_TOKEN ? "user-1" : null) }),
    settingsRouter(deps),
  );
  return a;
}

describe("REST /api/settings", () => {
  beforeEach(() => {
    app = buildTestApp();
  });

  it("GET /api/settings returns empty map initially", async () => {
    const res = await request(app)
      .get("/api/settings")
      .set("authorization", `Bearer ${AUTH_TOKEN}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({});
  });

  it("PATCH /api/settings upserts a valid key", async () => {
    const res = await request(app)
      .patch("/api/settings")
      .set("authorization", `Bearer ${AUTH_TOKEN}`)
      .send({ clarificationTimeoutMode: "best_judgment" });
    expect(res.status).toBe(200);
    expect(res.body.clarificationTimeoutMode).toBe("best_judgment");
  });

  it("GET reflects the patched value", async () => {
    await request(app)
      .patch("/api/settings")
      .set("authorization", `Bearer ${AUTH_TOKEN}`)
      .send({ clarificationTimeoutMs: 30000 });

    const res = await request(app)
      .get("/api/settings")
      .set("authorization", `Bearer ${AUTH_TOKEN}`);
    expect(res.status).toBe(200);
    expect(res.body.clarificationTimeoutMs).toBe(30000);
  });

  it("PATCH with unknown key returns 400", async () => {
    const res = await request(app)
      .patch("/api/settings")
      .set("authorization", `Bearer ${AUTH_TOKEN}`)
      .send({ unknownKey: "value" });
    expect(res.status).toBe(400);
  });

  it("PATCH updates existing key (upsert)", async () => {
    await request(app)
      .patch("/api/settings")
      .set("authorization", `Bearer ${AUTH_TOKEN}`)
      .send({ clarificationTimeoutMode: "best_judgment" });

    const res = await request(app)
      .patch("/api/settings")
      .set("authorization", `Bearer ${AUTH_TOKEN}`)
      .send({ clarificationTimeoutMode: "pause_indefinitely" });
    expect(res.status).toBe(200);

    const get = await request(app)
      .get("/api/settings")
      .set("authorization", `Bearer ${AUTH_TOKEN}`);
    expect(get.body.clarificationTimeoutMode).toBe("pause_indefinitely");
  });
});
