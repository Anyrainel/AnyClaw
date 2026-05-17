import { describe, it, expect, beforeEach, afterEach } from "vitest";
import express from "express";
import request from "supertest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { mountMcp } from "../src/index.js";
import { registerTaskToken, __resetTokenRegistryForTests } from "../src/auth.js";

let tmp: string;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "anyraven-mount-"));
  process.env.ANYRAVEN_DATA_ROOT = tmp;
  fs.mkdirSync(path.join(tmp, ".anyraven", "mcp-tokens"), { recursive: true });
  __resetTokenRegistryForTests();
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
  delete process.env.ANYRAVEN_DATA_ROOT;
});

describe("mountMcp", () => {
  it("401 without bearer token", async () => {
    const app = express();
    app.use(express.json());
    mountMcp(app);
    const res = await request(app)
      .post("/mcp")
      .send({ jsonrpc: "2.0", method: "tools/list", id: 1 });
    expect(res.status).toBe(401);
  });

  it("tools/list returns the seven anyraven tools", async () => {
    registerTaskToken("tA", "tok-A");
    const app = express();
    app.use(express.json());
    mountMcp(app);
    const init = await request(app)
      .post("/mcp")
      .set("Authorization", "Bearer tok-A")
      .set("Accept", "application/json, text/event-stream")
      .send({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "t", version: "1" },
        },
      });
    expect(init.status).toBe(200);
    const sessionId = (init.headers["mcp-session-id"] as string) ?? "";
    const list = await request(app)
      .post("/mcp")
      .set("Authorization", "Bearer tok-A")
      .set("Accept", "application/json, text/event-stream")
      .set("mcp-session-id", sessionId)
      .send({ jsonrpc: "2.0", id: 2, method: "tools/list" });
    const raw = list.text ?? "";
    let body: any = list.body;
    if (typeof raw === "string" && raw.includes("data:")) {
      const dataLine = raw
        .split("\n")
        .find((l) => l.startsWith("data: "));
      if (dataLine) body = JSON.parse(dataLine.slice(6));
    }
    const names = (body.result?.tools ?? []).map((t: any) => t.name).sort();
    expect(names).toEqual([
      "anyraven_ask_user",
      "anyraven_create_collection",
      "anyraven_deploy",
      "anyraven_list_versions",
      "anyraven_rollback",
      "anyraven_snapshot_db",
      "anyraven_update_progress",
    ]);
  });
});
