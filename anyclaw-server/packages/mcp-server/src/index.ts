import { randomUUID } from "node:crypto";
import type { Express, Request, Response } from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { requireBearerToken, resolveTaskFromToken } from "./auth.js";
import { registerAllTools } from "./tools/index.js";

const INSTRUCTIONS = [
  "AnyClaw MCP server. Use your own native file and shell tools for everything in the dev worktree.",
  "Use AnyClaw MCP tools only for production operations: anyclaw_deploy, anyclaw_rollback, anyclaw_snapshot_db, anyclaw_create_collection.",
  "Use anyclaw_ask_user to clarify requirements and anyclaw_update_progress to keep the user informed.",
  "A version description of at least 10 characters is required for every deployment.",
].join(" ");

import type { DeployManagerLike } from "./tools/deploy.js";
import type { RollbackManagerLike } from "./tools/rollback.js";
import type { SnapshotManagerLike } from "./tools/snapshot-db.js";

/**
 * Optional factory overrides injected at mount time. Plan 3's dispatch
 * server wires real managers via these. Tests inject mocks.
 */
export interface McpContext {
  deployManagerFactory?: () => DeployManagerLike;
  rollbackManagerFactory?: () => RollbackManagerLike;
  snapshotManagerFactory?: () => SnapshotManagerLike;
}

export function mountMcp(app: Express, ctx: McpContext = {}): void {
  const transports = new Map<string, StreamableHTTPServerTransport>();

  app.post("/mcp", requireBearerToken, async (req: Request, res: Response) => {
    try {
      const taskId = resolveTaskFromToken(req);
      const sessionId = req.header("mcp-session-id");
      let transport: StreamableHTTPServerTransport | undefined;

      if (sessionId && transports.has(sessionId)) {
        transport = transports.get(sessionId)!;
      } else if (!sessionId && isInitializeRequest(req.body)) {
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (sid) => {
            transports.set(sid, transport!);
          },
        });
        transport.onclose = () => {
          if (transport!.sessionId) transports.delete(transport!.sessionId);
        };
        const server = new McpServer(
          { name: "anyclaw", version: "1.0.0" },
          { instructions: INSTRUCTIONS },
        );
        registerAllTools(server, { taskId, ...ctx });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await server.connect(transport as any);
      } else {
        res.status(400).json({
          jsonrpc: "2.0",
          error: { code: -32000, message: "Bad Request: No valid session" },
          id: null,
        });
        return;
      }

      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      if (!res.headersSent) {
        res
          .status(500)
          .json({ error: "mcp_mount_failure", message: (err as Error).message });
      }
    }
  });

  const sessionHandler = async (req: Request, res: Response) => {
    const sessionId = req.header("mcp-session-id");
    if (!sessionId || !transports.has(sessionId)) {
      res.status(400).send("Invalid or missing session ID");
      return;
    }
    const transport = transports.get(sessionId)!;
    await transport.handleRequest(req, res);
  };
  app.get("/mcp", requireBearerToken, sessionHandler);
  app.delete("/mcp", requireBearerToken, sessionHandler);
}

export { registerTaskToken, revokeTaskToken } from "./auth.js";
