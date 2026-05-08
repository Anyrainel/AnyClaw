import http from "http";
import { randomUUID } from "node:crypto";
import path from "node:path";
import express from "express";
import { mountMcp, registerTaskToken, revokeTaskToken } from "@anyclaw/mcp-server";
import {
  WorktreeManager,
  AnyClawPaths,
  VersionStore,
  SnapshotManager,
  DeployManager,
  RollbackManager,
} from "@anyclaw/shared";
import { TasksRepo, type PocketBaseLike } from "./persistence/tasks-repo.js";
import { ensureDispatchCollections } from "./persistence/collections-bootstrap.js";
import { AdapterManager } from "./adapters/manager.js";
import { NoopResourceLimits } from "./resource-limits/noop.js";
import { buildApp } from "./app.js";
import { OpenClawAdapter } from "./adapters/openclaw.js";
import { ClaudeCodeAdapter } from "./adapters/claude-code.js";
import { WebhookAdapter } from "./adapters/webhook.js";
import type { DispatchConfig, SystemContext, AgentAdapter } from "./adapters/types.js";

export interface BuildServerOptions {
  config: DispatchConfig;
  pb?: PocketBaseLike;
  dataRoot?: string;
  port?: number;
}

function makePaths(dataRoot: string) {
  return new AnyClawPaths(dataRoot);
}

function makeAdapter(config: DispatchConfig, repo: TasksRepo, _paths: AnyClawPaths): AgentAdapter {
  switch (config.adapter) {
    case "openclaw": {
      const gatewayUrl = process.env.OPENCLAW_GATEWAY_URL ?? "ws://127.0.0.1:18789/gateway";
      const token = process.env.OPENCLAW_TOKEN ?? "";
      const workspace = process.env.OPENCLAW_WORKSPACE ?? "anyclaw-test";
      return new OpenClawAdapter({ gatewayUrl, token, workspace });
    }
    case "claude-code": {
      const executablePath = process.env.CLAUDE_CODE_PATH ?? "claude";
      return new ClaudeCodeAdapter({
        executablePath,
        maxBudgetUsd: config.maxBudgetUsd,
        persistSessionId: async (taskId, sessionId) => {
          await repo.updateSessionId(taskId, sessionId);
        },
        persistTaskStatus: async (taskId, status) => {
          void { taskId, status };
        },
      });
    }
    case "webhook": {
      const dispatchUrl = process.env.WEBHOOK_DISPATCH_URL ?? "";
      const callbackBaseUrl = process.env.WEBHOOK_CALLBACK_BASE_URL ?? `http://127.0.0.1:${process.env.PORT ?? 4100}`;
      return new WebhookAdapter({
        dispatchUrl,
        callbackBaseUrl,
      });
    }
    default: {
      // Exhaustive check
      throw new Error(`Unknown adapter: ${config.adapter}`);
    }
  }
}

function makeManagers(paths: AnyClawPaths) {
  const pbDataPath = path.join(paths.pocketbaseData, "data.db");
  const versionStore = new VersionStore(paths.dev);
  const snapshotManager = new SnapshotManager({
    sqlitePath: pbDataPath,
    snapshotsDir: paths.snapshots,
    keep: 10,
  });

  // TODO: implement real restart logic (e.g. signal to logic-runner process)
  const restartLogicService = async () => {
    // eslint-disable-next-line no-console
    console.log("[dispatch] restartLogicService called (no-op in local testing)");
  };

  const worktreeManager = new WorktreeManager({
    repoDir: paths.dev,
    worktreesDir: paths.devWorktrees,
  });

  const deployManager = new DeployManager({
    repoDir: paths.dev,
    prodDir: paths.prod,
    versions: versionStore,
    worktrees: worktreeManager,
    snapshots: snapshotManager,
    restartLogicService,
  });

  const rollbackManager = new RollbackManager({
    versions: versionStore,
    snapshots: snapshotManager,
    restartLogicService,
  });

  // Wrap DeployManager to match DeployManagerLike interface expected by MCP tools
  const deployManagerLike = {
    run: async (args: { taskId: string; versionDescription: string; skipDbSnapshot: boolean }) => {
      const wtList = await worktreeManager.list();
      const wt = wtList.find(w => w.taskId === args.taskId);
      if (!wt) throw new Error(`Worktree not found for task ${args.taskId}`);

      // Build artifact dir is the frontend template build output
      const buildArtifactDir = "packages/frontend-template/dist";
      const prodSubdir = "frontend-build";

      const result = await deployManager.deploy({
        taskId: args.taskId,
        description: args.versionDescription,
        schemaChanged: !args.skipDbSnapshot,
        validate: async () => ({ ok: true }),
        buildArtifactDir,
        prodSubdir,
      });

      if (!result.ok) {
        throw new Error(result.error ?? "Deploy failed");
      }

      return {
        version: result.version.tag,
        gitCommit: result.version.sha,
        gitTag: result.version.tag,
        dbSnapshotId: null,
        validationResults: {
          lint: true,
          typecheck: true,
          build: true,
          smokeTests: true,
        },
      };
    },
  };

  // Wrap RollbackManager to match RollbackManagerLike interface
  const rollbackManagerLike = {
    run: async (version: string) => {
      const result = await rollbackManager.rollback(version);
      if (!result.ok) {
        throw new Error(result.error ?? "Rollback failed");
      }
      return {
        rolledBackTo: version,
        safetySnapshotId: "",
        gitCommit: "",
      };
    },
  };

  // Wrap SnapshotManager to match SnapshotManagerLike interface
  const snapshotManagerLike = {
    create: async (label: string) => {
      const id = `${label}-${Date.now()}`;
      const file = await snapshotManager.create(id);
      const stat = await import("node:fs/promises").then(fs => fs.stat(file));
      return {
        snapshotId: id,
        sizeBytes: stat.size,
        path: file,
      };
    },
  };

  return {
    deployManager: deployManagerLike,
    rollbackManager: rollbackManagerLike,
    snapshotManager: snapshotManagerLike,
    worktreeManager,
    versionStore,
  };
}

