# Plan 2: MCP Server Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the AnyClaw MCP server package exposing 7 HTTP/SSE tools on `127.0.0.1:4100/mcp` with per-task bearer auth, backed by PocketBase and Plan 1 deploy/snapshot/version infrastructure.
**Architecture:** A new `packages/mcp-server/` package inside the Plan 1 monorepo. Exports `mountMcp(app, ctx)` which the Plan 1 `@anyclaw/dispatch` entrypoint mounts on its shared Express app (same app as Plan 3's REST API and Plan 1's health endpoint, port 4100). The MCP server does NOT call `app.listen` itself. Tool handlers wrap Plan 1 managers (`DeployManager`, `RollbackManager`, `SnapshotManager`, `VersionStore`) from `@anyclaw/shared` and an admin `PocketBase` client. Per-task bearer tokens are registered at task spawn, captured in a closure, and looked up on every request.
**Tech Stack:** @modelcontextprotocol/sdk ^1.12, express ^4.21, zod ^3.23, pocketbase ^0.25, vitest ^2.0, msw ^2.4, tsx, typescript ^5.6
**Dependencies:** Plan 1 (Server Infrastructure Foundation) must be complete. This plan assumes `@anyclaw/shared` exports `DeployManager`, `RollbackManager`, `SnapshotManager`, `VersionStore` with the signatures referenced below, that `/data/.anyclaw/pb-token` and `/data/.anyclaw/mcp-tokens/` exist, and that the npm workspaces monorepo already builds. The dispatch package `@anyclaw/dispatch` (scaffolded by Plan 1) will import and mount this package.
**Plans that depend on this:** Plan 3 (Agent Dispatch) — will import `mountMcp`, `registerTaskToken`, `revokeTaskToken` from `@anyclaw/mcp-server` and call `mountMcp(app, ctx)` on the shared dispatch Express app.

---

## Reference Map

Every task in this plan maps to a section of the design docs. Re-read the relevant section before starting a task.

| Task | Design section |
|------|----------------|
| 1 — Package scaffold | plan2 §11 |
| 2 — Bearer auth | plan2 §3.2 |
| 3 — PocketBase client | plan2 §4.1 |
| 4 — PocketBase collections install | plan2 §4.2 |
| 5 — Errors + wrapper | plan2 §10 |
| 6 — `anyclaw_update_progress` | plan2 §6.2, §7.7 |
| 7 — `anyclaw_list_versions` | plan2 §7.5 |
| 8 — `anyclaw_snapshot_db` | plan2 §7.4 |
| 9 — `anyclaw_create_collection` | plan2 §7.1 |
| 10 — `anyclaw_ask_user` | plan2 §6.1, §7.6 |
| 11 — `anyclaw_deploy` | plan2 §7.2, §8 |
| 12 — `anyclaw_rollback` | plan2 §7.3, §9 |
| 13 — `mountMcp` HTTP/SSE wiring | plan2 §3.1 |
| 14 — Task state + resume | plan2 §5 |
| 15 — Integration test: deploy happy path | plan2 §12.2 |

---

## Global Rules

- **Rigid TDD**: every task is `write failing test → run and confirm red → write impl → run and confirm green → commit`. Never skip the red step. Never commit red.
- All commands assume `cwd = F:/Codes/AnyClaw/anyclaw-server/packages/mcp-server` unless noted.
- Use Windows-friendly paths in commands (forward slashes in shell). Production paths like `/data/.anyclaw/...` appear in code but tests must use `process.env.ANYCLAW_DATA_ROOT` to override them to a tmp dir.
- Commit messages: `plan2/<task-id>: <short summary>`.
- After each task: `npm run -w @anyclaw/mcp-server test` must be green.

---

## Task 1 — Package Scaffold

- [ ] **1.1 Write failing test: package exists and builds.** Create `F:/Codes/AnyClaw/anyclaw-server/packages/mcp-server/src/__tests__/smoke.test.ts`:
  ```typescript
  import { describe, it, expect } from "vitest";
  import * as pkg from "../index.js";

  describe("package smoke", () => {
    it("exports mountMcp", () => {
      expect(typeof pkg.mountMcp).toBe("function");
    });
  });
  ```
- [ ] **1.2 Run test, confirm RED.** From repo root:
  ```
  npm run -w @anyclaw/mcp-server test
  ```
  Expect: package not found / no such workspace.
- [ ] **1.3 Create `packages/mcp-server/package.json`** exactly:
  ```json
  {
    "name": "@anyclaw/mcp-server",
    "version": "1.0.0",
    "private": true,
    "type": "module",
    "main": "dist/index.js",
    "types": "dist/index.d.ts",
    "scripts": {
      "build": "tsc -p tsconfig.json",
      "dev": "tsx src/index.ts",
      "test": "vitest run",
      "test:watch": "vitest",
      "lint": "eslint src"
    },
    "dependencies": {
      "@modelcontextprotocol/sdk": "^1.12.0",
      "@anyclaw/shared": "*",
      "pocketbase": "^0.25.0",
      "zod": "^3.23.0",
      "express": "^4.21.0"
    },
    "devDependencies": {
      "tsx": "^4.19.0",
      "typescript": "^5.6.0",
      "@types/express": "^4.17.0",
      "@types/node": "^22.0.0",
      "vitest": "^2.0.0",
      "msw": "^2.4.0"
    }
  }
  ```
- [ ] **1.4 Create `tsconfig.json`:**
  ```json
  {
    "compilerOptions": {
      "target": "ES2022",
      "module": "NodeNext",
      "moduleResolution": "NodeNext",
      "strict": true,
      "declaration": true,
      "outDir": "dist",
      "rootDir": "src",
      "esModuleInterop": true,
      "skipLibCheck": true,
      "resolveJsonModule": true,
      "types": ["node", "vitest/globals"]
    },
    "include": ["src/**/*"]
  }
  ```
- [ ] **1.5 Create `vitest.config.ts`:**
  ```typescript
  import { defineConfig } from "vitest/config";
  export default defineConfig({
    test: {
      globals: true,
      environment: "node",
      include: ["src/**/*.test.ts", "tests/**/*.test.ts"],
      coverage: { reporter: ["text"], include: ["src/**"] },
    },
  });
  ```
- [ ] **1.6 Create `src/env.ts`:**
  ```typescript
  import path from "node:path";
  export const DATA_ROOT = process.env.ANYCLAW_DATA_ROOT ?? "/data";
  export const PATHS = {
    anyclawDir:  path.join(DATA_ROOT, ".anyclaw"),
    mcpTokens:   path.join(DATA_ROOT, ".anyclaw", "mcp-tokens"),
    pbTokenFile: path.join(DATA_ROOT, ".anyclaw", "pb-token"),
    devRoot:     path.join(DATA_ROOT, "dev"),
    prodRoot:    path.join(DATA_ROOT, "prod"),
    worktreeDir: path.join(DATA_ROOT, "dev", ".worktrees"),
    snapshotDir: path.join(DATA_ROOT, ".anyclaw", "snapshots"),
  } as const;
  export const POCKETBASE_URL = process.env.POCKETBASE_URL ?? "http://127.0.0.1:8090";
  export const MCP_PORT = Number(process.env.ANYCLAW_MCP_PORT ?? 4100);
  ```
- [ ] **1.7 Create placeholder `src/index.ts`:**
  ```typescript
  import type { Express } from "express";
  export type McpContext = Record<string, never>;
  export function mountMcp(_app: Express, _ctx: McpContext = {}): void {
    throw new Error("mountMcp not implemented yet");
  }
  ```
- [ ] **1.8 Install deps at repo root, then run test:**
  ```
  npm install
  npm run -w @anyclaw/mcp-server test
  ```
  Expect: GREEN (smoke test passes).
- [ ] **1.9 Commit:** `plan2/task1: scaffold @anyclaw/mcp-server package`

---

## Task 2 — Per-Task Bearer Token Auth

- [ ] **2.1 Write failing test:** `src/__tests__/auth.test.ts`:
  ```typescript
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
  } from "../auth.js";

  let tmp: string;
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "anyclaw-auth-"));
    process.env.ANYCLAW_DATA_ROOT = tmp;
    fs.mkdirSync(path.join(tmp, ".anyclaw", "mcp-tokens"), { recursive: true });
    __resetTokenRegistryForTests();
  });
  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
    delete process.env.ANYCLAW_DATA_ROOT;
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
    it("writes token file with 0640 (best-effort)", () => {
      registerTaskToken("t1", "tok-abc");
      const p = path.join(tmp, ".anyclaw", "mcp-tokens", "task-t1.token");
      expect(fs.readFileSync(p, "utf8")).toBe("tok-abc");
    });
  });
  ```
