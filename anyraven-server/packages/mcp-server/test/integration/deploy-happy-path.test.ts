import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import express from "express";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

// Injected factories via McpContext. This is how Plan 3's dispatch server
// will wire the real managers at production startup.
const deployRunMock = vi.fn().mockResolvedValue({
  version: "v1.0.1",
  gitCommit: "abc1234",
  gitTag: "v1.0.1",
  dbSnapshotId: "snap-xyz",
  validationResults: {
    lint: true,
    typecheck: true,
    build: true,
    smokeTests: true,
  },
});
const deployMgrMock = { run: deployRunMock };
const rollbackMgrMock = { run: vi.fn() };
const snapshotMgrMock = { create: vi.fn() };

let server: http.Server;
let baseUrl: string;
let tmp: string;

beforeAll(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "anyraven-int-"));
  process.env.ANYRAVEN_DATA_ROOT = tmp;
  fs.mkdirSync(path.join(tmp, ".anyraven", "mcp-tokens"), { recursive: true });

  const { mountMcp, registerTaskToken } = await import("../../src/index.js");
  const { __resetTokenRegistryForTests } = await import("../../src/auth.js");
  __resetTokenRegistryForTests();
  registerTaskToken("int-task", "int-tok");

  const app = express();
  app.use(express.json());
  mountMcp(app, {
    deployManagerFactory: () => deployMgrMock,
    rollbackManagerFactory: () => rollbackMgrMock,
    snapshotManagerFactory: () => snapshotMgrMock,
  });
  await new Promise<void>((r) => {
    server = app.listen(0, "127.0.0.1", () => r());
  });
  const addr = server.address() as { port: number };
  baseUrl = `http://127.0.0.1:${addr.port}/mcp`;
});

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("integration: deploy happy path", () => {
  it("calls anyraven_deploy through the MCP client and returns structured content", async () => {
    const client = new Client(
      { name: "test", version: "1.0.0" },
      { capabilities: {} },
    );
    const transport = new StreamableHTTPClientTransport(new URL(baseUrl), {
      requestInit: { headers: { Authorization: "Bearer int-tok" } },
    });
    // MCP SDK's StreamableHTTPClientTransport.sessionId is typed as
    // `string | undefined` but the Transport interface expects a plain
    // `string`. Under exactOptionalPropertyTypes this is flagged; the
    // runtime behavior is correct. Cast to the expected interface.
    await client.connect(transport as unknown as Parameters<typeof client.connect>[0]);
    const tools = await client.listTools();
    expect(tools.tools.map((t) => t.name).sort()).toContain("anyraven_deploy");

    const res = await client.callTool({
      name: "anyraven_deploy",
      arguments: {
        versionDescription: "adds mood tracking feature",
        skipDbSnapshot: true,
      },
    });
    // eslint-disable-next-line no-console
    console.log("RES", JSON.stringify(res).slice(0, 800));
    expect(res.isError).toBeFalsy();
    expect((res.structuredContent as any).version).toBe("v1.0.1");
    expect((res.structuredContent as any).validationResults.lint).toBe(true);

    expect(deployRunMock).toHaveBeenCalledWith({
      taskId: "int-task",
      versionDescription: "adds mood tracking feature",
      skipDbSnapshot: true,
    });
    await client.close();
  });
});