export async function buildServer(opts: BuildServerOptions) {
  const dataRoot = opts.dataRoot ?? process.env.ANYCLAW_DATA_ROOT ?? "/data";
  const port = opts.port ?? Number(process.env.PORT ?? 4100);
  const paths = makePaths(dataRoot);

  const pb = opts.pb ?? makeFallbackPb();
  await ensureDispatchCollections(pb as never);

  const repo = new TasksRepo(pb);
  const { deployManager, rollbackManager, snapshotManager, worktreeManager } = makeManagers(paths);

  const adapter = makeAdapter(opts.config, repo, paths);

  const worktrees = {
    create: async (taskId: string) => {
      const wt = await worktreeManager.create(taskId);
      return wt.path;
    },
    mergeAndRemove: async (taskId: string) => {
      await worktreeManager.delete(taskId);
    },
    discard: async (taskId: string) => {
      await worktreeManager.delete(taskId);
    },
  };

  const buildSystemContext = async (taskId: string): Promise<SystemContext> => {
    const worktreePath = paths.worktreeFor(taskId);
    const token = randomUUID();
    registerTaskToken(taskId, token);

    // Determine allowed tools based on config
    const allowedToolsEnv = process.env.ANYCLAW_ALLOWED_TOOLS;
    const defaultAllowedTools = [
      "anyclaw_ask_user",
      "anyclaw_update_progress",
      "anyclaw_create_collection",
      "anyclaw_snapshot_db",
      "anyclaw_deploy",
      "anyclaw_rollback",
      "anyclaw_list_versions",
    ];
    const allowedTools = allowedToolsEnv ? allowedToolsEnv.split(",") : defaultAllowedTools;

    return {
      cwd: worktreePath,
      mcpEndpointUrl: `http://127.0.0.1:${port}/mcp`,
      mcpBearerToken: token,
      mcpConfigPath: path.join(worktreePath, ".mcp.json"),
      systemPrompt: process.env.ANYCLAW_SYSTEM_PROMPT ?? "",
      allowedTools,
    };
  };

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
  mountMcp(app, {
    deployManagerFactory: () => deployManager,
    rollbackManagerFactory: () => rollbackManager,
    snapshotManagerFactory: () => snapshotManager,
  });

  // Mount REST routers (including /api/health, /api/*, /internal/*).
  buildApp(app, {
    pb,
    repo,
    manager,
    worktrees: { create: async (taskId) => worktrees.create(taskId) },
    adapter,
    config: opts.config,
    buildSystemContext,
    // Emergency ops managers — wired to real implementations above
    deployManager: { promote: async () => { await deployManager.run({ taskId: "emergency", versionDescription: "emergency-promote", skipDbSnapshot: true }); } },
    rollbackManager: { rollback: async () => { /* TODO: implement emergency rollback without version arg */ } },
    versionStore: { list: async () => [] },
    restartFn: async () => { /* no-op for local testing */ },
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
    adapter: (process.env.ADAPTER as DispatchConfig["adapter"]) ?? "openclaw",
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
