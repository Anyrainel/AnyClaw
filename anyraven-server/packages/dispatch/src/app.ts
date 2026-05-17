import type { Express } from "express";
import { authRequired, type AuthDeps } from "./rest/auth.js";
import { healthRouter, type HealthRouterDeps } from "./rest/health.js";
import { tasksRouter, type TasksRouterDeps } from "./rest/tasks.js";
import { settingsRouter, type SettingsRouterDeps } from "./rest/settings.js";
import { devicesRouter, type DevicesRouterDeps } from "./rest/devices.js";
import { emergencyRouter, type EmergencyRouterDeps } from "./rest/emergency.js";
import { adapterConfigRouter, type AdapterConfigRouterDeps } from "./rest/adapter.js";
import { webhookCallbackRouter, type WebhookCallbackRouterDeps } from "./rest/webhook-callback.js";
import { internalApiKeysRouter, type InternalApiKeysDeps } from "./rest/internal-api-keys.js";
import { versionRouter, type VersionRouterDeps } from "./rest/version.js";
import type { TasksRepo } from "./persistence/tasks-repo.js";
import type { PocketBaseLike } from "./persistence/tasks-repo.js";
import type { AdapterManager } from "./adapters/manager.js";
import type { AgentAdapter } from "./adapters/types.js";

export interface BuildAppDeps {
  pb: PocketBaseLike;
  repo: TasksRepo;
  manager: AdapterManager;
  worktrees: { create(taskId: string): Promise<string> };
  adapter: AgentAdapter;
  config: {
    clarificationTimeoutMode?: string;
    clarificationTimeoutMs?: number;
    maxBudgetUsd?: number;
  };
  version?: string;
  minSkillVersion?: string;
  masterKeyPath?: string;
  authVerify?: AuthDeps["verify"];
  rollbackManager?: EmergencyRouterDeps["rollbackManager"];
  deployManager?: EmergencyRouterDeps["deployManager"];
  versionStore?: EmergencyRouterDeps["versionStore"];
  restartFn?: EmergencyRouterDeps["restartFn"];
  buildSystemContext?: (taskId: string) => Promise<unknown>;
  autoProcessQueue?: boolean;
}

/**
 * Mount ALL REST routers onto an Express app. This is used both by the
 * production entry point (src/index.ts) and by integration tests.
 */
export function buildApp(app: Express, deps: BuildAppDeps): void {
  const version = deps.version ?? "0.0.0-test";
  const startedAt = Date.now();

  const auth = authRequired({
    verify: deps.authVerify ?? (async () => "anonymous"),
  });

  const minSkillVersion = deps.minSkillVersion ?? "1.0.0";

  // Health is public (no auth)
  app.use(
    "/api/health",
    healthRouter({
      version,
      startedAt,
      adapter: deps.adapter,
    } satisfies HealthRouterDeps),
  );

  // Version / compatibility info is public (no auth)
  app.use(
    "/api/version",
    versionRouter({
      serverVersion: version,
      minSkillVersion,
    } satisfies VersionRouterDeps),
  );

  // Webhook callback is called by adapters -- no user auth
  app.use(
    "/api/webhook",
    webhookCallbackRouter({
      repo: deps.repo,
      pb: deps.pb,
    } satisfies WebhookCallbackRouterDeps),
  );

  // Auth-protected routes
  app.use(
    "/api/tasks",
    auth,
    tasksRouter({
      repo: deps.repo,
      manager: deps.manager,
      adapter: deps.adapter,
      buildSystemContext: deps.buildSystemContext ?? (async () => ({})),
      worktrees: deps.worktrees,
      ...(deps.autoProcessQueue === undefined
        ? {}
        : { autoProcessQueue: deps.autoProcessQueue }),
    } satisfies TasksRouterDeps),
  );

  app.use(
    "/api/settings",
    auth,
    settingsRouter({ pb: deps.pb } satisfies SettingsRouterDeps),
  );

  app.use(
    "/api/device",
    auth,
    devicesRouter({ pb: deps.pb } satisfies DevicesRouterDeps),
  );

  app.use(
    "/api/adapter",
    auth,
    adapterConfigRouter({
      manager: deps.manager as unknown as AdapterConfigRouterDeps["manager"],
    } satisfies AdapterConfigRouterDeps),
  );

  // Emergency ops
  app.use(
    "/api",
    auth,
    emergencyRouter({
      rollbackManager: deps.rollbackManager ?? { rollback: async () => {} },
      deployManager: deps.deployManager ?? { promote: async () => {} },
      restartFn: deps.restartFn ?? (async () => {}),
      versionStore: deps.versionStore ?? { list: async () => [] },
    } satisfies EmergencyRouterDeps),
  );

  // Internal (loopback-only)
  app.use(
    "/internal",
    internalApiKeysRouter({
      pb: deps.pb,
      masterKeyPath: deps.masterKeyPath ?? "/data/.anyraven/master.key",
    } satisfies InternalApiKeysDeps),
  );
}