- [ ] **2.2 Install `supertest`:**
  ```
  npm install -D -w @anyclaw/mcp-server supertest @types/supertest
  ```
- [ ] **2.3 Run test, confirm RED.**
- [ ] **2.4 Create `src/auth.ts`:**
  ```typescript
  import fs from "node:fs";
  import path from "node:path";
  import type { Request, Response, NextFunction } from "express";
  import { PATHS } from "./env.js";

  const tokenToTask = new Map<string, string>();

  export function __resetTokenRegistryForTests(): void {
    tokenToTask.clear();
  }

  export function registerTaskToken(taskId: string, token: string): void {
    tokenToTask.set(token, taskId);
    fs.mkdirSync(PATHS.mcpTokens, { recursive: true });
    const file = path.join(PATHS.mcpTokens, `task-${taskId}.token`);
    fs.writeFileSync(file, token, { mode: 0o640 });
  }

  export function revokeTaskToken(taskId: string): void {
    for (const [tok, id] of tokenToTask.entries()) {
      if (id === taskId) tokenToTask.delete(tok);
    }
    try {
      fs.unlinkSync(path.join(PATHS.mcpTokens, `task-${taskId}.token`));
    } catch { /* ignore */ }
  }

  const TOKEN_KEY = Symbol("anyclawToken");

  export function requireBearerToken(req: Request, res: Response, next: NextFunction): void {
    const header = req.header("authorization") ?? "";
    const m = /^Bearer (.+)$/.exec(header);
    if (!m || !tokenToTask.has(m[1])) {
      res.status(401).json({ error: "invalid_token" });
      return;
    }
    (req as any)[TOKEN_KEY] = m[1];
    next();
  }

  export function resolveTaskFromToken(req: Request): string {
    const tok = (req as any)[TOKEN_KEY] as string | undefined;
    const id = tok ? tokenToTask.get(tok) : undefined;
    if (!id) throw new Error("token_not_registered");
    return id;
  }
  ```
  Note: `PATHS` is evaluated once at import. Because tests reset `ANYCLAW_DATA_ROOT` per test, re-import is needed OR switch `PATHS` to a getter. Simpler: re-export a function `tokensDir()` that reads `process.env` each call.
- [ ] **2.5 Update `env.ts`** to also export a live helper:
  ```typescript
  export function currentPaths() {
    const root = process.env.ANYCLAW_DATA_ROOT ?? "/data";
    return {
      anyclawDir:  `${root}/.anyclaw`,
      mcpTokens:   `${root}/.anyclaw/mcp-tokens`,
      pbTokenFile: `${root}/.anyclaw/pb-token`,
      devRoot:     `${root}/dev`,
      prodRoot:    `${root}/prod`,
      worktreeDir: `${root}/dev/.worktrees`,
      snapshotDir: `${root}/.anyclaw/snapshots`,
    };
  }
  ```
  Replace `PATHS.mcpTokens` usage in `auth.ts` with `currentPaths().mcpTokens`.
- [ ] **2.6 Run test, confirm GREEN.**
- [ ] **2.7 Commit:** `plan2/task2: per-task bearer token auth middleware`

---

## Task 3 — PocketBase Admin Client

- [ ] **3.1 Write failing test:** `src/__tests__/pocketbase-client.test.ts`:
  ```typescript
  import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
  import fs from "node:fs";
  import os from "node:os";
  import path from "node:path";
  import { getPocketBaseAdmin, __resetPbClientForTests } from "../pocketbase-client.js";

  let tmp: string;
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "anyclaw-pb-"));
    process.env.ANYCLAW_DATA_ROOT = tmp;
    fs.mkdirSync(path.join(tmp, ".anyclaw"), { recursive: true });
    fs.writeFileSync(path.join(tmp, ".anyclaw", "pb-token"), "file-token-xyz");
    __resetPbClientForTests();
  });
  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
    delete process.env.ANYCLAW_DATA_ROOT;
    delete process.env.PB_ADMIN_TOKEN;
    delete process.env.POCKETBASE_URL;
  });

  describe("PocketBase client", () => {
    it("uses env token when set", () => {
      process.env.PB_ADMIN_TOKEN = "env-token";
      const pb = getPocketBaseAdmin();
      expect(pb.authStore.token).toBe("env-token");
    });
    it("falls back to pb-token file", () => {
      const pb = getPocketBaseAdmin();
      expect(pb.authStore.token).toBe("file-token-xyz");
    });
    it("is a singleton", () => {
      expect(getPocketBaseAdmin()).toBe(getPocketBaseAdmin());
    });
  });
  ```
- [ ] **3.2 Run test, confirm RED.**
- [ ] **3.3 Create `src/pocketbase-client.ts`:**
  ```typescript
  import fs from "node:fs";
  import PocketBase from "pocketbase";
  import { POCKETBASE_URL, currentPaths } from "./env.js";

  let pb: PocketBase | null = null;

  export function __resetPbClientForTests(): void { pb = null; }

  export function getPocketBaseAdmin(): PocketBase {
    if (pb) return pb;
    const token = process.env.PB_ADMIN_TOKEN
      ?? fs.readFileSync(currentPaths().pbTokenFile, "utf8").trim();
    pb = new PocketBase(POCKETBASE_URL);
    pb.authStore.save(token, null);
    return pb;
  }

  /** Retry helper: 3 attempts at 1s/2s/4s for transient PocketBase outages. */
  export async function withPbRetry<T>(fn: () => Promise<T>): Promise<T> {
    const delays = [1000, 2000, 4000];
    let lastErr: unknown;
    for (let i = 0; i <= delays.length; i++) {
      try { return await fn(); }
      catch (e) {
        lastErr = e;
        if (i === delays.length) break;
        await new Promise(r => setTimeout(r, delays[i]));
      }
    }
    throw lastErr;
  }
  ```
  `POCKETBASE_URL` should also be a live getter. Change `env.ts`: `export const POCKETBASE_URL = process.env.POCKETBASE_URL ?? "http://127.0.0.1:8090";` — OK to leave static because tests don't override it here.
- [ ] **3.4 Run test, confirm GREEN.**
- [ ] **3.5 Commit:** `plan2/task3: PocketBase admin client with retry helper`

---

## Task 4 — Internal Collections Bootstrap

- [ ] **4.1 Write failing test:** `src/__tests__/install-collections.test.ts`:
  ```typescript
  import { describe, it, expect, vi } from "vitest";
  import { ensureInternalCollections } from "../install-collections.js";

  function makePbMock() {
    const existing = new Map<string, any>();
    return {
      existing,
      collections: {
        getOne: vi.fn(async (name: string) => {
          if (!existing.has(name)) throw Object.assign(new Error("404"), { status: 404 });
          return existing.get(name);
        }),
        create: vi.fn(async (spec: any) => {
          existing.set(spec.name, { id: `id-${spec.name}`, ...spec });
          return { id: `id-${spec.name}`, ...spec };
        }),
      },
    };
  }

  describe("ensureInternalCollections", () => {
    it("creates all six collections on first run", async () => {
      const pb = makePbMock();
      await ensureInternalCollections(pb as any);
      const names = [...pb.existing.keys()].sort();
      expect(names).toEqual(["_agent_messages", "_api_keys", "_deployments", "_tasks", "_user_preferences", "_versions"]);
    });
    it("is idempotent", async () => {
      const pb = makePbMock();
      await ensureInternalCollections(pb as any);
      await ensureInternalCollections(pb as any);
      expect(pb.collections.create).toHaveBeenCalledTimes(6);
    });
    it("_tasks has expected fields", async () => {
      const pb = makePbMock();
      await ensureInternalCollections(pb as any);
      const tasks = pb.existing.get("_tasks");
      const fieldNames = tasks.schema.map((f: any) => f.name).sort();
      expect(fieldNames).toEqual([
        "agentType","checkpoint","error","finishedAt","request","startedAt","state","taskId","worktreePath",
      ]);
    });
  });
  ```
