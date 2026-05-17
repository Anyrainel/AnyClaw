import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import express from "express";
import request from "supertest";
import {
  registerTaskToken,
  revokeTaskToken,
  requireBearerToken,
  resolveTaskFromToken,
  __resetTokenRegistryForTests,
} from "../src/auth.js";

let tmp: string;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "anyraven-auth-"));
  process.env.ANYRAVEN_DATA_ROOT = tmp;
  fs.mkdirSync(path.join(tmp, ".anyraven", "mcp-tokens"), { recursive: true });
  __resetTokenRegistryForTests();
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
  delete process.env.ANYRAVEN_DATA_ROOT;
});

function makeApp() {
  const app = express();
  app.post("/mcp", requireBearerToken, (req, res) => {
    res.json({ taskId: resolveTaskFromToken(req) });
  });
  return app;
}

describe("bearer auth", () => {
  it("rejects missing header", async () => {
    const res = await request(makeApp()).post("/mcp");
    expect(res.status).toBe(401);
  });
  it("rejects unknown token", async () => {
    const res = await request(makeApp()).post("/mcp").set("Authorization", "Bearer nope");
    expect(res.status).toBe(401);
  });
  it("accepts registered token and resolves task", async () => {
    registerTaskToken("t1", "tok-abc");
    const res = await request(makeApp()).post("/mcp").set("Authorization", "Bearer tok-abc");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ taskId: "t1" });
  });
  it("rejects revoked token", async () => {
    registerTaskToken("t1", "tok-abc");
    revokeTaskToken("t1");
    const res = await request(makeApp()).post("/mcp").set("Authorization", "Bearer tok-abc");
    expect(res.status).toBe(401);
  });
  it("writes token file", () => {
    registerTaskToken("t1", "tok-abc");
    const p = path.join(tmp, ".anyraven", "mcp-tokens", "task-t1.token");
    expect(fs.readFileSync(p, "utf8")).toBe("tok-abc");
  });
});
