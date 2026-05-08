import { describe, it, expect, afterEach } from "vitest";
import http from "http";
import { mkdtemp } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { execSync } from "child_process";
import { buildServer } from "../../src/index.js";
import { makeFakePb } from "../unit/helpers/fake-pb.js";
import type { DispatchConfig } from "../../src/adapters/types.js";

const TEST_CONFIG: DispatchConfig = {
  adapter: "claude-code",
  maxTaskDurationMs: 60_000,
  clarificationTimeoutMs: 10_000,
  clarificationTimeoutMode: "best_judgment",
  maxBudgetUsd: 5,
};

let server: http.Server | undefined;
let tmpDir: string | undefined;

afterEach(async () => {
  if (server) {
    await new Promise<void>((r) => server!.close(() => r()));
    server = undefined;
  }
});

async function buildTestServer(
  config: DispatchConfig,
  pb?: ReturnType<typeof makeFakePb>,
) {
  tmpDir = await mkdtemp(join(tmpdir(), "anyclaw-e2e-"));
  // The MCP server auth module reads ANYCLAW_DATA_ROOT from process.env
  process.env.ANYCLAW_DATA_ROOT = tmpDir;

  // The server needs a git repo at dataRoot/dev for VersionStore / DeployManager
  // WorktreeManager expects a "main" branch to exist.
  const devDir = join(tmpDir, "dev");
  await import("node:fs/promises").then((fs) => fs.mkdir(devDir, { recursive: true }));
  execSync("git init", { cwd: devDir, shell: "/usr/bin/bash" });
  execSync("git config user.email 'test@example.com'", { cwd: devDir, shell: "/usr/bin/bash" });
  execSync("git config user.name 'Test User'", { cwd: devDir, shell: "/usr/bin/bash" });
  execSync("git checkout -b main", { cwd: devDir, shell: "/usr/bin/bash" });
  execSync("echo 'init' > init.txt && git add init.txt && git commit -m 'init'", { cwd: devDir, shell: "/usr/bin/bash" });
  return buildServer({ config, pb, dataRoot: tmpDir });
}

async function getServerPort(s: http.Server): Promise<number> {
  await new Promise<void>((r) => s.listen(0, "127.0.0.1", r));
  const addr = s.address() as { port: number };
  return addr.port;
}

describe("e2e server tests", () => {
  describe("claude-code adapter", () => {
    it("POST /api/tasks creates a task and GET /api/health returns ok", async () => {
      const pb = makeFakePb();
      const result = await buildTestServer(TEST_CONFIG, pb);
      server = result.server;
      const port = await getServerPort(server);
      const baseUrl = `http://127.0.0.1:${port}`;

      // Health check
      const healthRes = await fetch(`${baseUrl}/api/health`);
      expect(healthRes.status).toBe(200);
      const healthBody = (await healthRes.json()) as { ok: boolean };
      expect(healthBody.ok).toBe(true);

      // Create a task
      const taskId = crypto.randomUUID();
      const taskRes = await fetch(`${baseUrl}/api/tasks`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer t",
        },
        body: JSON.stringify({ taskId, request: "build it" }),
      });
      expect(taskRes.status).toBe(200);
      const taskBody = (await taskRes.json()) as { state: string; taskId: string };
      expect(taskBody.state).toBe("queued");
      expect(taskBody.taskId).toBe(taskId);

      // MCP endpoint is reachable (not 404)
      const mcpRes = await fetch(`${baseUrl}/mcp`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      expect([200, 400, 401, 405]).toContain(mcpRes.status);
    });
  });

  describe("openclaw adapter", () => {
    it("starts cleanly even when gateway is unreachable", async () => {
      const pb = makeFakePb();
      const config: DispatchConfig = { ...TEST_CONFIG, adapter: "openclaw" };
      const result = await buildTestServer(config, pb);
      server = result.server;
      const port = await getServerPort(server);
      const baseUrl = `http://127.0.0.1:${port}`;

      // Server should start and health should return 200 even if the
      // openclaw adapter cannot reach its gateway.
      const healthRes = await fetch(`${baseUrl}/api/health`);
      expect(healthRes.status).toBe(200);
      const healthBody = (await healthRes.json()) as { ok: boolean; adapter: { ok: boolean } };
      // The adapter health status depends on whether a gateway happens to be
      // running — we only care that the server boots and responds.
      expect(typeof healthBody.adapter.ok).toBe("boolean");

      // REST routes still work
      const taskId = crypto.randomUUID();
      const taskRes = await fetch(`${baseUrl}/api/tasks`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer t",
        },
        body: JSON.stringify({ taskId, request: "build it" }),
      });
      expect(taskRes.status).toBe(200);
      const taskBody = (await taskRes.json()) as { state: string };
      expect(taskBody.state).toBe("queued");

      // MCP endpoint still reachable
      const mcpRes = await fetch(`${baseUrl}/mcp`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      expect([200, 400, 401, 405]).toContain(mcpRes.status);
    });
  });
});