- [ ] **4.2 Run test, confirm RED.**
- [ ] **4.3 Create `src/install-collections.ts`:**
  ```typescript
  import type PocketBase from "pocketbase";

  type Field = { name: string; type: string; required?: boolean; options?: Record<string, unknown> };
  type CollSpec = {
    name: string;
    type?: "base" | "auth";
    schema: Field[];
    listRule?: string | null;
    viewRule?: string | null;
    createRule?: string | null;
    updateRule?: string | null;
    deleteRule?: string | null;
    indexes?: string[];
  };

  const ADMIN_ONLY = {
    listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null,
  };

  const TASKS: CollSpec = {
    name: "_tasks",
    schema: [
      { name: "taskId",       type: "text",   required: true, options: { max: 64 } },
      { name: "request",      type: "text",   required: true },
      { name: "state",        type: "select", required: true, options: { maxSelect: 1, values: ["queued","clarifying","working","deploying","done","failed","cancelled"] } },
      { name: "agentType",    type: "text",   required: true },
      { name: "checkpoint",   type: "json" },
      { name: "error",        type: "text" },
      { name: "worktreePath", type: "text" },
      { name: "startedAt",    type: "date" },
      { name: "finishedAt",   type: "date" },
    ],
    indexes: ["CREATE UNIQUE INDEX idx_tasks_taskid ON _tasks (taskId)"],
    ...ADMIN_ONLY,
  };

  const AGENT_MESSAGES: CollSpec = {
    name: "_agent_messages",
    schema: [
      { name: "taskId",     type: "text",   required: true },
      { name: "direction",  type: "select", required: true, options: { maxSelect: 1, values: ["agent_to_user","user_to_agent"] } },
      { name: "type",       type: "select", required: true, options: { maxSelect: 1, values: ["question","answer","progress","deploy_event"] } },
      { name: "content",    type: "text",   required: true },
      { name: "options",    type: "json" },
      { name: "phase",      type: "select", options: { maxSelect: 1, values: ["clarifying","working","deploying"] } },
      { name: "percent",    type: "number" },
      { name: "questionId", type: "text" },
      { name: "answeredAt", type: "date" },
    ],
    indexes: ["CREATE INDEX idx_msgs_task ON _agent_messages (taskId)"],
    ...ADMIN_ONLY,
  };

  const VERSIONS: CollSpec = {
    name: "_versions",
    schema: [
      { name: "version",      type: "text",   required: true, options: { max: 32 } },
      { name: "description",  type: "text",   required: true, options: { min: 10 } },
      { name: "gitCommit",    type: "text",   required: true, options: { max: 64 } },
      { name: "gitTag",       type: "text" },
      { name: "dbSnapshotId", type: "text" },
      { name: "deployedBy",   type: "text" },
      { name: "artifacts",    type: "json" },
    ],
    indexes: ["CREATE UNIQUE INDEX idx_versions_version ON _versions (version)"],
    ...ADMIN_ONLY,
  };

  const USER_PREFS: CollSpec = {
    name: "_user_preferences",
    schema: [
      { name: "key",   type: "text", required: true },
      { name: "value", type: "json" },
    ],
    indexes: ["CREATE UNIQUE INDEX idx_prefs_key ON _user_preferences (key)"],
    ...ADMIN_ONLY,
  };

  const API_KEYS: CollSpec = {
    name: "_api_keys",
    schema: [
      { name: "name",          type: "text", required: true },
      { name: "ciphertext",    type: "text", required: true },
      { name: "nonce",         type: "text", required: true },
      { name: "createdByTask", type: "text" },
    ],
    indexes: ["CREATE UNIQUE INDEX idx_keys_name ON _api_keys (name)"],
    ...ADMIN_ONLY,
  };

  const DEPLOYMENTS: CollSpec = {
    name: "_deployments",
    schema: [
      { name: "version_tag",    type: "text", required: true, options: { max: 64 } },
      { name: "description",    type: "text", required: true },
      { name: "created_at",     type: "autodate" },
      { name: "git_sha",        type: "text" },
      { name: "db_snapshot_id", type: "text" },
    ],
    indexes: ["CREATE INDEX idx_deployments_created ON _deployments (created_at)"],
    ...ADMIN_ONLY,
  };

  const ALL: CollSpec[] = [TASKS, AGENT_MESSAGES, VERSIONS, USER_PREFS, API_KEYS, DEPLOYMENTS];

  export async function ensureInternalCollections(pb: PocketBase): Promise<void> {
    for (const spec of ALL) {
      try {
        await pb.collections.getOne(spec.name);
      } catch (e: any) {
        if (e?.status !== 404) throw e;
        await pb.collections.create(spec as any);
      }
    }
  }
  ```
- [ ] **4.4 Run test, confirm GREEN.**
- [ ] **4.5 Commit:** `plan2/task4: _tasks/_agent_messages/_versions/_user_preferences/_api_keys/_deployments bootstrap`

Note on `_deployments` population (simpler approach): Plan 1's `DeployManager.run()` is the single writer — on a successful deploy it writes a row to BOTH `_versions` (existing behavior) AND `_deployments` (new, for Plan 5 subscriptions). Plan 5 subscribes to `_deployments` create events. This keeps the MCP tool a pure delegator.

---

## Task 5 — ToolError and withErrorHandling Wrapper

- [ ] **5.1 Write failing test:** `src/__tests__/errors.test.ts`:
  ```typescript
  import { describe, it, expect } from "vitest";
  import { ToolError } from "../errors.js";
  import { withErrorHandling } from "../tools/register.js";

  describe("withErrorHandling", () => {
    it("passes through success", async () => {
      const h = withErrorHandling(async (x: number) => ({
        content: [{ type: "text", text: String(x) }],
        structuredContent: { x },
      }));
      const out = await h(42);
      expect(out.isError).toBeUndefined();
      expect(out.structuredContent).toEqual({ x: 42 });
    });
    it("converts ToolError to isError result", async () => {
      const h = withErrorHandling(async () => {
        throw new ToolError("nope", { k: 1 });
      });
      const out = await h();
      expect(out.isError).toBe(true);
      expect(out.content[0]).toMatchObject({ type: "text", text: "nope" });
      expect(out.content[1]).toMatchObject({ type: "text" });
      expect(JSON.parse((out.content[1] as any).text)).toEqual({ k: 1 });
    });
    it("converts unknown throw to internal error", async () => {
      const h = withErrorHandling(async () => { throw new Error("boom"); });
      const out = await h();
      expect(out.isError).toBe(true);
      expect((out.content[0] as any).text).toContain("Internal error: boom");
    });
  });
  ```
- [ ] **5.2 Run test, confirm RED.**
- [ ] **5.3 Create `src/errors.ts`:**
  ```typescript
  export class ToolError extends Error {
    constructor(message: string, public readonly details?: Record<string, unknown>) {
      super(message);
      this.name = "ToolError";
    }
  }
  ```
- [ ] **5.4 Create `src/tools/register.ts`:**
  ```typescript
  import { ToolError } from "../errors.js";

  type ToolResult = {
    content: Array<{ type: "text"; text: string }>;
    structuredContent?: unknown;
    isError?: boolean;
  };

  export function withErrorHandling<A extends any[]>(
    handler: (...args: A) => Promise<ToolResult>,
  ): (...args: A) => Promise<ToolResult> {
    return async (...args: A) => {
      try {
        return await handler(...args);
      } catch (err) {
        const message = err instanceof ToolError
          ? err.message
          : `Internal error: ${err instanceof Error ? err.message : String(err)}`;
        const details = err instanceof ToolError ? err.details : undefined;
        return {
          content: [
            { type: "text", text: message },
            ...(details ? [{ type: "text" as const, text: JSON.stringify(details, null, 2) }] : []),
          ],
          isError: true,
        };
      }
    };
  }
  ```
- [ ] **5.5 Run test, confirm GREEN.**
- [ ] **5.6 Commit:** `plan2/task5: ToolError + withErrorHandling wrapper`

---

## Task 6 — `anyclaw_update_progress`

- [ ] **6.1 Write failing test:** `src/tools/__tests__/update-progress.test.ts`:
  ```typescript
  import { describe, it, expect, vi } from "vitest";
  import { makeUpdateProgressHandler } from "../update-progress.js";

  describe("anyclaw_update_progress", () => {
    it("writes progress record and returns delivered=true", async () => {
      const create = vi.fn().mockResolvedValue({ id: "rec1" });
      const pb = { collection: () => ({ create }) };
      const h = makeUpdateProgressHandler(() => pb as any);
      const out = await h({ message: "step 1", phase: "working", percent: 25 }, { taskId: "t1" });
      expect(out.isError).toBeUndefined();
      expect(create).toHaveBeenCalledWith({
        taskId: "t1",
        direction: "agent_to_user",
        type: "progress",
        content: "step 1",
        phase: "working",
        percent: 25,
      });
      expect(out.structuredContent).toEqual({ delivered: true });
    });
    it("returns isError when PB throws", async () => {
      const pb = { collection: () => ({ create: vi.fn().mockRejectedValue(new Error("offline")) }) };
      const h = makeUpdateProgressHandler(() => pb as any);
      const out = await h({ message: "x", phase: "working" }, { taskId: "t1" });
      expect(out.isError).toBe(true);
    });
  });
  ```
