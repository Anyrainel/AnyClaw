import { describe, it, expect } from "vitest";
import request from "supertest";
import express from "express";
import { authRequired } from "../../src/rest/auth.js";

function buildApp(verify: (token: string) => Promise<string | null>) {
  const app = express();
  app.use(express.json());
  app.use(authRequired({ verify }));
  app.get("/protected", (req, res) => {
    res.json({ user: (req as unknown as { userToken: string }).userToken });
  });
  return app;
}

const goodVerify = async (t: string) => (t === "valid-token" ? "user-1" : null);

describe("authRequired middleware", () => {
  it("returns 401 when Authorization header is missing", async () => {
    const app = buildApp(goodVerify);
    const res = await request(app).get("/protected");
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("unauthorized");
  });

  it("returns 401 when token is invalid", async () => {
    const app = buildApp(goodVerify);
    const res = await request(app).get("/protected").set("authorization", "Bearer bad-token");
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("unauthorized");
  });

  it("returns 401 when Authorization header has wrong scheme", async () => {
    const app = buildApp(goodVerify);
    const res = await request(app).get("/protected").set("authorization", "Basic valid-token");
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("unauthorized");
  });

  it("calls next() and attaches req.userToken on valid token", async () => {
    const app = buildApp(goodVerify);
    const res = await request(app).get("/protected").set("authorization", "Bearer valid-token");
    expect(res.status).toBe(200);
    expect(res.body.user).toBe("user-1");
  });
});
