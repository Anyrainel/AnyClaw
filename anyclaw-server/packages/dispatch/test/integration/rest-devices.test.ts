import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import express, { type Express } from "express";
import { authRequired } from "../../src/rest/auth.js";
import { devicesRouter, type DevicesRouterDeps } from "../../src/rest/devices.js";
import { makeFakePb, type FakePb } from "../unit/helpers/fake-pb.js";

let app: Express;
let pb: FakePb;

const AUTH_TOKEN = "t";

function buildTestApp() {
  pb = makeFakePb();
  const deps: DevicesRouterDeps = { pb };

  const a = express();
  a.use(express.json());
  a.use(
    "/api/device",
    authRequired({ verify: async (t) => (t === AUTH_TOKEN ? "user-1" : null) }),
    devicesRouter(deps),
  );
  return a;
}

describe("REST /api/device/register", () => {
  beforeEach(() => {
    app = buildTestApp();
  });

  it("creates a _devices row on first registration", async () => {
    const res = await request(app)
      .post("/api/device/register")
      .set("authorization", `Bearer ${AUTH_TOKEN}`)
      .send({ expoPushToken: "ExponentPushToken[abc123]", platform: "ios" });
    expect(res.status).toBe(200);
    expect(res.body.expoPushToken).toBe("ExponentPushToken[abc123]");
    expect(res.body.platform).toBe("ios");
  });

  it("re-posting same expoPushToken is idempotent (one row)", async () => {
    const payload = { expoPushToken: "ExponentPushToken[abc123]", platform: "android" };
    await request(app)
      .post("/api/device/register")
      .set("authorization", `Bearer ${AUTH_TOKEN}`)
      .send(payload);
    await request(app)
      .post("/api/device/register")
      .set("authorization", `Bearer ${AUTH_TOKEN}`)
      .send(payload);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows = (pb.collection("_devices") as any).getFullList() as Array<Record<string, unknown>>;
    const matching = rows.filter(
      (r) => r.expoPushToken === "ExponentPushToken[abc123]",
    );
    expect(matching.length).toBe(1);
  });

  it("bad platform returns 400", async () => {
    const res = await request(app)
      .post("/api/device/register")
      .set("authorization", `Bearer ${AUTH_TOKEN}`)
      .send({ expoPushToken: "ExponentPushToken[x]", platform: "windows" });
    expect(res.status).toBe(400);
  });

  it("missing expoPushToken returns 400", async () => {
    const res = await request(app)
      .post("/api/device/register")
      .set("authorization", `Bearer ${AUTH_TOKEN}`)
      .send({ platform: "ios" });
    expect(res.status).toBe(400);
  });

  it("missing auth returns 401", async () => {
    const res = await request(app)
      .post("/api/device/register")
      .send({ expoPushToken: "ExponentPushToken[x]", platform: "ios" });
    expect(res.status).toBe(401);
  });
});