- [ ] **6.2 Run test, confirm RED.**
- [ ] **6.3 Create `src/tools/update-progress.ts`:**
  ```typescript
  import { z } from "zod";
  import type PocketBase from "pocketbase";
  import { withErrorHandling } from "./register.js";
  import { getPocketBaseAdmin } from "../pocketbase-client.js";

  export const updateProgressInput = z.object({
    message: z.string().min(1),
    phase: z.enum(["clarifying", "working", "deploying"]).default("working"),
    percent: z.number().min(0).max(100).optional(),
  });
  export const updateProgressOutput = z.object({ delivered: z.boolean() });

  export type Ctx = { taskId: string };

  export function makeUpdateProgressHandler(pbFactory: () => PocketBase = getPocketBaseAdmin) {
    return withErrorHandling(async (
      input: z.infer<typeof updateProgressInput>,
      ctx: Ctx,
    ) => {
      await pbFactory().collection("_agent_messages").create({
        taskId: ctx.taskId,
        direction: "agent_to_user",
        type: "progress",
        content: input.message,
        phase: input.phase,
        percent: input.percent,
      });
      return {
        content: [{ type: "text" as const, text: `Progress: ${input.message}` }],
        structuredContent: { delivered: true },
      };
    });
  }

  export function registerUpdateProgress(server: any, ctx: Ctx) {
    server.registerTool(
      "anyclaw_update_progress",
      {
        title: "Update Progress",
        description:
          "Post a progress update to the mobile app's task card. Non-blocking. Use frequently during long operations.",
        inputSchema: updateProgressInput,
        outputSchema: updateProgressOutput,
      },
      (input: any) => makeUpdateProgressHandler()(input, ctx),
    );
  }
  ```
- [ ] **6.4 Run test, confirm GREEN.**
- [ ] **6.5 Commit:** `plan2/task6: anyclaw_update_progress tool`

---

## Task 7 — `anyclaw_list_versions`

- [ ] **7.1 Write failing test:** `src/tools/__tests__/list-versions.test.ts`:
  ```typescript
  import { describe, it, expect, vi } from "vitest";
  import { makeListVersionsHandler } from "../list-versions.js";

  const rows = [
    { version: "v1.0.1", description: "fix",   created: "2026-04-05T00:00:00Z", gitCommit: "aaa", dbSnapshotId: "s1" },
    { version: "v1.0.0", description: "init",  created: "2026-04-04T00:00:00Z", gitCommit: "bbb", dbSnapshotId: null },
  ];

  describe("anyclaw_list_versions", () => {
    it("returns mapped rows", async () => {
      const getList = vi.fn().mockResolvedValue({ items: rows });
      const pb = { collection: () => ({ getList }) };
      const h = makeListVersionsHandler(() => pb as any);
      const out = await h({ limit: 10 });
      expect(getList).toHaveBeenCalledWith(1, 10, { sort: "-created" });
      expect((out.structuredContent as any).versions).toHaveLength(2);
      expect((out.structuredContent as any).versions[0].version).toBe("v1.0.1");
      expect((out.structuredContent as any).versions[1].dbSnapshotId).toBeNull();
    });
    it("defaults limit to 10 via schema parse", async () => {
      const parsed = (await import("../list-versions.js")).listVersionsInput.parse({});
      expect(parsed.limit).toBe(10);
    });
    it("rejects limit > 100", async () => {
      const mod = await import("../list-versions.js");
      expect(() => mod.listVersionsInput.parse({ limit: 500 })).toThrow();
    });
  });
  ```
- [ ] **7.2 Run test, confirm RED.**
- [ ] **7.3 Create `src/tools/list-versions.ts`:**
  ```typescript
  import { z } from "zod";
  import type PocketBase from "pocketbase";
  import { withErrorHandling } from "./register.js";
  import { getPocketBaseAdmin, withPbRetry } from "../pocketbase-client.js";

  export const listVersionsInput = z.object({
    limit: z.number().int().min(1).max(100).default(10),
  });
  export const listVersionsOutput = z.object({
    versions: z.array(z.object({
      version: z.string(),
      description: z.string(),
      timestamp: z.string(),
      gitCommit: z.string(),
      dbSnapshotId: z.string().nullable(),
    })),
  });

  export function makeListVersionsHandler(pbFactory: () => PocketBase = getPocketBaseAdmin) {
    return withErrorHandling(async (input: z.infer<typeof listVersionsInput>) => {
      const rows = await withPbRetry(() =>
        pbFactory().collection("_versions").getList(1, input.limit, { sort: "-created" })
      );
      const versions = rows.items.map((r: any) => ({
        version: r.version,
        description: r.description,
        timestamp: r.created,
        gitCommit: r.gitCommit,
        dbSnapshotId: r.dbSnapshotId ?? null,
      }));
      return {
        content: [{ type: "text" as const, text: `Found ${versions.length} versions` }],
        structuredContent: { versions },
      };
    });
  }

  export function registerListVersions(server: any) {
    server.registerTool(
      "anyclaw_list_versions",
      { title: "List Versions", description: "Show deployment history.", inputSchema: listVersionsInput, outputSchema: listVersionsOutput },
      (input: any) => makeListVersionsHandler()(input),
    );
  }
  ```
- [ ] **7.4 Run test, confirm GREEN.**
- [ ] **7.5 Commit:** `plan2/task7: anyclaw_list_versions tool`

---

## Task 8 — `anyclaw_snapshot_db`

- [ ] **8.1 Write failing test:** `src/tools/__tests__/snapshot-db.test.ts`:
  ```typescript
  import { describe, it, expect, vi } from "vitest";
  import { makeSnapshotDbHandler, snapshotDbInput } from "../snapshot-db.js";

  describe("anyclaw_snapshot_db", () => {
    it("calls snapshotManager.create with label and returns structured content", async () => {
      const snap = { snapshotId: "s1", sizeBytes: 123, path: "/tmp/s1.gz" };
      const mgr = { create: vi.fn().mockResolvedValue(snap) };
      const h = makeSnapshotDbHandler(() => mgr as any);
      const out = await h({ label: "manual-before-migration" });
      expect(mgr.create).toHaveBeenCalledWith("manual-before-migration");
      expect(out.structuredContent).toEqual(snap);
    });
    it("rejects label shorter than 3 chars", () => {
      expect(() => snapshotDbInput.parse({ label: "ab" })).toThrow();
    });
    it("returns isError when snapshot fails", async () => {
      const mgr = { create: vi.fn().mockRejectedValue(new Error("disk full")) };
      const h = makeSnapshotDbHandler(() => mgr as any);
      const out = await h({ label: "xyz" });
      expect(out.isError).toBe(true);
    });
  });
  ```
- [ ] **8.2 Run test, confirm RED.**
- [ ] **8.3 Create `src/tools/snapshot-db.ts`:**
  ```typescript
  import { z } from "zod";
  import { withErrorHandling } from "./register.js";

  export type SnapshotManagerLike = {
    create(label: string): Promise<{ snapshotId: string; sizeBytes: number; path: string }>;
  };

  export const snapshotDbInput = z.object({
    label: z.string().min(3).describe("Short label, e.g. 'before-mood-data-migration'"),
  });
  export const snapshotDbOutput = z.object({
    snapshotId: z.string(),
    sizeBytes: z.number(),
    path: z.string(),
  });

  let defaultMgr: () => SnapshotManagerLike = () => {
    // Lazy import to keep @anyclaw/shared optional for unit tests.
    const { snapshotManager } = require("@anyclaw/shared") as { snapshotManager: SnapshotManagerLike };
    return snapshotManager;
  };

  export function makeSnapshotDbHandler(factory: () => SnapshotManagerLike = defaultMgr) {
    return withErrorHandling(async (input: z.infer<typeof snapshotDbInput>) => {
      const snap = await factory().create(input.label);
      return {
        content: [{ type: "text" as const, text: `Snapshot created: ${snap.snapshotId} (${snap.sizeBytes} bytes)` }],
        structuredContent: snap,
      };
    });
  }

  export function registerSnapshotDb(server: any) {
    server.registerTool(
      "anyclaw_snapshot_db",
      {
        title: "Snapshot Database",
        description: "Create a compressed SQLite snapshot. Called automatically before schema migrations.",
        inputSchema: snapshotDbInput,
        outputSchema: snapshotDbOutput,
      },
      (input: any) => makeSnapshotDbHandler()(input),
    );
  }
  ```
- [ ] **8.4 Run test, confirm GREEN.**
- [ ] **8.5 Commit:** `plan2/task8: anyclaw_snapshot_db tool`

---

## Task 9 — `anyclaw_create_collection`

