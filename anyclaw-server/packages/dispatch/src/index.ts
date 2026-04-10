import http from "http";
import express from "express";
import { mountMcp } from "@anyclaw/mcp-server";
import { TasksRepo, type PocketBaseLike } from "./persistence/tasks-repo.js";
import { ensureDispatchCollections } from "./persistence/collections-bootstrap.js";
import { AdapterManager } from "./adapters/manager.js";
import { NoopResourceLimits } from "./resource-limits/noop.js";
import { buildApp } from "./app.js";
import type { DispatchConfig, SystemContext } from "./adapters/types.js";

export interface BuildServerOptions {
  config: DispatchConfig;
  pb?: PocketBaseLike;
}

export async function buildServer(opts: BuildServerOptions) {
  const pb = opts.pb ?? makeFallbackPb();
  await ensureDispatchCollections(pb as never);

  const repo = new TasksRepo(pb);

  const adapter = {
    name: "noop-boot",
    healthCheck: async () => ({ ok: true }),
    dispatch: async () => ({ taskId: "", adapterRef: "" }),
    subscribe: async function* () {},
    answerQuestion: async () => {},
    cancel: async () => {},
    dispose: async () => {},
  };

  const worktrees = {
    create: async (_taskId: string) => "/tmp/wt",
    mergeAndRemove: async () => {},
    discard: async () => {},
  };

  const buildSystemContext = async (_taskId: string): Promise<SystemContext> => ({
    cwd: "/data/dev",
    mcpEndpointUrl: "http://127.0.0.1:4100/mcp",
    mcpBearerToken: "",
    mcpConfigPath: "",
    systemPrompt: "",
    allowedTools: [],
  });

  const manager = new AdapterManager({
    adapter,
    repo,
    worktrees,
    resourceLimits: new NoopResourceLimits(),
    config: opts.config,
    buildSystemContext,
  });

  // CRITICAL: sweep before accepting traffic.
  await manager.onStartup();

  // Single Express app shared between MCP (Plan 2) and REST (Plan 3).
  const app = express();
  app.use(express.json({ limit: "2mb" }));
  app.set("trust proxy", false);

  // Mount MCP FIRST so its route prefix is claimed before any REST wildcard middleware.
  mountMcp(app, {});

  // Mount REST routers (including /api/health, /api/*, /internal/*).
  buildApp(app, {
    pb,
    repo,
    manager,
    worktrees: { create: async (taskId) => worktrees.create(taskId) },
    adapter,
    config: opts.config,
    buildSystemContext,
  });

  const server = http.createServer(app);
  return { server, pb, repo, manager, adapter };
}

/** Fallback PB-like object -- only used if no PB is injected. */
function makeFallbackPb(): PocketBaseLike {
  const cols = new Map<string, ReturnType<PocketBaseLike["collection"]>>();
  return {
    collection(name: string) {
      if (!cols.has(name)) {
        cols.set(name, {
          create: () => ({}),
          getFirstListItem: () => { throw Object.assign(new Error("not found"), { status: 404 }); },
          update: () => ({}),
          getFullList: () => [],
        });
      }
      return cols.get(name)!;
    },
    collections: {
      getFullList: () => [],
      create: () => ({}),
    },
  } as unknown as PocketBaseLike;
}

// Entrypoint for `node dist/index.js`
const isMain =
  typeof process !== "undefined" &&
  process.argv[1] &&
  import.meta.url === `file://${process.argv[1]}`;

if (isMain) {
  const port = Number(process.env.PORT ?? 4100);
  const config: DispatchConfig = {
    adapter: (process.env.ADAPTER as DispatchConfig["adapter"]) ?? "claude-code",
    maxTaskDurationMs: Number(process.env.MAX_TASK_DURATION_MS ?? 600_000),
    clarificationTimeoutMs: Number(process.env.CLARIFICATION_TIMEOUT_MS ?? 300_000),
    clarificationTimeoutMode:
      (process.env.CLARIFICATION_TIMEOUT_MODE as DispatchConfig["clarificationTimeoutMode"]) ?? "best_judgment",
    maxBudgetUsd: Number(process.env.MAX_BUDGET_USD ?? 5),
  };
  buildServer({ config })
    .then(({ server }) => {
      server.listen(port, "127.0.0.1", () => {
        // eslint-disable-next-line no-console
        console.log(`[dispatch] listening on 127.0.0.1:${port}`);
      });
    })
    .catch((err) => {
      // eslint-disable-next-line no-console
      console.error("[dispatch] boot failed:", err);
      process.exit(1);
    });
}
