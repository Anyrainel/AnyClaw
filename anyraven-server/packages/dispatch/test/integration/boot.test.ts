import { describe, it, expect, afterEach } from "vitest";
import http from "http";
import { mkdtemp } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { buildServer } from "../../src/index.js";
import { makeFakePb, seedTask } from "../unit/helpers/fake-pb.js";
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

async function buildTestServer(pb?: ReturnType<typeof makeFakePb>) {
  tmpDir = await mkdtemp(join(tmpdir(), "anyraven-boot-"));
  return buildServer({ config: TEST_CONFIG, pb, dataRoot: tmpDir });
}

describe("buildServer", () => {
  it("returns an http.Server that responds to GET /api/health", async () => {
    const pb = makeFakePb();
    const result = await buildTestServer(pb);
    server = result.server;
    await new Promise<void>((r) => server!.listen(0, "127.0.0.1", r));
    const addr = server.address() as { port: number };
    const res = await fetch(`http://127.0.0.1:${addr.port}/api/health`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
  });

  it("allows local frontend CORS preflight requests", async () => {
    const pb = makeFakePb();
    const result = await buildTestServer(pb);
    server = result.server;
    await new Promise<void>((r) => server!.listen(0, "127.0.0.1", r));
    const addr = server.address() as { port: number };
    const res = await fetch(`http://127.0.0.1:${addr.port}/api/tasks`, {
      method: "OPTIONS",
      headers: {
        origin: "http://localhost:5174",
        "access-control-request-method": "POST",
        "access-control-request-headers": "authorization,content-type",
      },
    });
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe("http://localhost:5174");
    expect(res.headers.get("access-control-allow-headers")).toContain("authorization");
  });

  it("mounts the MCP route from @anyraven/mcp-server", async () => {
    const pb = makeFakePb();
    const result = await buildTestServer(pb);
    server = result.server;
    await new Promise<void>((r) => server!.listen(0, "127.0.0.1", r));
    const addr = server.address() as { port: number };
    const res = await fetch(`http://127.0.0.1:${addr.port}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    // MCP route is reachable (not 404). May return 400/401 since we
    // don't provide a valid bearer token or initialize request.
    expect([200, 400, 401, 405]).toContain(res.status);
  });

  it("runs AdapterManager.onStartup (sweep) before accepting traffic", async () => {
    const pb = makeFakePb();
    seedTask(pb, "stranded", "working");
    await buildTestServer(pb);
    const row = pb
      .collection("_tasks")
      .getFirstListItem('taskId = "stranded"');
    expect((row as Record<string, unknown>).state).toBe("failed");
  });
});