- [ ] **9.1 Write failing test:** `src/tools/__tests__/create-collection.test.ts`:
  ```typescript
  import { describe, it, expect, vi } from "vitest";
  import { makeCreateCollectionHandler } from "../create-collection.js";

  const baseInput = {
    name: "mood_entries",
    type: "base" as const,
    fields: [
      { name: "score", type: "number" as const, required: true },
      { name: "note",  type: "text"   as const, required: false },
    ],
  };

  describe("anyclaw_create_collection", () => {
    it("snapshots then creates and returns structured content", async () => {
      const snap = { snapshotId: "snap-1", sizeBytes: 1, path: "/x" };
      const snapMgr = { create: vi.fn().mockResolvedValue(snap) };
      const pbCreate = vi.fn().mockResolvedValue({ id: "col-1" });
      const pb = { collections: { create: pbCreate } };
      const h = makeCreateCollectionHandler(() => snapMgr as any, () => pb as any);
      const out = await h(baseInput);
      expect(snapMgr.create).toHaveBeenCalledTimes(1);
      expect(pbCreate).toHaveBeenCalledTimes(1);
      expect(out.structuredContent).toEqual({
        collectionId: "col-1",
        collectionName: "mood_entries",
        fieldsCreated: 2,
        snapshotId: "snap-1",
      });
    });
    it("rejects reserved names starting with _", async () => {
      const snapMgr = { create: vi.fn() };
      const pb = { collections: { create: vi.fn() } };
      const h = makeCreateCollectionHandler(() => snapMgr as any, () => pb as any);
      const out = await h({ ...baseInput, name: "_foo" });
      expect(out.isError).toBe(true);
      expect(snapMgr.create).not.toHaveBeenCalled();
    });
    it("surfaces PocketBase errors after snapshot", async () => {
      const snapMgr = { create: vi.fn().mockResolvedValue({ snapshotId: "s", sizeBytes: 0, path: "" }) };
      const pb = { collections: { create: vi.fn().mockRejectedValue(new Error("duplicate")) } };
      const h = makeCreateCollectionHandler(() => snapMgr as any, () => pb as any);
      const out = await h(baseInput);
      expect(out.isError).toBe(true);
    });
  });
  ```
- [ ] **9.2 Run test, confirm RED.**
- [ ] **9.3 Create `src/tools/create-collection.ts`:**
  ```typescript
  import { z } from "zod";
  import type PocketBase from "pocketbase";
  import { withErrorHandling } from "./register.js";
  import { ToolError } from "../errors.js";
  import { getPocketBaseAdmin } from "../pocketbase-client.js";
  import type { SnapshotManagerLike } from "./snapshot-db.js";

  export const createCollectionInput = z.object({
    name: z.string().regex(/^[a-z][a-z0-9_]*$/),
    type: z.enum(["base", "auth", "view"]).default("base"),
    fields: z.array(z.object({
      name: z.string(),
      type: z.enum(["text","number","bool","email","url","date","select","json","file","relation","editor"]),
      required: z.boolean().default(false),
      options: z.record(z.unknown()).optional(),
    })).min(1),
    listRule:   z.string().nullable().optional(),
    viewRule:   z.string().nullable().optional(),
    createRule: z.string().nullable().optional(),
    updateRule: z.string().nullable().optional(),
    deleteRule: z.string().nullable().optional(),
  });

  export const createCollectionOutput = z.object({
    collectionId: z.string(),
    collectionName: z.string(),
    fieldsCreated: z.number(),
    snapshotId: z.string(),
  });

  let defaultSnap: () => SnapshotManagerLike = () => (require("@anyclaw/shared") as any).snapshotManager;

  export function makeCreateCollectionHandler(
    snapFactory: () => SnapshotManagerLike = defaultSnap,
    pbFactory: () => PocketBase = getPocketBaseAdmin,
  ) {
    return withErrorHandling(async (input: z.infer<typeof createCollectionInput>) => {
      if (input.name.startsWith("_")) {
        throw new ToolError("Collection names starting with '_' are reserved for AnyClaw infrastructure");
      }
      const snap = await snapFactory().create(`pre-schema-${input.name}-${Date.now()}`);
      const created = await pbFactory().collections.create({
        name: input.name,
        type: input.type,
        schema: input.fields.map(f => ({
          name: f.name, type: f.type, required: f.required, options: f.options ?? {},
        })),
        listRule:   input.listRule   ?? null,
        viewRule:   input.viewRule   ?? null,
        createRule: input.createRule ?? null,
        updateRule: input.updateRule ?? null,
        deleteRule: input.deleteRule ?? null,
      } as any);
      return {
        content: [{ type: "text" as const, text: `Created collection '${input.name}' with ${input.fields.length} fields (snapshot: ${snap.snapshotId})` }],
        structuredContent: {
          collectionId: (created as any).id,
          collectionName: input.name,
          fieldsCreated: input.fields.length,
          snapshotId: snap.snapshotId,
        },
      };
    });
  }

  export function registerCreateCollection(server: any) {
    server.registerTool(
      "anyclaw_create_collection",
      {
        title: "Create Collection",
        description: "Create a new PocketBase collection. Automatically snapshots the database before the schema change.",
        inputSchema: createCollectionInput,
        outputSchema: createCollectionOutput,
        annotations: { destructiveHint: true, idempotentHint: false },
      },
      (input: any) => makeCreateCollectionHandler()(input),
    );
  }
  ```
- [ ] **9.4 Run test, confirm GREEN.**
- [ ] **9.5 Commit:** `plan2/task9: anyclaw_create_collection tool`

---

## Task 10 — `anyclaw_ask_user`

- [ ] **10.1 Write failing test:** `src/tools/__tests__/ask-user.test.ts`:
  ```typescript
  import { describe, it, expect, vi } from "vitest";
  import { makeAskUserHandler } from "../ask-user.js";

  function fakePb() {
    const subs: any[] = [];
    return {
      subs,
      collection: () => ({
        create: vi.fn().mockResolvedValue({ id: "q1" }),
        subscribe: vi.fn().mockImplementation((_t, cb, _opts) => {
          subs.push(cb);
          return Promise.resolve(() => { /* unsub */ });
        }),
        unsubscribe: vi.fn(),
      }),
    };
  }

  describe("anyclaw_ask_user", () => {
    it("resolves with the answer record when a matching answer arrives", async () => {
      const pb = fakePb();
      const h = makeAskUserHandler(() => pb as any);
      const p = h({ question: "Daily?", options: ["Daily","MTD"], timeoutMs: 5000 }, { taskId: "t1" });
      // wait a tick so subscribe runs
      await new Promise(r => setImmediate(r));
      pb.subs[0]({
        action: "create",
        record: { direction: "user_to_agent", type: "answer", questionId: "q1", content: "Daily", answeredAt: "2026-04-06T00:00:00Z" },
      });
      const out = await p;
      expect(out.isError).toBeUndefined();
      expect((out.structuredContent as any).answer).toBe("Daily");
      expect((out.structuredContent as any).timedOut).toBe(false);
    });

    it("returns isError on timeout", async () => {
      vi.useFakeTimers();
      const pb = fakePb();
      const h = makeAskUserHandler(() => pb as any);
      const p = h({ question: "Q", timeoutMs: 1000 }, { taskId: "t1" });
      await vi.advanceTimersByTimeAsync(1001);
      const out = await p;
      vi.useRealTimers();
      expect(out.isError).toBe(true);
      expect((out.content[0] as any).text).toContain("timed out");
    });

    it("ignores answers for other questions", async () => {
      const pb = fakePb();
      const h = makeAskUserHandler(() => pb as any);
      const p = h({ question: "Q", timeoutMs: 5000 }, { taskId: "t1" });
      await new Promise(r => setImmediate(r));
      pb.subs[0]({ action: "create", record: { direction: "user_to_agent", type: "answer", questionId: "other", content: "x" } });
      pb.subs[0]({ action: "create", record: { direction: "user_to_agent", type: "answer", questionId: "q1", content: "yes", answeredAt: "z" } });
      const out = await p;
      expect((out.structuredContent as any).answer).toBe("yes");
    });
  });
  ```
