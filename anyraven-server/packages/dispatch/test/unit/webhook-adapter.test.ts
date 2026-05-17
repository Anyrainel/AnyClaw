import http from "node:http";
import { describe, it, expect } from "vitest";
import { WebhookAdapter } from "../../src/adapters/webhook.js";
import { AdapterError } from "../../src/adapters/types.js";
import type { SystemContext } from "../../src/adapters/types.js";

const ctxStub = (o: Partial<SystemContext> = {}): SystemContext => ({
  cwd: "/tmp",
  mcpEndpointUrl: "http://127.0.0.1:4100/mcp",
  mcpBearerToken: "mtoken",
  mcpConfigPath: "/tmp/mcp.json",
  systemPrompt: "",
  allowedTools: [],
  ...o,
});

function listenOnFreePort(
  server: http.Server,
): Promise<number> {
  return new Promise((resolve) => {
    server.listen(0, () => {
      const addr = server.address();
      resolve((addr as { port: number }).port);
    });
  });
}

function closeServer(server: http.Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

describe("WebhookAdapter", () => {
  it("POSTs taskId/callback/mcp URL and returns externalId", async () => {
    const server = http.createServer((req, res) => {
      let body = "";
      req.on("data", (c: Buffer) => (body += c.toString()));
      req.on("end", () => {
        const b = JSON.parse(body);
        expect(b.taskId).toBe("t1");
        expect(b.callbackUrl).toBe("http://cb/api/webhook/callback");
        expect(b.mcpBearerToken).toBe("mtoken");
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ externalId: "ext-9" }));
      });
    });
    const port = await listenOnFreePort(server);
    const a = new WebhookAdapter({
      dispatchUrl: `http://127.0.0.1:${port}/dispatch`,
      callbackBaseUrl: "http://cb",
      tasksRepo: {
        streamStatus: async function* () {
          /* noop */
        },
      } as any,
    });
    const h = await a.dispatch("t1", "req", ctxStub(), AbortSignal.timeout(2000));
    expect(h.adapterRef).toBe("ext-9");
    await closeServer(server);
  });

  it("on 401 throws AdapterError AUTH_FAILED non-retryable", async () => {
    const server = http.createServer((_req, res) => {
      res.writeHead(401);
      res.end();
    });
    const port = await listenOnFreePort(server);
    const a = new WebhookAdapter({
      dispatchUrl: `http://127.0.0.1:${port}/d`,
      callbackBaseUrl: "http://cb",
      tasksRepo: {} as any,
    });
    await expect(
      a.dispatch("t1", "r", ctxStub(), AbortSignal.timeout(1000)),
    ).rejects.toMatchObject({
      name: "AdapterError",
      code: "AUTH_FAILED",
      retryable: false,
    });
    await closeServer(server);
  });

  it("on 502 throws AdapterError INTERNAL retryable", async () => {
    const server = http.createServer((_req, res) => {
      res.writeHead(502);
      res.end();
    });
    const port = await listenOnFreePort(server);
    const a = new WebhookAdapter({
      dispatchUrl: `http://127.0.0.1:${port}/d`,
      callbackBaseUrl: "http://cb",
      tasksRepo: {} as any,
    });
    await expect(
      a.dispatch("t1", "r", ctxStub(), AbortSignal.timeout(1000)),
    ).rejects.toMatchObject({
      name: "AdapterError",
      code: "INTERNAL",
      retryable: true,
    });
    await closeServer(server);
  });
});