- [ ] **10.2 Run test, confirm RED.**
- [ ] **10.3 Create `src/tools/ask-user.ts`:**
  ```typescript
  import { z } from "zod";
  import type PocketBase from "pocketbase";
  import { withErrorHandling } from "./register.js";
  import { ToolError } from "../errors.js";
  import { getPocketBaseAdmin } from "../pocketbase-client.js";

  export const askUserInput = z.object({
    question: z.string().min(1),
    options: z.array(z.string()).max(8).optional(),
    timeoutMs: z.number().int().min(1000).max(600000).default(300000),
  });
  export const askUserOutput = z.object({
    answer: z.string(),
    answeredAt: z.string(),
    timedOut: z.boolean(),
  });

  type Ctx = { taskId: string };

  export function makeAskUserHandler(pbFactory: () => PocketBase = getPocketBaseAdmin) {
    return withErrorHandling(async (input: z.infer<typeof askUserInput>, ctx: Ctx) => {
      const pb = pbFactory();
      const col = pb.collection("_agent_messages");
      const q = await col.create({
        taskId: ctx.taskId,
        direction: "agent_to_user",
        type: "question",
        content: input.question,
        options: input.options ?? null,
      });

      const answer = await new Promise<{ content: string; answeredAt: string }>((resolve, reject) => {
        let unsub: (() => void) | null = null;
        const timer = setTimeout(() => {
          try { unsub?.(); } catch { /* ignore */ }
          reject(new ToolError("anyclaw_ask_user timed out waiting for user response", { timedOut: true, questionId: (q as any).id }));
        }, input.timeoutMs);

        const cb = (e: any) => {
          const r = e?.record;
          if (
            e?.action === "create" &&
            r?.direction === "user_to_agent" &&
            r?.type === "answer" &&
            r?.questionId === (q as any).id
          ) {
            clearTimeout(timer);
            try { unsub?.(); } catch { /* ignore */ }
            resolve({ content: r.content, answeredAt: r.answeredAt ?? new Date().toISOString() });
          }
        };
        Promise.resolve(col.subscribe("*", cb, { filter: `taskId = "${ctx.taskId}"` } as any))
          .then((u: any) => { unsub = typeof u === "function" ? u : null; })
          .catch((err) => { clearTimeout(timer); reject(err); });
      });

      return {
        content: [{ type: "text" as const, text: `User answered: ${answer.content}` }],
        structuredContent: { answer: answer.content, answeredAt: answer.answeredAt, timedOut: false },
      };
    });
  }

  export function registerAskUser(server: any, ctx: Ctx) {
    server.registerTool(
      "anyclaw_ask_user",
      {
        title: "Ask User",
        description: "Post a clarifying question to the mobile app and wait for the user's answer.",
        inputSchema: askUserInput,
        outputSchema: askUserOutput,
      },
      (input: any) => makeAskUserHandler()(input, ctx),
    );
  }
  ```
- [ ] **10.4 Run test, confirm GREEN.**
- [ ] **10.5 Commit:** `plan2/task10: anyclaw_ask_user with realtime subscribe + timeout`

---

## Task 11 — `anyclaw_deploy`

- [ ] **11.1 Write failing test:** `src/tools/__tests__/deploy.test.ts`:
  ```typescript
  import { describe, it, expect, vi } from "vitest";
  import { makeDeployHandler, deployInput } from "../deploy.js";

  const happy = {
    version: "v1.0.1",
    gitCommit: "abc123",
    gitTag: "v1.0.1",
    dbSnapshotId: "snap-1",
    validationResults: { lint: true, typecheck: true, build: true, smokeTests: true },
  };

  describe("anyclaw_deploy", () => {
    it("delegates to DeployManager.run and returns structured content", async () => {
      const mgr = { run: vi.fn().mockResolvedValue(happy) };
      const h = makeDeployHandler(() => mgr as any);
      const out = await h({ versionDescription: "adds mood tracking feature", skipDbSnapshot: false }, { taskId: "t1" });
      expect(mgr.run).toHaveBeenCalledWith({ taskId: "t1", versionDescription: "adds mood tracking feature", skipDbSnapshot: false });
      expect(out.structuredContent).toEqual(happy);
      expect(out.isError).toBeUndefined();
    });
    it("rejects short version descriptions (schema)", () => {
      expect(() => deployInput.parse({ versionDescription: "short" })).toThrow();
    });
    it("returns isError when deploy fails validation", async () => {
      const mgr = { run: vi.fn().mockRejectedValue(new Error("lint failed:\n...")) };
      const h = makeDeployHandler(() => mgr as any);
      const out = await h({ versionDescription: "ten chars..", skipDbSnapshot: false }, { taskId: "t1" });
      expect(out.isError).toBe(true);
      expect((out.content[0] as any).text).toContain("lint failed");
    });
  });
  ```
- [ ] **11.2 Run test, confirm RED.**
- [ ] **11.3 Create `src/tools/deploy.ts`:**
  ```typescript
  import { z } from "zod";
  import { withErrorHandling } from "./register.js";

  export type DeployManagerLike = {
    run(args: { taskId: string; versionDescription: string; skipDbSnapshot: boolean }): Promise<{
      version: string;
      gitCommit: string;
      gitTag: string;
      dbSnapshotId: string | null;
      validationResults: { lint: boolean; typecheck: boolean; build: boolean; smokeTests: boolean };
    }>;
  };

  export const deployInput = z.object({
    versionDescription: z.string().min(10).describe("User-facing description of what changed. Minimum 10 characters."),
    skipDbSnapshot: z.boolean().default(false),
  });
  export const deployOutput = z.object({
    version: z.string(),
    gitCommit: z.string(),
    gitTag: z.string(),
    dbSnapshotId: z.string().nullable(),
    validationResults: z.object({
      lint: z.boolean(), typecheck: z.boolean(), build: z.boolean(), smokeTests: z.boolean(),
    }),
  });

  let defaultMgr: () => DeployManagerLike = () => (require("@anyclaw/shared") as any).deployManager;

  export function makeDeployHandler(factory: () => DeployManagerLike = defaultMgr) {
    return withErrorHandling(async (
      input: z.infer<typeof deployInput>,
      ctx: { taskId: string },
    ) => {
      const result = await factory().run({
        taskId: ctx.taskId,
        versionDescription: input.versionDescription,
        skipDbSnapshot: input.skipDbSnapshot,
      });
      return {
        content: [{ type: "text" as const, text: `Deployed ${result.version}: ${input.versionDescription}` }],
        structuredContent: result,
      };
    });
  }

  export function registerDeploy(server: any, ctx: { taskId: string }) {
    server.registerTool(
      "anyclaw_deploy",
      {
        title: "Deploy to Production",
        description: "Validate, snapshot, commit, merge to main, promote, restart logic service. REQUIRES a version description a non-technical user can understand.",
        inputSchema: deployInput,
        outputSchema: deployOutput,
        annotations: { destructiveHint: true, idempotentHint: false },
      },
      (input: any) => makeDeployHandler()(input, ctx),
    );
  }
  ```
- [ ] **11.4 Run test, confirm GREEN.**
- [ ] **11.5 Commit:** `plan2/task11: anyclaw_deploy tool delegating to DeployManager`

---

## Task 12 — `anyclaw_rollback`

- [ ] **12.1 Write failing test:** `src/tools/__tests__/rollback.test.ts`:
  ```typescript
  import { describe, it, expect, vi } from "vitest";
  import { makeRollbackHandler } from "../rollback.js";

  describe("anyclaw_rollback", () => {
    it("delegates to RollbackManager.run", async () => {
      const mgr = { run: vi.fn().mockResolvedValue({ rolledBackTo: "v1.0.0", safetySnapshotId: "snap-2", gitCommit: "abc" }) };
      const h = makeRollbackHandler(() => mgr as any);
      const out = await h({ version: "v1.0.0" });
      expect(mgr.run).toHaveBeenCalledWith("v1.0.0");
      expect((out.structuredContent as any).rolledBackTo).toBe("v1.0.0");
    });
    it("surfaces unknown version as isError", async () => {
      const mgr = { run: vi.fn().mockRejectedValue(new Error("Unknown version")) };
      const h = makeRollbackHandler(() => mgr as any);
      const out = await h({ version: "v9.9.9" });
      expect(out.isError).toBe(true);
    });
  });
  ```
- [ ] **12.2 Run test, confirm RED.**
- [ ] **12.3 Create `src/tools/rollback.ts`:**
  ```typescript
  import { z } from "zod";
  import { withErrorHandling } from "./register.js";

  export type RollbackManagerLike = {
    run(version: string): Promise<{ rolledBackTo: string; safetySnapshotId: string; gitCommit: string }>;
  };

  export const rollbackInput = z.object({
    version: z.string().describe("Version identifier, e.g. 'v1.2.0'"),
  });
  export const rollbackOutput = z.object({
    rolledBackTo: z.string(),
    safetySnapshotId: z.string(),
    gitCommit: z.string(),
  });

  let defaultMgr: () => RollbackManagerLike = () => (require("@anyclaw/shared") as any).rollbackManager;

  export function makeRollbackHandler(factory: () => RollbackManagerLike = defaultMgr) {
    return withErrorHandling(async (input: z.infer<typeof rollbackInput>) => {
      const r = await factory().run(input.version);
      return {
        content: [{ type: "text" as const, text: `Rolled back to ${r.rolledBackTo} (safety snapshot ${r.safetySnapshotId})` }],
        structuredContent: r,
      };
    });
  }

  export function registerRollback(server: any) {
    server.registerTool(
      "anyclaw_rollback",
      {
        title: "Rollback to Version",
        description: "Revert production code and database to a specific version. Snapshots current state first.",
        inputSchema: rollbackInput,
        outputSchema: rollbackOutput,
        annotations: { destructiveHint: true },
      },
      (input: any) => makeRollbackHandler()(input),
    );
  }
  ```
- [ ] **12.4 Run test, confirm GREEN.**
- [ ] **12.5 Commit:** `plan2/task12: anyclaw_rollback tool delegating to RollbackManager`

---

## Task 13 — `mountMcp` HTTP/SSE Wiring

Note: `mountMcp(app, ctx)` attaches MCP routes at `/mcp/*` onto a passed-in Express app. It does NOT call `app.listen`. Plan 1's `@anyclaw/dispatch` entrypoint owns the Express app and the single `listen(4100)` call; it imports `mountMcp` from `@anyclaw/mcp-server` and calls it before starting the server. Plan 3's REST API routes mount onto the same app.

- [ ] **13.1 Write failing test:** `src/__tests__/mount-mcp.test.ts`:
  ```typescript
  import { describe, it, expect, beforeEach, afterEach } from "vitest";
  import express from "express";
  import request from "supertest";
  import fs from "node:fs";
  import os from "node:os";
  import path from "node:path";
  import { mountMcp } from "../index.js";
  import { registerTaskToken, __resetTokenRegistryForTests } from "../auth.js";

  let tmp: string;
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "anyclaw-mount-"));
    process.env.ANYCLAW_DATA_ROOT = tmp;
    fs.mkdirSync(path.join(tmp, ".anyclaw", "mcp-tokens"), { recursive: true });
    __resetTokenRegistryForTests();
  });
  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
    delete process.env.ANYCLAW_DATA_ROOT;
  });

  describe("mountMcp", () => {
    it("401 without bearer token", async () => {
      const app = express();
      mountMcp(app);
      const res = await request(app).post("/mcp").send({ jsonrpc: "2.0", method: "tools/list", id: 1 });
      expect(res.status).toBe(401);
    });
    it("tools/list returns the seven anyclaw tools", async () => {
      registerTaskToken("tA", "tok-A");
      const app = express();
      app.use(express.json());
      mountMcp(app);
      const res = await request(app)
        .post("/mcp")
        .set("Authorization", "Bearer tok-A")
        .set("Accept", "application/json, text/event-stream")
        .send({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "t", version: "1" } },
        });
      expect(res.status).toBe(200);
      // second call
      const list = await request(app)
        .post("/mcp")
        .set("Authorization", "Bearer tok-A")
        .set("Accept", "application/json, text/event-stream")
        .set("mcp-session-id", res.headers["mcp-session-id"] ?? "")
        .send({ jsonrpc: "2.0", id: 2, method: "tools/list" });
      const body = typeof list.text === "string" && list.text.startsWith("event:")
        ? JSON.parse(list.text.split("data: ")[1].split("\n")[0])
        : list.body;
      const names = (body.result?.tools ?? []).map((t: any) => t.name).sort();
      expect(names).toEqual([
        "anyclaw_ask_user",
        "anyclaw_create_collection",
        "anyclaw_deploy",
        "anyclaw_list_versions",
        "anyclaw_rollback",
        "anyclaw_snapshot_db",
        "anyclaw_update_progress",
      ]);
    });
  });
  ```
  Note: the exact SSE/JSON response shape depends on the MCP SDK version. If the SDK returns session responses differently, adjust parsing. The critical assertions are: status 200 and the 7 tool names.
- [ ] **13.2 Run test, confirm RED.**
- [ ] **13.3 Create `src/tools/index.ts`:**
  ```typescript
  import { registerDeploy }            from "./deploy.js";
  import { registerRollback }          from "./rollback.js";
  import { registerSnapshotDb }        from "./snapshot-db.js";
  import { registerCreateCollection }  from "./create-collection.js";
  import { registerListVersions }      from "./list-versions.js";
  import { registerAskUser }           from "./ask-user.js";
  import { registerUpdateProgress }    from "./update-progress.js";

  export function registerAllTools(server: any, ctx: { taskId: string }) {
    registerDeploy(server, ctx);
    registerRollback(server);
    registerSnapshotDb(server);
    registerCreateCollection(server);
    registerListVersions(server);
    registerAskUser(server, ctx);
    registerUpdateProgress(server, ctx);
  }
  ```
- [ ] **13.4 Replace `src/index.ts`:**
  ```typescript
  import { randomUUID } from "node:crypto";
  import type { Express, Request, Response } from "express";
  import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
  import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
  import { requireBearerToken, resolveTaskFromToken } from "./auth.js";
  import { registerAllTools } from "./tools/index.js";

  const INSTRUCTIONS = [
    "AnyClaw MCP server. Use your own native file and shell tools for everything in the dev worktree.",
    "Use AnyClaw MCP tools only for production operations: anyclaw_deploy, anyclaw_rollback, anyclaw_snapshot_db, anyclaw_create_collection.",
    "Use anyclaw_ask_user to clarify requirements and anyclaw_update_progress to keep the user informed.",
    "A version description of at least 10 characters is required for every deployment.",
  ].join(" ");

  export type McpContext = Record<string, never>;

  export function mountMcp(app: Express, _ctx: McpContext = {}): void {
    app.post("/mcp", requireBearerToken, async (req: Request, res: Response) => {
      try {
        const taskId = resolveTaskFromToken(req);
        const server = new McpServer(
          { name: "anyclaw", version: "1.0.0" },
          { instructions: INSTRUCTIONS },
        );
        registerAllTools(server, { taskId });
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
        });
        await server.connect(transport);
        await transport.handleRequest(req, res);
      } catch (err) {
        if (!res.headersSent) {
          res.status(500).json({ error: "mcp_mount_failure", message: (err as Error).message });
        }
      }
    });
  }

  export { registerTaskToken, revokeTaskToken } from "./auth.js";
  ```
- [ ] **13.5 Run test, confirm GREEN.** If the MCP SDK transport shape trips the test parser, adjust the parser in step 13.1 only — do not weaken the assertion on the seven tool names.
- [ ] **13.6 Commit:** `plan2/task13: mountMcp wires Streamable HTTP transport + all 7 tools`

---

## Task 14 — Task State + Resume Helper

- [ ] **14.1 Write failing test:** `src/__tests__/task-state.test.ts`:
  ```typescript
  import { describe, it, expect, vi } from "vitest";
  import { resumeTasksOnStartup, type TasksRepo } from "../task-state.js";

  function repo(initial: any[]): TasksRepo & { rows: any[]; updates: any[] } {
    const rows = [...initial];
    const updates: any[] = [];
    return {
      rows,
      updates,
      async listActive() {
        return rows.filter(r => ["queued","clarifying","working","deploying"].includes(r.state));
      },
      async update(id, patch) {
        updates.push({ id, patch });
        const r = rows.find(x => x.id === id);
        if (r) Object.assign(r, patch);
      },
      async hasPendingQuestion(_taskId) { return false; },
      async notifyFailure(_taskId, _err) { /* noop */ },
    };
  }

  describe("resumeTasksOnStartup", () => {
    it("marks working tasks as failed with server_restart", async () => {
      const r = repo([
        { id: "a", taskId: "a", state: "working" },
        { id: "b", taskId: "b", state: "deploying" },
        { id: "c", taskId: "c", state: "done" },
      ]);
      await resumeTasksOnStartup(r);
      expect(r.updates).toEqual([
        { id: "a", patch: { state: "failed", error: "server_restart" } },
        { id: "b", patch: { state: "failed", error: "server_restart" } },
      ]);
    });
    it("leaves clarifying tasks alone when question still pending (caller will wait)", async () => {
      const base = repo([{ id: "q", taskId: "q", state: "clarifying" }]);
      base.hasPendingQuestion = async () => true;
      await resumeTasksOnStartup(base);
      expect(base.updates).toEqual([]);
    });
  });
  ```
- [ ] **14.2 Run test, confirm RED.**
- [ ] **14.3 Create `src/task-state.ts`:**
  ```typescript
  export type TaskRow = {
    id: string;
    taskId: string;
    state: "queued" | "clarifying" | "working" | "deploying" | "done" | "failed" | "cancelled";
  };

  export type TasksRepo = {
    listActive(): Promise<TaskRow[]>;
    update(id: string, patch: Partial<TaskRow> & { error?: string }): Promise<void>;
    hasPendingQuestion(taskId: string): Promise<boolean>;
    notifyFailure(taskId: string, error: string): Promise<void>;
  };

  /**
   * Decision #40 exactly-once with crash recovery:
   * - working/deploying → failed(server_restart)
   * - queued/clarifying → left for dispatcher to re-spawn (we cannot tell if a question is
   *   still pending without checking _agent_messages).
   */
  export async function resumeTasksOnStartup(repo: TasksRepo): Promise<void> {
    const active = await repo.listActive();
    for (const row of active) {
      if (row.state === "working" || row.state === "deploying") {
        await repo.update(row.id, { state: "failed", error: "server_restart" });
        await repo.notifyFailure(row.taskId, "server_restart");
      }
      // queued / clarifying: leave for dispatcher. If a question is pending we simply
      // do nothing; the dispatcher will re-subscribe via anyclaw_ask_user resume.
    }
  }

  /** Concrete PocketBase-backed repo used by the dispatch process. */
  export function pocketBaseTasksRepo(pb: import("pocketbase").default): TasksRepo {
    return {
      async listActive() {
        const rows = await pb.collection("_tasks").getFullList({
          filter: `state = "queued" || state = "clarifying" || state = "working" || state = "deploying"`,
        });
        return rows.map((r: any) => ({ id: r.id, taskId: r.taskId, state: r.state }));
      },
      async update(id, patch) { await pb.collection("_tasks").update(id, patch); },
      async hasPendingQuestion(taskId) {
        const q = await pb.collection("_agent_messages").getList(1, 1, {
          filter: `taskId = "${taskId}" && type = "question"`,
          sort: "-created",
        });
        if (q.items.length === 0) return false;
        const qid = q.items[0].id;
        const a = await pb.collection("_agent_messages").getList(1, 1, {
          filter: `questionId = "${qid}" && type = "answer"`,
        });
        return a.items.length === 0;
      },
      async notifyFailure(taskId, error) {
        await pb.collection("_agent_messages").create({
          taskId, direction: "agent_to_user", type: "progress",
          content: `Task failed during resume: ${error}`,
          phase: "working",
        });
      },
    };
  }
  ```
- [ ] **14.4 Run test, confirm GREEN.**
- [ ] **14.5 Commit:** `plan2/task14: task state resume helper (decision #40)`

---

## Task 15 — Integration Test: Deploy Happy Path

This task tests `mountMcp` end-to-end against a stubbed `DeployManager` (we do not bring up a real PocketBase — that's covered by Plan 1 integration tests). It exercises the full HTTP/SSE path with the MCP SDK client.

- [ ] **15.1 Write failing integration test:** `tests/integration/deploy-happy-path.test.ts`:
  ```typescript
  import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
  import express from "express";
  import http from "node:http";
  import fs from "node:fs";
  import os from "node:os";
  import path from "node:path";
  import { Client } from "@modelcontextprotocol/sdk/client/index.js";
  import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

  // Stub @anyclaw/shared before importing the server module.
  vi.mock("@anyclaw/shared", () => ({
    deployManager: {
      run: vi.fn().mockResolvedValue({
        version: "v1.0.1",
        gitCommit: "abc1234",
        gitTag: "v1.0.1",
        dbSnapshotId: "snap-xyz",
        validationResults: { lint: true, typecheck: true, build: true, smokeTests: true },
      }),
    },
    rollbackManager: { run: vi.fn() },
    snapshotManager: { create: vi.fn() },
  }));

  let server: http.Server;
  let baseUrl: string;
  let tmp: string;

  beforeAll(async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "anyclaw-int-"));
    process.env.ANYCLAW_DATA_ROOT = tmp;
    fs.mkdirSync(path.join(tmp, ".anyclaw", "mcp-tokens"), { recursive: true });

    const { mountMcp, registerTaskToken } = await import("../../src/index.js");
    const { __resetTokenRegistryForTests } = await import("../../src/auth.js");
    __resetTokenRegistryForTests();
    registerTaskToken("int-task", "int-tok");

    const app = express();
    app.use(express.json());
    mountMcp(app);
    await new Promise<void>((r) => {
      server = app.listen(0, "127.0.0.1", () => r());
    });
    const addr = server.address() as any;
    baseUrl = `http://127.0.0.1:${addr.port}/mcp`;
  });

  afterAll(async () => {
    await new Promise<void>((r) => server.close(() => r()));
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  describe("integration: deploy happy path", () => {
    it("calls anyclaw_deploy through the MCP client and returns structured content", async () => {
      const client = new Client({ name: "test", version: "1.0.0" }, { capabilities: {} });
      const transport = new StreamableHTTPClientTransport(new URL(baseUrl), {
        requestInit: { headers: { Authorization: "Bearer int-tok" } },
      });
      await client.connect(transport);
      const tools = await client.listTools();
      expect(tools.tools.map(t => t.name).sort()).toContain("anyclaw_deploy");

      const res = await client.callTool({
        name: "anyclaw_deploy",
        arguments: { versionDescription: "adds mood tracking feature", skipDbSnapshot: true },
      });
      expect(res.isError).toBeFalsy();
      expect((res.structuredContent as any).version).toBe("v1.0.1");
      expect((res.structuredContent as any).validationResults.lint).toBe(true);

      const { deployManager } = await import("@anyclaw/shared");
      expect((deployManager as any).run).toHaveBeenCalledWith({
        taskId: "int-task",
        versionDescription: "adds mood tracking feature",
        skipDbSnapshot: true,
      });
      await client.close();
    });
  });
  ```
- [ ] **15.2 Run test, confirm RED** (it should fail only because nothing is broken yet — if this somehow passes on first run, it isn't a real red; ensure by first commenting out one of the registerXxx calls in `tools/index.ts`, run → red, uncomment).
- [ ] **15.3 With all prior tasks already passing, simply **run** the test.** Confirm GREEN.
- [ ] **15.4 Add a CI guard test** at `src/__tests__/tool-count.test.ts`:
  ```typescript
  import { describe, it, expect } from "vitest";
  import { registerAllTools } from "../tools/index.js";

  describe("tool count guard", () => {
    it("registers exactly 7 tools", () => {
      const names: string[] = [];
      const fakeServer = {
        registerTool: (name: string) => { names.push(name); },
      };
      registerAllTools(fakeServer as any, { taskId: "x" });
      expect(names.sort()).toEqual([
        "anyclaw_ask_user",
        "anyclaw_create_collection",
        "anyclaw_deploy",
        "anyclaw_list_versions",
        "anyclaw_rollback",
        "anyclaw_snapshot_db",
        "anyclaw_update_progress",
      ]);
    });
  });
  ```
- [ ] **15.5 Run full suite:** `npm run -w @anyclaw/mcp-server test`. All green.
- [ ] **15.6 Commit:** `plan2/task15: end-to-end deploy happy path integration test + tool-count guard`

---

## Completion Checklist

- [ ] All 15 tasks committed, each with red → green → commit.
- [ ] `npm run -w @anyclaw/mcp-server test` passes with all unit + integration tests green.
- [ ] `npm run -w @anyclaw/mcp-server build` succeeds (typecheck clean).
- [ ] The package exports `mountMcp`, `registerTaskToken`, `revokeTaskToken`, `ensureInternalCollections`, `resumeTasksOnStartup`, and `pocketBaseTasksRepo` for consumption by Plan 3's dispatch server.
- [ ] All 7 tools are registered and gated by the per-task bearer middleware.
- [ ] The six collections (`_tasks`, `_agent_messages`, `_versions`, `_user_preferences`, `_api_keys`, `_deployments`) can be bootstrapped by calling `ensureInternalCollections(pb)` during install.

## Hand-off Notes for Plan 3

Plan 1's `@anyclaw/dispatch` package owns the Express app and the single `app.listen(4100, '127.0.0.1')` call. Plan 3 (Agent Dispatch) will:
1. In the dispatch entrypoint, `import { mountMcp } from '@anyclaw/mcp-server'` and call `mountMcp(app, ctx)` on the shared dispatch Express app BEFORE `app.listen`. Plan 3's REST API routes mount onto the same app. The health endpoint from Plan 1 also lives on the same app.
2. On task spawn, call `registerTaskToken(taskId, crypto.randomUUID())` and inject the token into the agent subprocess via `ANYCLAW_MCP_TOKEN`.
3. On task terminate, call `revokeTaskToken(taskId)`.
4. On startup, instantiate `pocketBaseTasksRepo(pb)` and call `resumeTasksOnStartup(repo)` before accepting new work.
5. On install/first-run, call `ensureInternalCollections(getPocketBaseAdmin())`.
