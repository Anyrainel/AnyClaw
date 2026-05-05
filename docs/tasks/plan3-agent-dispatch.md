# Plan 3: Agent Dispatch Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development for every task below. Each task is a self-contained TDD cycle with explicit checkbox steps: write the failing test, run it and confirm it fails for the right reason, implement the minimum code to pass, run it and confirm it passes, then commit. Do not batch tasks. Do not skip the "confirm fail" step. If a test passes before implementation, the test is wrong — fix it first.

**Goal:** Extend the `@anyclaw/dispatch` package (scaffolded by Plan 1) with the pluggable agent-dispatch layer that translates mobile-app task requests into running coding-agent sessions (OpenClaw, Claude Code, or webhook), manages the task lifecycle in isolated git worktrees with exactly-once semantics, and exposes the REST API the mobile app drives. Mount the Plan 2 MCP router onto the same Express app so MCP and REST share port 4100 in a single process.

**Architecture:** Plan 1 already created `packages/dispatch/` as an Express app on port 4100 with a `/health` endpoint. Plan 2 exports `mountMcp(app, ctx)` from `@anyclaw/mcp-server`. This plan adds, inside the existing `@anyclaw/dispatch` package, the REST routers, the adapter system, the `AdapterManager`, and the process entry point that (a) calls `mountMcp` on the shared Express app, (b) mounts all REST routers, (c) runs the startup sweep, and (d) listens on `127.0.0.1:4100`. `WorktreeManager` is imported from `@anyclaw/shared` — Plan 3 does NOT re-implement it.

**Tech Stack:** Express (from Plan 1), `ws`, `simple-git` (from `@anyclaw/shared`), `child_process`, `zod`, `vitest`.
**Workspace tool:** npm workspaces. Every test command is `npm run -w @anyclaw/dispatch test`.
**Dependencies:** Plan 1 (shared lib + dispatch scaffold), Plan 2 (`mountMcp`, internal collections, `registerTaskToken`/`revokeTaskToken`).
**Plans that depend on this:** Plan 5 (Mobile App), Plan 6 (Install/Skills Deployment — uses `POST /internal/api-keys`).

---

## Product Principles (applied throughout)

1. **Exactly-once, never lost.** Client-generated UUIDs + idempotent upsert + startup sweep. A retried submission is always safe; a dropped submission is always visible to the user as `failed`.
2. **Isolation by default.** Every task runs in its own git worktree. Failure never touches `main`. Future parallelization is a scheduler change, not a rewrite.
3. **Agent-agnostic surface.** The `AgentAdapter` interface is small enough that a new agent (Codex, Aider, Gemini CLI) is a single new file.
4. **Control plane is unkillable.** The dispatch server lives under `/data/.anyclaw/` outside the agent's writable path. Agents cannot edit the process that supervises them.
5. **No silent waits.** Every blocking operation (clarification, dispatch, subprocess wait) has an `AbortSignal` and a persisted state so the mobile app always sees ground truth.
6. **One process, one port.** MCP (Plan 2) and REST (Plan 3) share a single Express app bound to `127.0.0.1:4100`.

---

## Package Layout (extending Plan 1's `packages/dispatch/`)

Plan 1 already created `packages/dispatch/package.json`, `tsconfig.json`, `src/index.ts` (with `createApp()` and `/health`), and `test/health.test.ts`. This plan ADDS files under `src/` and `test/` inside that existing package — it does NOT create a new package.

```
anyclaw-server/packages/dispatch/
├── src/
│   ├── index.ts                     # EXTENDED: mount MCP + REST, run sweep, listen
│   ├── app.ts                       # EXTENDED by Plan 3 with REST routers
│   ├── rest/
│   │   ├── router.ts                # NEW
│   │   ├── auth.ts                  # NEW
│   │   ├── tasks.ts                 # NEW
│   │   ├── settings.ts              # NEW
│   │   ├── devices.ts               # NEW
│   │   ├── health.ts                # NEW
│   │   ├── adapter.ts               # NEW
│   │   ├── emergency.ts             # NEW
│   │   ├── webhook-callback.ts      # NEW
│   │   └── internal-api-keys.ts     # NEW
│   ├── adapters/
│   │   ├── types.ts                 # NEW
│   │   ├── manager.ts               # NEW
│   │   ├── openclaw.ts              # NEW
│   │   ├── claude-code.ts           # NEW
│   │   └── webhook.ts               # NEW
│   ├── resource-limits/
│   │   ├── types.ts                 # NEW
│   │   └── noop.ts                  # NEW
│   ├── lifecycle/
│   │   ├── state-machine.ts         # NEW
│   │   └── clarification.ts         # NEW
│   ├── persistence/
│   │   ├── pocketbase-client.ts     # NEW
│   │   ├── collections-bootstrap.ts # NEW (_devices, _task_clarifications, _deployments)
│   │   └── tasks-repo.ts            # NEW
│   └── util/
│       ├── async-queue.ts           # NEW
│       └── terminal-states.ts       # NEW
├── test/
│   ├── unit/                        # NEW
│   └── integration/                 # NEW
├── package.json                     # EXTENDED (add deps: ws, zod, @anyclaw/mcp-server, simple-git)
└── vitest.config.ts                 # (already exists from Plan 1)
```

All imports of `WorktreeManager`, `DeployManager`, `RollbackManager`, `VersionStore`, `SnapshotManager`, `AnyClawPaths` come from `@anyclaw/shared`. All imports of `mountMcp`, `registerTaskToken`, `revokeTaskToken`, `ensureInternalCollections` come from `@anyclaw/mcp-server`.

---

## Task 0: Extend the `@anyclaw/dispatch` scaffold with Plan 3 dependencies

**Context:** Plan 1 created `packages/dispatch/` with `express`, `@anyclaw/shared`, `vitest`, `typescript`, and the `/health` route. This task adds the additional deps Plan 3 needs and wires the smoke test that asserts the new deps resolve.

**Files to create/modify:**
- Modify: `anyclaw-server/packages/dispatch/package.json`
- Create: `anyclaw-server/packages/dispatch/test/unit/smoke.test.ts`

- [ ] **Step 1: Write the failing test** — create `test/unit/smoke.test.ts`:
  ```ts
  import { describe, it, expect } from "vitest";
  describe("dispatch package Plan 3 deps", () => {
    it("resolves ws, zod, simple-git, @anyclaw/mcp-server, @anyclaw/shared", async () => {
      await expect(import("ws")).resolves.toBeDefined();
      await expect(import("zod")).resolves.toBeDefined();
      await expect(import("simple-git")).resolves.toBeDefined();
      await expect(import("@anyclaw/shared")).resolves.toBeDefined();
      await expect(import("@anyclaw/mcp-server")).resolves.toBeDefined();
    });
  });
  ```
- [ ] **Step 2: Run the test and confirm it fails** — `npm run -w @anyclaw/dispatch test -- smoke` must fail because `ws`/`zod`/`simple-git`/`@anyclaw/mcp-server` are not yet in `dependencies`.
- [ ] **Step 3: Extend `package.json`** — add to `dependencies`: `"ws": "^8.18.0"`, `"zod": "^3.23.8"`, `"simple-git": "^3.25.0"`, `"@anyclaw/mcp-server": "*"`. Add to `devDependencies`: `"@types/ws": "^8.5.12"`, `"supertest": "^7.0.0"`, `"@types/supertest": "^6.0.2"`. Run `npm install` from the monorepo root to refresh the lockfile.
- [ ] **Step 4: Run the test and confirm it passes** — `npm run -w @anyclaw/dispatch test -- smoke`.
- [ ] **Step 5: Commit** — `plan3(task0): extend @anyclaw/dispatch deps for agent dispatch layer`.

---

## Task 1: Core types (`adapters/types.ts`)

**Files to create:**
- Create: `packages/dispatch/src/adapters/types.ts`
- Create: `packages/dispatch/test/unit/types.test.ts`

- [ ] **Step 1: Write the failing test**
  ```ts
  import { describe, it, expect } from "vitest";
  import { AdapterError, isTerminal } from "../../src/adapters/types.js";
  describe("TaskState terminal detection", () => {
    it("treats done/failed/cancelled as terminal", () => {
      expect(isTerminal("done")).toBe(true);
      expect(isTerminal("failed")).toBe(true);
      expect(isTerminal("cancelled")).toBe(true);
    });
    it("treats queued/working/clarifying/deploying as non-terminal", () => {
      for (const s of ["queued","working","clarifying","deploying"] as const) {
        expect(isTerminal(s)).toBe(false);
      }
    });
    it("AdapterError preserves code and retryable flag", () => {
      const e = new AdapterError("nope", "AGENT_UNREACHABLE", true);
      expect(e.code).toBe("AGENT_UNREACHABLE");
      expect(e.retryable).toBe(true);
    });
  });
  ```
- [ ] **Step 2: Run and confirm fail.**
- [ ] **Step 3: Implement** `src/adapters/types.ts`:
  ```ts
  export type TaskState = "queued" | "working" | "clarifying" | "deploying" | "done" | "failed" | "cancelled";
  const TERMINAL: ReadonlySet<TaskState> = new Set(["done","failed","cancelled"]);
  export const isTerminal = (s: TaskState): boolean => TERMINAL.has(s);

  export interface TaskStatus {
    state: TaskState;
    seq: number;
    updatedAt: string;
    progressSummary?: string;
    question?: string;
    clarificationId?: string;
    versionDescription?: string;
    error?: string;
  }

  export interface TaskHandle {
    taskId: string;
    adapterRef: string;
  }

  export interface ActivityEntry {
    taskId: string;
    ts: string;
    kind: "dispatch" | "state" | "tool" | "message" | "error";
    payload: unknown;
  }

  export type AdapterErrorCode =
    | "AGENT_UNREACHABLE"
    | "AUTH_FAILED"
    | "BAD_REQUEST"
    | "INTERNAL"
    | "TIMEOUT"
    | "CANCELLED";

  export class AdapterError extends Error {
    constructor(message: string, readonly code: AdapterErrorCode, readonly retryable: boolean) {
      super(message);
      this.name = "AdapterError";
    }
  }

  export interface SystemContext {
    cwd: string;
    mcpEndpointUrl: string;
    mcpBearerToken: string;
    mcpConfigPath: string;
    systemPrompt: string;
    allowedTools: string[];
  }

  export interface DispatchConfig {
    adapter: "openclaw" | "claude-code" | "webhook";
    maxTaskDurationMs: number;
    clarificationTimeoutMs: number;
    clarificationTimeoutMode: "best_judgment" | "pause_indefinitely";
    maxBudgetUsd: number;
  }

  export interface AgentAdapter {
    readonly name: string;
    healthCheck(): Promise<{ ok: boolean; detail?: string }>;
    dispatch(taskId: string, request: string, ctx: SystemContext, signal: AbortSignal): Promise<TaskHandle>;
    subscribe(taskId: string, signal: AbortSignal): AsyncIterable<TaskStatus>;
    answerQuestion(taskId: string, clarificationId: string, answer: string): Promise<void>;
    cancel(taskId: string): Promise<void>;
    resumeTask?(taskId: string): Promise<void>;
    dispose(): Promise<void>;
  }
  ```
- [ ] **Step 4: Run and confirm pass.**
- [ ] **Step 5: Commit** — `plan3(task1): agent-adapter core types`.

---

## Task 2: `AsyncQueue` utility

**Files to create:**
- Create: `packages/dispatch/src/util/async-queue.ts`
- Create: `packages/dispatch/test/unit/async-queue.test.ts`

- [ ] **Step 1: Write the failing test**
  ```ts
  import { describe, it, expect } from "vitest";
  import { AsyncQueue } from "../../src/util/async-queue.js";
  describe("AsyncQueue", () => {
    it("yields pushed values in order then closes", async () => {
      const q = new AsyncQueue<number>();
      q.push(1); q.push(2); q.close();
      const out: number[] = [];
      for await (const v of q) out.push(v);
      expect(out).toEqual([1, 2]);
    });
    it("awaits values pushed after iteration starts", async () => {
      const q = new AsyncQueue<string>();
      const p = (async () => { const out: string[] = []; for await (const v of q) out.push(v); return out; })();
      setTimeout(() => { q.push("a"); q.push("b"); q.close(); }, 10);
      expect(await p).toEqual(["a", "b"]);
    });
  });
  ```
- [ ] **Step 2: Run and confirm fail.**
- [ ] **Step 3: Implement** a minimal promise-based queue exposing `push`, `close`, `[Symbol.asyncIterator]`, and a public mutable `lastSeq: number` field used by the Claude Code adapter.
- [ ] **Step 4: Run and confirm pass.**
- [ ] **Step 5: Commit** — `plan3(task2): async queue utility`.

---

## Task 3: `ResourceLimits` no-op placeholder

**Files to create:**
- Create: `packages/dispatch/src/resource-limits/types.ts`
- Create: `packages/dispatch/src/resource-limits/noop.ts`
- Create: `packages/dispatch/test/unit/resource-limits.test.ts`

- [ ] **Step 1: Write the failing test**
  ```ts
  import { describe, it, expect } from "vitest";
  import { NoopResourceLimits } from "../../src/resource-limits/noop.js";
  describe("NoopResourceLimits", () => {
    it("prepare returns null, apply/release are no-ops", async () => {
      const r = new NoopResourceLimits();
      expect(await r.prepare("t1", { cpuQuotaPercent: 200, memoryMaxMb: 2048 })).toBeNull();
      await expect(r.apply(1234, "handle")).resolves.toBeUndefined();
      await expect(r.release("handle")).resolves.toBeUndefined();
    });
  });
  ```
- [ ] **Step 2: Run and confirm fail.**
- [ ] **Step 3: Implement** `types.ts` exporting `ResourceLimits` interface with `prepare/apply/release` and `ResourceLimitConfig`. Implement `noop.ts` exporting `NoopResourceLimits` whose methods return the shapes the test asserts.
- [ ] **Step 4: Run and confirm pass.**
- [ ] **Step 5: Commit** — `plan3(task3): ResourceLimits no-op interface`.

---

## Task 4: Import `WorktreeManager` from `@anyclaw/shared`

> **Note:** Plan 1 already implements `WorktreeManager` in `@anyclaw/shared` with `create(taskId)`, `mergeAndRemove(taskId)`, and `discard(taskId)` methods over a temp git repo. Plan 3 does NOT re-implement it. This task writes a small re-export shim so the rest of Plan 3 can import it from a single local path AND add a thin integration test confirming the shared implementation is wired in.

**Files to create:**
- Create: `packages/dispatch/src/worktrees.ts`
- Create: `packages/dispatch/test/unit/worktrees-reexport.test.ts`

- [ ] **Step 1: Write the failing test**
  ```ts
  import { describe, it, expect } from "vitest";
  import { WorktreeManager as Local } from "../../src/worktrees.js";
  import { WorktreeManager as Shared } from "@anyclaw/shared";
  describe("worktrees re-export", () => {
    it("exposes the shared WorktreeManager (same class reference)", () => {
      expect(Local).toBe(Shared);
    });
  });
  ```
- [ ] **Step 2: Run and confirm fail.**
- [ ] **Step 3: Implement** `src/worktrees.ts`:
  ```ts
  export { WorktreeManager } from "@anyclaw/shared";
  export type { Worktree } from "@anyclaw/shared";
  ```
  Throughout the rest of Plan 3, import `WorktreeManager` from `"./worktrees.js"` (or directly from `"@anyclaw/shared"` — both are fine; pick one and be consistent).
- [ ] **Step 4: Run and confirm pass.**
- [ ] **Step 5: Commit** — `plan3(task4): re-export WorktreeManager from @anyclaw/shared`.

---

## Task 5: Task lifecycle state machine

**Files to create:**
- Create: `packages/dispatch/src/lifecycle/state-machine.ts`
- Create: `packages/dispatch/test/unit/state-machine.test.ts`

- [ ] **Step 1: Write the failing test**
  ```ts
  import { describe, it, expect } from "vitest";
  import { transition, TransitionError } from "../../src/lifecycle/state-machine.js";
  describe("transition", () => {
    it("queued -> working on scheduler_pick", () => {
      expect(transition("queued", "scheduler_pick")).toBe("working");
    });
    it("working -> clarifying on ask_user", () => {
      expect(transition("working", "ask_user")).toBe("clarifying");
    });
    it("clarifying -> working on answer", () => {
      expect(transition("clarifying", "answer")).toBe("working");
    });
    it("working -> deploying on deploy_called", () => {
      expect(transition("working", "deploy_called")).toBe("deploying");
    });
    it("deploying -> done on validation_pass", () => {
      expect(transition("deploying", "validation_pass")).toBe("done");
    });
    it("any non-terminal -> cancelled on cancel", () => {
      for (const s of ["queued","working","clarifying","deploying"] as const) {
        expect(transition(s, "cancel")).toBe("cancelled");
      }
    });
    it("rejects terminal -> anything", () => {
      expect(() => transition("done", "cancel")).toThrow(TransitionError);
      expect(() => transition("failed", "answer")).toThrow(TransitionError);
    });
    it("rejects nonsense transitions", () => {
      expect(() => transition("queued", "answer")).toThrow(TransitionError);
    });
  });
  ```
- [ ] **Step 2: Run and confirm fail.**
- [ ] **Step 3: Implement** `state-machine.ts` as a pure function over a transition table:
  ```ts
  import type { TaskState } from "../adapters/types.js";
  export type TaskEvent =
    | "scheduler_pick" | "ask_user" | "answer" | "deploy_called"
    | "validation_pass" | "validation_fail" | "cancel" | "progress";
  export class TransitionError extends Error {}
  const TABLE: Record<TaskState, Partial<Record<TaskEvent, TaskState>>> = {
    queued:      { scheduler_pick: "working", cancel: "cancelled" },
    working:     { ask_user: "clarifying", deploy_called: "deploying", progress: "working", cancel: "cancelled", validation_fail: "failed" },
    clarifying:  { answer: "working", cancel: "cancelled" },
    deploying:   { validation_pass: "done", validation_fail: "failed", cancel: "cancelled" },
    done:        {},
    failed:      {},
    cancelled:   {},
  };
  export function transition(state: TaskState, event: TaskEvent): TaskState {
    const next = TABLE[state][event];
    if (!next) throw new TransitionError(`illegal ${state} -> ${event}`);
    return next;
  }
  ```
- [ ] **Step 4: Run and confirm pass.**
- [ ] **Step 5: Commit** — `plan3(task5): task lifecycle state machine`.

---

## Task 6: Bootstrap `_task_clarifications`, `_devices`, `_deployments` collections

> **Context:** Plan 2 creates `_tasks`, `_agent_messages`, `_versions`, `_user_preferences`, `_api_keys`. Plan 3 needs three more internal collections that Plan 2 does not create: `_task_clarifications` (clarification Q&A rows), `_devices` (Expo push notification tokens for Plan 5), and `_deployments` (mobile-app subscription target per spec).

**Files to create:**
- Create: `packages/dispatch/src/persistence/collections-bootstrap.ts`
- Create: `packages/dispatch/test/unit/collections-bootstrap.test.ts`

- [ ] **Step 1: Write the failing test** using an in-memory fake PocketBase (a handwritten `FakePb` whose `collections` has `create` and `getFullList`):
  ```ts
  import { describe, it, expect, beforeEach } from "vitest";
  import { ensureDispatchCollections } from "../../src/persistence/collections-bootstrap.js";
  import { makeFakePb } from "./helpers/fake-pb.js";
  describe("ensureDispatchCollections", () => {
    it("creates _task_clarifications, _devices, _deployments when absent", async () => {
      const pb = makeFakePb();
      await ensureDispatchCollections(pb as any);
      const names = (await pb.collections.getFullList()).map((c: any) => c.name).sort();
      expect(names).toEqual(["_deployments", "_devices", "_task_clarifications"]);
    });
    it("is idempotent", async () => {
      const pb = makeFakePb();
      await ensureDispatchCollections(pb as any);
      await ensureDispatchCollections(pb as any);
      expect((await pb.collections.getFullList()).length).toBe(3);
    });
    it("_devices schema includes user_token, expo_push_token, platform, created_at", async () => {
      const pb = makeFakePb();
      await ensureDispatchCollections(pb as any);
      const d = (await pb.collections.getFullList()).find((c: any) => c.name === "_devices");
      const fields = d.schema.map((f: any) => f.name).sort();
      expect(fields).toEqual(["created_at","expo_push_token","platform","user_token"]);
    });
  });
  ```
- [ ] **Step 2: Run and confirm fail.**
- [ ] **Step 3: Implement** `collections-bootstrap.ts`:
  ```ts
  import type PocketBase from "pocketbase";

  const COLLECTIONS = [
    {
      name: "_task_clarifications",
      type: "base",
      schema: [
        { name: "taskId", type: "text", required: true },
        { name: "question", type: "text", required: true },
        { name: "answer", type: "text" },
        { name: "status", type: "select", options: { values: ["pending","answered","timed_out"] }, required: true },
        { name: "created_at", type: "date", required: true },
      ],
      indexes: ["CREATE INDEX idx_clarif_task ON _task_clarifications (taskId)"],
    },
    {
      name: "_devices",
      type: "base",
      schema: [
        { name: "user_token", type: "text", required: true },
        { name: "expo_push_token", type: "text", required: true },
        { name: "platform", type: "select", options: { values: ["ios","android"] }, required: true },
        { name: "created_at", type: "date", required: true },
      ],
      indexes: ["CREATE UNIQUE INDEX idx_devices_token ON _devices (expo_push_token)"],
    },
    {
      name: "_deployments",
      type: "base",
      schema: [
        { name: "taskId", type: "text", required: true },
        { name: "versionId", type: "text", required: true },
        { name: "state", type: "select", options: { values: ["deploying","deployed","failed","rolled_back"] }, required: true },
        { name: "description", type: "text" },
        { name: "error", type: "text" },
        { name: "created_at", type: "date", required: true },
      ],
      indexes: ["CREATE INDEX idx_deploy_task ON _deployments (taskId)"],
    },
  ] as const;

  export async function ensureDispatchCollections(pb: PocketBase): Promise<void> {
    const existing = new Set((await pb.collections.getFullList()).map(c => c.name));
    for (const spec of COLLECTIONS) {
      if (existing.has(spec.name)) continue;
      await pb.collections.create(spec as any);
    }
  }
  ```
- [ ] **Step 4: Run and confirm pass.**
- [ ] **Step 5: Commit** — `plan3(task6): bootstrap _task_clarifications / _devices / _deployments collections`.

---

## Task 7: `TasksRepo` against in-memory PocketBase client

**Files to create:**
- Create: `packages/dispatch/src/persistence/pocketbase-client.ts`
- Create: `packages/dispatch/src/persistence/tasks-repo.ts`
- Create: `packages/dispatch/test/unit/tasks-repo.test.ts`
- Create: `packages/dispatch/test/unit/helpers/fake-pb.ts`

- [ ] **Step 1: Write the failing test** (mock `_tasks` via fake PB — no network):
  ```ts
  import { describe, it, expect, beforeEach } from "vitest";
  import { TasksRepo } from "../../src/persistence/tasks-repo.js";
  import { makeFakePb, seedTask } from "./helpers/fake-pb.js";

  describe("TasksRepo", () => {
    let pb: ReturnType<typeof makeFakePb>, repo: TasksRepo;
    beforeEach(() => { pb = makeFakePb(); repo = new TasksRepo(pb as any); });

    it("createIfAbsent returns existing row without duplicating", async () => {
      const a = await repo.createIfAbsent({ taskId: "u1", request: "r", adapterType: "claude-code", systemContext: "{}", worktreePath: "/w" });
      const b = await repo.createIfAbsent({ taskId: "u1", request: "r", adapterType: "claude-code", systemContext: "{}", worktreePath: "/w" });
      expect(a.id).toBe(b.id);
      expect((await pb.collection("_tasks").getFullList()).length).toBe(1);
    });

    it("applyTransition validates against state machine and bumps seq", async () => {
      await repo.createIfAbsent({ taskId: "u2", request: "r", adapterType: "claude-code", systemContext: "{}", worktreePath: "/w" });
      await repo.applyTransition("u2", "scheduler_pick", {});
      const row = await repo.getByTaskId("u2");
      expect(row.state).toBe("working");
      expect(row.seq).toBe(1);
    });

    it("sweepOnStartup moves working/deploying to failed", async () => {
      await seedTask(pb, "a", "working");
      await seedTask(pb, "b", "deploying");
      await seedTask(pb, "c", "clarifying");
      const swept = await repo.sweepOnStartup();
      expect(swept.map(s => s.taskId).sort()).toEqual(["a","b"]);
      expect((await repo.getByTaskId("c")).state).toBe("clarifying");
    });
  });
  ```
- [ ] **Step 2: Run and confirm fail.**
- [ ] **Step 3: Implement** `pocketbase-client.ts` exporting a `PocketBaseLike` type (`collection(name) => { create, getFirstListItem, update, getFullList }`) and a `getPocketBase()` factory used by production code. Implement `tasks-repo.ts` with:
  - `createIfAbsent({taskId, request, adapterType, systemContext, worktreePath})` — tries `getFirstListItem('taskId = "…"')` first; on 404, creates a new `_tasks` row with `state: "queued"`, `seq: 0`.
  - `getByTaskId(taskId)` — returns the `_tasks` row.
  - `applyTransition(taskId, event, patch)` — reads, calls `transition()`, writes `{ state: next, seq: row.seq + 1, ...patch }`.
  - `enqueue(taskId)` — marks a queued row as eligible for `processQueue` (just touches `queuedAt`).
  - `sweepOnStartup()` — `getFullList({ filter: 'state = "working" || state = "deploying"' })`; for each, updates to `{ state: "failed", error: "server_restart", seq: seq+1 }`; returns the swept rows.
  - `streamStatus(taskId, signal)` — uses `pb.collection("_tasks").subscribe(recordId, cb)`; yields `TaskStatus` objects as realtime updates arrive; unsubscribes on `signal.abort`.
- [ ] **Step 4: Run and confirm pass.**
- [ ] **Step 5: Commit** — `plan3(task7): TasksRepo with idempotent insert, startup sweep, realtime stream`.

---

## Task 8: `OpenClawAdapter` against a mock WebSocket server

**Files to create:**
- Create: `packages/dispatch/src/adapters/openclaw.ts`
- Create: `packages/dispatch/test/unit/openclaw-adapter.test.ts`

- [ ] **Step 1: Write the failing test** — spin up a real `ws` server on `127.0.0.1:0`, scripted to complete a full handshake + dispatch + event stream, then assert the adapter walks `working -> clarifying -> done`.
  ```ts
  import { describe, it, expect, beforeEach, afterEach } from "vitest";
  import { WebSocketServer } from "ws";
  import { OpenClawAdapter } from "../../src/adapters/openclaw.js";
  import type { SystemContext } from "../../src/adapters/types.js";

  const ctxStub = (): SystemContext => ({
    cwd: "/tmp", mcpEndpointUrl: "http://127.0.0.1:4100/mcp",
    mcpBearerToken: "mt", mcpConfigPath: "/tmp/mcp.json",
    systemPrompt: "", allowedTools: ["Read","Write","Bash"],
  });

  let wss: WebSocketServer, url: string;
  beforeEach(() => new Promise<void>((done) => {
    wss = new WebSocketServer({ port: 0 }, () => {
      const port = (wss.address() as any).port;
      url = `ws://127.0.0.1:${port}`;
      done();
    });
    wss.on("connection", (sock) => {
      sock.send(JSON.stringify({ type: "event", event: "connect.challenge", payload: { nonce: "n", ts: 1 } }));
      sock.on("message", (raw) => {
        const frame = JSON.parse(raw.toString());
        if (frame.method === "connect") {
          sock.send(JSON.stringify({ type: "res", id: frame.id, ok: true, payload: { hello: true } }));
        } else if (frame.method === "chat.send") {
          expect(frame.params.idempotencyKey).toBe("task-1");
          expect(frame.params.metadata.anyClawTaskId).toBe("task-1");
          sock.send(JSON.stringify({ type: "res", id: frame.id, ok: true, payload: { runId: "run-xyz" } }));
          setTimeout(() => {
            sock.send(JSON.stringify({ type: "event", event: "session.tool",
              payload: { type: "tool_call", tool: "anyclaw_ask_user", args: { question: "Which DB?" } } }));
            sock.send(JSON.stringify({ type: "event", event: "session.message",
              payload: { type: "run_complete", status: "success", summary: "Added" } }));
          }, 20);
        } else if (frame.method === "sessions.abort") {
          sock.send(JSON.stringify({ type: "res", id: frame.id, ok: true, payload: {} }));
        }
      });
    });
  }));
  afterEach(() => new Promise<void>((r) => wss.close(() => r())));

  describe("OpenClawAdapter", () => {
    it("handshakes, sends chat.send with idempotencyKey, returns runId", async () => {
      const a = new OpenClawAdapter({ gatewayUrl: url, token: "t", workspace: "ws" });
      const h = await a.dispatch("task-1", "add mood tracker", ctxStub(), AbortSignal.timeout(5000));
      expect(h.adapterRef).toBe("run-xyz");
      await a.dispose();
    });

    it("subscribe yields clarifying then done", async () => {
      const a = new OpenClawAdapter({ gatewayUrl: url, token: "t", workspace: "ws" });
      await a.dispatch("task-1", "add mood tracker", ctxStub(), AbortSignal.timeout(5000));
      const states: string[] = [];
      for await (const s of a.subscribe("task-1", AbortSignal.timeout(5000))) {
        states.push(s.state);
        if (s.state === "done" || s.state === "failed") break;
      }
      expect(states).toContain("clarifying");
      expect(states[states.length - 1]).toBe("done");
      await a.dispose();
    });
  });
  ```
- [ ] **Step 2: Run and confirm fail.**
- [ ] **Step 3: Implement** `src/adapters/openclaw.ts`:
  ```ts
  import WebSocket from "ws";
  import { AsyncQueue } from "../util/async-queue.js";
  import { AdapterError, type AgentAdapter, type SystemContext, type TaskHandle, type TaskStatus } from "./types.js";

  export interface OpenClawOptions { gatewayUrl: string; token: string; workspace: string; }

  type Pending = { resolve: (v: any) => void; reject: (e: Error) => void };

  export class OpenClawAdapter implements AgentAdapter {
    readonly name = "OpenClaw";
    private ws?: WebSocket;
    private nextId = 1;
    private pending = new Map<number, Pending>();
    private queues = new Map<string, AsyncQueue<TaskStatus>>();
    private adapterRefs = new Map<string, string>();
    private handshook = false;

    constructor(private readonly opts: OpenClawOptions) {}

    async healthCheck() { try { await this.ensureConnected(); return { ok: true }; } catch (e: any) { return { ok: false, detail: e.message }; } }

    private async ensureConnected(): Promise<void> {
      if (this.handshook) return;
      this.ws = new WebSocket(this.opts.gatewayUrl, { headers: { authorization: `Bearer ${this.opts.token}` } });
      await new Promise<void>((res, rej) => {
        this.ws!.once("open", () => res());
        this.ws!.once("error", (e) => rej(e));
      });
      await new Promise<void>((res) => {
        const onMsg = (raw: WebSocket.RawData) => {
          const frame = JSON.parse(raw.toString());
          if (frame.type === "event" && frame.event === "connect.challenge") {
            this.ws!.off("message", onMsg);
            res();
          }
        };
        this.ws!.on("message", onMsg);
      });
      this.ws!.on("message", (raw) => this.onFrame(JSON.parse(raw.toString())));
      await this.rpc("connect", { workspace: this.opts.workspace });
      this.handshook = true;
    }

    private rpc(method: string, params: any): Promise<any> {
      const id = this.nextId++;
      return new Promise((resolve, reject) => {
        this.pending.set(id, { resolve, reject });
        this.ws!.send(JSON.stringify({ type: "req", id, method, params }));
      });
    }

    private onFrame(frame: any): void {
      if (frame.type === "res") {
        const p = this.pending.get(frame.id);
        if (!p) return;
        this.pending.delete(frame.id);
        frame.ok ? p.resolve(frame.payload) : p.reject(new AdapterError(frame.error ?? "rpc failed", "INTERNAL", true));
        return;
      }
      if (frame.type === "event") this.routeEvent(frame);
    }

    private routeEvent(frame: any): void {
      const taskId = frame.payload?.metadata?.anyClawTaskId ?? this.findTaskByRunId(frame.payload?.runId);
      if (!taskId) return;
      const q = this.queues.get(taskId);
      if (!q) return;
      const status = this.mapEventToStatus(frame);
      if (status) q.push(status);
      if (status?.state === "done" || status?.state === "failed") q.close();
    }

    private findTaskByRunId(runId?: string): string | undefined {
      if (!runId) return undefined;
      for (const [tid, ref] of this.adapterRefs) if (ref === runId) return tid;
      return undefined;
    }

    private mapEventToStatus(frame: any): TaskStatus | null {
      const now = new Date().toISOString();
      const seq = ++((this.queues.get(frame.payload?.metadata?.anyClawTaskId!) as any)?.lastSeq || 0);
      if (frame.event === "session.tool" && frame.payload?.tool === "anyclaw_ask_user") {
        return { state: "clarifying", seq, updatedAt: now, question: frame.payload.args.question };
      }
      if (frame.event === "session.message" && frame.payload?.type === "run_complete") {
        return frame.payload.status === "success"
          ? { state: "done", seq, updatedAt: now, versionDescription: frame.payload.summary }
          : { state: "failed", seq, updatedAt: now, error: frame.payload.summary };
      }
      return { state: "working", seq, updatedAt: now, progressSummary: frame.payload?.delta };
    }

    async dispatch(taskId: string, request: string, _ctx: SystemContext, _signal: AbortSignal): Promise<TaskHandle> {
      await this.ensureConnected();
      this.queues.set(taskId, new AsyncQueue<TaskStatus>());
      const payload = await this.rpc("chat.send", {
        idempotencyKey: taskId,
        message: request,
        metadata: { anyClawTaskId: taskId },
      });
      this.adapterRefs.set(taskId, payload.runId);
      return { taskId, adapterRef: payload.runId };
    }

    async *subscribe(taskId: string, signal: AbortSignal): AsyncIterable<TaskStatus> {
      const q = this.queues.get(taskId);
      if (!q) throw new AdapterError(`no queue for ${taskId}`, "BAD_REQUEST", false);
      signal.addEventListener("abort", () => q.close());
      for await (const s of q) yield s;
    }

    async answerQuestion(taskId: string, _clarificationId: string, answer: string): Promise<void> {
      await this.rpc("chat.send", { idempotencyKey: `${taskId}:answer:${Date.now()}`, message: answer, metadata: { anyClawTaskId: taskId } });
    }

    async cancel(taskId: string): Promise<void> {
      const ref = this.adapterRefs.get(taskId);
      if (!ref) return;
      await this.rpc("sessions.abort", { runId: ref });
      this.queues.get(taskId)?.close();
    }

    async dispose(): Promise<void> { this.ws?.close(); this.handshook = false; }
  }
  ```
- [ ] **Step 4: Run and confirm pass.**
- [ ] **Step 5: Commit** — `plan3(task8): OpenClaw adapter with mock gateway tests`.

---

## Task 9: `ClaudeCodeAdapter` against a mock `claude` binary

**Files to create:**
- Create: `packages/dispatch/src/adapters/claude-code.ts`
- Create: `packages/dispatch/test/unit/claude-code-adapter.test.ts`
- Create: `packages/dispatch/test/fixtures/mock-claude.mjs`

- [ ] **Step 1: Write the failing test** — the mock binary reads its argv and emits `stream-json` lines:
  ```js
  #!/usr/bin/env node
  process.stdout.write(JSON.stringify({ type: "system", session_id: "sess-42" }) + "\n");
  process.stdout.write(JSON.stringify({
    type: "assistant",
    message: { content: [{ type: "tool_use", name: "anyclaw_ask_user", input: { question: "DB?" } }] }
  }) + "\n");
  process.stdout.write(JSON.stringify({ type: "result", result: "done description" }) + "\n");
  process.exit(0);
  ```
  And the test:
  ```ts
  import { describe, it, expect, vi } from "vitest";
  import { mkdtemp, readFile } from "fs/promises";
  import { join } from "path";
  import { tmpdir } from "os";
  import { fileURLToPath } from "url";
  import { ClaudeCodeAdapter } from "../../src/adapters/claude-code.js";

  const mockBin = fileURLToPath(new URL("../fixtures/mock-claude.mjs", import.meta.url));

  describe("ClaudeCodeAdapter", () => {
    it("writes mcp-config before spawn and persists session_id", async () => {
      const tmp = await mkdtemp(join(tmpdir(), "cc-"));
      const persistSessionId = vi.fn();
      const persistTaskStatus = vi.fn();
      const a = new ClaudeCodeAdapter({
        executablePath: process.execPath,
        executableArgs: [mockBin],
        maxBudgetUsd: 1,
        getApiKey: async () => "fake-key",
        persistSessionId, persistTaskStatus,
      });
      const ctx = {
        cwd: tmp,
        mcpEndpointUrl: "http://127.0.0.1:4100/mcp",
        mcpBearerToken: "tok",
        mcpConfigPath: join(tmp, "mcp.json"),
        systemPrompt: "", allowedTools: ["Read","Write","Bash"],
      };
      const h = await a.dispatch("t1", "build it", ctx, AbortSignal.timeout(10_000));
      const cfg = JSON.parse(await readFile(ctx.mcpConfigPath, "utf8"));
      expect(cfg.mcpServers.anyclaw.url).toBe(ctx.mcpEndpointUrl);
      expect(cfg.mcpServers.anyclaw.headers["x-anyclaw-task-id"]).toBe("t1");
      expect(h.taskId).toBe("t1");
      const states: string[] = [];
      for await (const s of a.subscribe("t1", AbortSignal.timeout(10_000))) {
        states.push(s.state);
        if (s.state === "done" || s.state === "failed") break;
      }
      expect(states).toEqual(expect.arrayContaining(["clarifying","done"]));
      expect(persistSessionId).toHaveBeenCalledWith("t1", "sess-42");
    });
  });
  ```
- [ ] **Step 2: Run and confirm fail.**
- [ ] **Step 3: Implement** `src/adapters/claude-code.ts`:
  ```ts
  import { spawn, type ChildProcess } from "child_process";
  import { writeFile } from "fs/promises";
  import { createInterface } from "readline";
  import { AsyncQueue } from "../util/async-queue.js";
  import { AdapterError, type AgentAdapter, type SystemContext, type TaskHandle, type TaskStatus } from "./types.js";

  export interface ClaudeCodeOptions {
    executablePath: string;
    executableArgs?: string[];
    maxBudgetUsd: number;
    getApiKey: () => Promise<string>;
    persistSessionId?: (taskId: string, sessionId: string) => void | Promise<void>;
    persistTaskStatus?: (taskId: string, status: TaskStatus) => void | Promise<void>;
  }

  interface TaskRec { child: ChildProcess; queue: AsyncQueue<TaskStatus>; sessionId?: string; }

  export class ClaudeCodeAdapter implements AgentAdapter {
    readonly name = "ClaudeCode";
    private tasks = new Map<string, TaskRec>();
    constructor(private readonly opts: ClaudeCodeOptions) {}

    async healthCheck() { return { ok: true }; }

    async dispatch(taskId: string, request: string, ctx: SystemContext, signal: AbortSignal): Promise<TaskHandle> {
      await writeFile(ctx.mcpConfigPath, JSON.stringify({
        mcpServers: {
          anyclaw: {
            type: "streamable-http",
            url: ctx.mcpEndpointUrl,
            headers: { authorization: `Bearer ${ctx.mcpBearerToken}`, "x-anyclaw-task-id": taskId },
          },
        },
      }, null, 2));
      const apiKey = await this.opts.getApiKey();
      const args = [
        ...(this.opts.executableArgs ?? []),
        "--print", request,
        "--output-format", "stream-json",
        "--mcp-config", ctx.mcpConfigPath,
        "--allowedTools", ctx.allowedTools.join(","),
      ];
      const child = spawn(this.opts.executablePath, args, {
        cwd: ctx.cwd,
        env: { ...process.env, ANTHROPIC_API_KEY: apiKey },
        signal,
      });
      const queue = new AsyncQueue<TaskStatus>();
      const rec: TaskRec = { child, queue };
      this.tasks.set(taskId, rec);
      this.consumeOutput(taskId, rec);
      return { taskId, adapterRef: `pid:${child.pid}` };
    }

    private consumeOutput(taskId: string, rec: TaskRec): void {
      const rl = createInterface({ input: rec.child.stdout! });
      rl.on("line", async (line) => {
        if (!line.trim()) return;
        let evt: any;
        try { evt = JSON.parse(line); } catch { return; }
        if (evt.type === "system" && evt.session_id && !rec.sessionId) {
          rec.sessionId = evt.session_id;
          await this.opts.persistSessionId?.(taskId, evt.session_id);
        }
        const status = this.updateStatusFromEvent(evt, rec.queue);
        if (status) {
          rec.queue.push(status);
          await this.opts.persistTaskStatus?.(taskId, status);
          if (status.state === "done" || status.state === "failed") rec.queue.close();
        }
      });
      rec.child.on("exit", (code) => {
        if (code !== 0 && code !== null) {
          const seq = ++(rec.queue as any).lastSeq;
          rec.queue.push({ state: "failed", seq, updatedAt: new Date().toISOString(), error: `exit ${code}` });
        }
        rec.queue.close();
      });
    }

    private updateStatusFromEvent(evt: any, queue: AsyncQueue<TaskStatus>): TaskStatus | null {
      const now = new Date().toISOString();
      const seq = ++(queue as any).lastSeq;
      if (evt.type === "assistant") {
        const tool = evt.message?.content?.find?.((c: any) => c.type === "tool_use" && c.name === "anyclaw_ask_user");
        if (tool) return { state: "clarifying", seq, updatedAt: now, question: tool.input?.question };
        return { state: "working", seq, updatedAt: now };
      }
      if (evt.type === "result") return { state: "done", seq, updatedAt: now, versionDescription: evt.result };
      return null;
    }

    async *subscribe(taskId: string, signal: AbortSignal): AsyncIterable<TaskStatus> {
      const rec = this.tasks.get(taskId);
      if (!rec) throw new AdapterError(`no task ${taskId}`, "BAD_REQUEST", false);
      signal.addEventListener("abort", () => rec.queue.close());
      for await (const s of rec.queue) yield s;
    }

    async answerQuestion(_taskId: string, _cid: string, _answer: string): Promise<void> { /* handled via MCP tool return */ }

    async cancel(taskId: string): Promise<void> {
      const rec = this.tasks.get(taskId);
      if (!rec) return;
      rec.child.kill("SIGTERM");
      setTimeout(() => { try { rec.child.kill("SIGKILL"); } catch {} }, 5000).unref();
      rec.queue.close();
    }

    async dispose(): Promise<void> {
      for (const [, rec] of this.tasks) { try { rec.child.kill("SIGTERM"); } catch {} rec.queue.close(); }
      this.tasks.clear();
    }
  }
  ```
- [ ] **Step 4: Run and confirm pass.**
- [ ] **Step 5: Commit** — `plan3(task9): Claude Code adapter with stream-json parsing`.

---

## Task 10: `WebhookAdapter` against a mock HTTP server

**Files to create:**
- Create: `packages/dispatch/src/adapters/webhook.ts`
- Create: `packages/dispatch/test/unit/webhook-adapter.test.ts`

- [ ] **Step 1: Write the failing test**
  ```ts
  import http from "http";
  import { describe, it, expect } from "vitest";
  import { WebhookAdapter } from "../../src/adapters/webhook.js";
  import { AdapterError } from "../../src/adapters/types.js";

  const ctxStub = (o: Partial<any> = {}) => ({
    cwd: "/tmp", mcpEndpointUrl: "http://127.0.0.1:4100/mcp",
    mcpBearerToken: "mtoken", mcpConfigPath: "/tmp/mcp.json",
    systemPrompt: "", allowedTools: [], ...o,
  });

  describe("WebhookAdapter", () => {
    it("POSTs taskId/callback/mcp URL and returns externalId", async () => {
      const server = http.createServer((req, res) => {
        let body = ""; req.on("data", (c) => body += c); req.on("end", () => {
          const b = JSON.parse(body);
          expect(b.taskId).toBe("t1");
          expect(b.callbackUrl).toBe("http://cb/api/webhook/callback");
          expect(b.mcpBearerToken).toBe("mtoken");
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ externalId: "ext-9" }));
        });
      });
      await new Promise<void>((r) => server.listen(0, r));
      const port = (server.address() as any).port;
      const a = new WebhookAdapter({ dispatchUrl: `http://127.0.0.1:${port}/dispatch`, callbackBaseUrl: "http://cb", tasksRepo: { streamStatus: async function*() {} } as any });
      const h = await a.dispatch("t1", "req", ctxStub(), AbortSignal.timeout(2000));
      expect(h.adapterRef).toBe("ext-9");
      await new Promise<void>((r) => server.close(() => r()));
    });

    it("on 401 throws AdapterError AUTH_FAILED non-retryable", async () => {
      const server = http.createServer((_req, res) => { res.writeHead(401); res.end(); });
      await new Promise<void>((r) => server.listen(0, r));
      const port = (server.address() as any).port;
      const a = new WebhookAdapter({ dispatchUrl: `http://127.0.0.1:${port}/d`, callbackBaseUrl: "http://cb", tasksRepo: {} as any });
      await expect(a.dispatch("t1","r",ctxStub(),AbortSignal.timeout(1000)))
        .rejects.toMatchObject({ name: "AdapterError", code: "AUTH_FAILED", retryable: false });
      await new Promise<void>((r) => server.close(() => r()));
    });

    it("on 502 throws AdapterError INTERNAL retryable", async () => {
      const server = http.createServer((_req, res) => { res.writeHead(502); res.end(); });
      await new Promise<void>((r) => server.listen(0, r));
      const port = (server.address() as any).port;
      const a = new WebhookAdapter({ dispatchUrl: `http://127.0.0.1:${port}/d`, callbackBaseUrl: "http://cb", tasksRepo: {} as any });
      await expect(a.dispatch("t1","r",ctxStub(),AbortSignal.timeout(1000)))
        .rejects.toMatchObject({ name: "AdapterError", code: "INTERNAL", retryable: true });
      await new Promise<void>((r) => server.close(() => r()));
    });
  });
  ```
- [ ] **Step 2: Run and confirm fail.**
- [ ] **Step 3: Implement** `src/adapters/webhook.ts`:
  ```ts
  import { AdapterError, type AgentAdapter, type SystemContext, type TaskHandle, type TaskStatus } from "./types.js";

  export interface WebhookOptions {
    dispatchUrl: string;
    callbackBaseUrl: string;
    tasksRepo: { streamStatus(taskId: string, signal: AbortSignal): AsyncIterable<TaskStatus> };
  }

  export class WebhookAdapter implements AgentAdapter {
    readonly name = "Webhook";
    constructor(private readonly opts: WebhookOptions) {}
    async healthCheck() { return { ok: true }; }

    async dispatch(taskId: string, request: string, ctx: SystemContext, signal: AbortSignal): Promise<TaskHandle> {
      const res = await fetch(this.opts.dispatchUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          taskId, request,
          callbackUrl: `${this.opts.callbackBaseUrl}/api/webhook/callback`,
          mcpEndpointUrl: ctx.mcpEndpointUrl,
          mcpBearerToken: ctx.mcpBearerToken,
        }),
        signal,
      });
      if (res.status === 401 || res.status === 403) throw new AdapterError(`auth ${res.status}`, "AUTH_FAILED", false);
      if (res.status >= 500) throw new AdapterError(`server ${res.status}`, "INTERNAL", true);
      if (!res.ok) throw new AdapterError(`bad ${res.status}`, "BAD_REQUEST", false);
      const body = await res.json() as { externalId: string };
      return { taskId, adapterRef: body.externalId };
    }

    subscribe(taskId: string, signal: AbortSignal): AsyncIterable<TaskStatus> {
      return this.opts.tasksRepo.streamStatus(taskId, signal);
    }

    async answerQuestion(_t: string, _c: string, _a: string): Promise<void> { /* routed via REST callback */ }
    async cancel(_taskId: string): Promise<void> { /* hook provider should respect cancellation via MCP */ }
    async dispose(): Promise<void> {}
  }
  ```
- [ ] **Step 4: Run and confirm pass.**
- [ ] **Step 5: Commit** — `plan3(task10): Webhook adapter with HTTP mock tests`.

---

## Task 11: `AdapterManager` — single-flight queue, dispatch wiring, cancel

**Files to create:**
- Create: `packages/dispatch/src/adapters/manager.ts`
- Create: `packages/dispatch/test/unit/adapter-manager.test.ts`

- [ ] **Step 1: Write the failing test**
  ```ts
  import { describe, it, expect, beforeEach } from "vitest";
  import { AdapterManager } from "../../src/adapters/manager.js";
  import { NoopResourceLimits } from "../../src/resource-limits/noop.js";
  import { TasksRepo } from "../../src/persistence/tasks-repo.js";
  import { makeFakePb } from "./helpers/fake-pb.js";
  import type { AgentAdapter, TaskStatus } from "../../src/adapters/types.js";

  class MockAdapter implements AgentAdapter {
    readonly name = "Mock";
    script: TaskStatus[] = [];
    dispatched: string[] = [];
    cancelled: string[] = [];
    async healthCheck() { return { ok: true }; }
    async dispatch(taskId: string) { this.dispatched.push(taskId); return { taskId, adapterRef: "a" }; }
    async *subscribe() { for (const s of this.script) yield s; }
    async answerQuestion() {}
    async cancel(taskId: string) { this.cancelled.push(taskId); }
    async dispose() {}
  }

  const makeMgr = (adapter: AgentAdapter) => {
    const pb = makeFakePb();
    const repo = new TasksRepo(pb as any);
    const worktrees = { create: async () => "/tmp/wt", mergeAndRemove: async () => {}, discard: async () => {} };
    const mgr = new AdapterManager({ adapter, repo, worktrees: worktrees as any, resourceLimits: new NoopResourceLimits(), config: { adapter: "claude-code", maxTaskDurationMs: 60_000, clarificationTimeoutMs: 10_000, clarificationTimeoutMode: "best_judgment", maxBudgetUsd: 1 }, buildSystemContext: async () => ({ cwd: "/tmp", mcpEndpointUrl: "http://127.0.0.1:4100/mcp", mcpBearerToken: "t", mcpConfigPath: "/tmp/m.json", systemPrompt: "", allowedTools: [] }) });
    return { pb, repo, mgr };
  };

  describe("AdapterManager", () => {
    it("processQueue dispatches and drives to done", async () => {
      const adapter = new MockAdapter();
      adapter.script = [
        { state: "working", seq: 1, updatedAt: new Date().toISOString() },
        { state: "done", seq: 2, updatedAt: new Date().toISOString(), versionDescription: "v1" },
      ];
      const { repo, mgr } = makeMgr(adapter);
      await repo.createIfAbsent({ taskId: "t1", request: "r", adapterType: "claude-code", systemContext: "{}", worktreePath: "/tmp/wt" });
      await repo.enqueue("t1");
      await mgr.processQueue();
      expect(adapter.dispatched).toEqual(["t1"]);
      expect((await repo.getByTaskId("t1")).state).toBe("done");
    });

    it("cancel on working task calls adapter.cancel and transitions to cancelled", async () => {
      const adapter = new MockAdapter();
      const { repo, mgr } = makeMgr(adapter);
      await repo.createIfAbsent({ taskId: "t2", request: "r", adapterType: "claude-code", systemContext: "{}", worktreePath: "/tmp/wt" });
      await repo.applyTransition("t2", "scheduler_pick", {});
      await mgr.cancel("t2");
      expect(adapter.cancelled).toContain("t2");
      expect((await repo.getByTaskId("t2")).state).toBe("cancelled");
    });
  });
  ```
- [ ] **Step 2: Run and confirm fail.**
- [ ] **Step 3: Implement** `src/adapters/manager.ts`:
  ```ts
  import { isTerminal, type AgentAdapter, type SystemContext, type TaskStatus, type DispatchConfig } from "./types.js";
  import type { TasksRepo } from "../persistence/tasks-repo.js";
  import type { WorktreeManager } from "@anyclaw/shared";
  import type { ResourceLimits } from "../resource-limits/types.js";

  export interface AdapterManagerDeps {
    adapter: AgentAdapter;
    repo: TasksRepo;
    worktrees: WorktreeManager;
    resourceLimits: ResourceLimits;
    config: DispatchConfig;
    buildSystemContext: (taskId: string) => Promise<SystemContext>;
  }

  export class AdapterManager {
    private running: string | null = null;
    private controllers = new Map<string, AbortController>();
    constructor(private readonly deps: AdapterManagerDeps) {}

    async onStartup(): Promise<void> {
      const swept = await this.deps.repo.sweepOnStartup();
      for (const row of swept) { try { await this.deps.worktrees.discard(row.taskId); } catch {} }
      // resume of clarifying tasks — see Task 12.
    }

    async processQueue(): Promise<void> {
      if (this.running) return;
      const next = await this.deps.repo.popNextQueued();
      if (!next) return;
      this.running = next.taskId;
      const ctrl = new AbortController();
      this.controllers.set(next.taskId, ctrl);
      const timeout = AbortSignal.timeout(this.deps.config.maxTaskDurationMs);
      const signal = AbortSignal.any([ctrl.signal, timeout]);
      try {
        await this.deps.repo.applyTransition(next.taskId, "scheduler_pick", {});
        const ctx = await this.deps.buildSystemContext(next.taskId);
        await this.deps.adapter.dispatch(next.taskId, next.request, ctx, signal);
        for await (const status of this.deps.adapter.subscribe(next.taskId, signal)) {
          await this.applyStatus(next.taskId, status);
          if (isTerminal(status.state)) break;
        }
      } catch (e: any) {
        try { await this.deps.repo.applyTransition(next.taskId, "validation_fail", { error: e.message }); } catch {}
      } finally {
        this.controllers.delete(next.taskId);
        this.running = null;
        const final = await this.deps.repo.getByTaskId(next.taskId);
        if (final.state === "done") await this.deps.worktrees.mergeAndRemove(next.taskId);
        else if (final.state === "failed" || final.state === "cancelled") await this.deps.worktrees.discard(next.taskId);
      }
    }

    private async applyStatus(taskId: string, status: TaskStatus): Promise<void> {
      switch (status.state) {
        case "working":    await this.deps.repo.applyTransition(taskId, "progress", { progressSummary: status.progressSummary }); break;
        case "clarifying": await this.deps.repo.applyTransition(taskId, "ask_user", { question: status.question, clarificationId: status.clarificationId }); break;
        case "deploying":  await this.deps.repo.applyTransition(taskId, "deploy_called", {}); break;
        case "done":       await this.deps.repo.applyTransition(taskId, "validation_pass", { versionDescription: status.versionDescription }); break;
        case "failed":     await this.deps.repo.applyTransition(taskId, "validation_fail", { error: status.error }); break;
      }
    }

    async cancel(taskId: string): Promise<void> {
      this.controllers.get(taskId)?.abort();
      await this.deps.adapter.cancel(taskId);
      await this.deps.repo.applyTransition(taskId, "cancel", {});
    }
  }
  ```
  Also add `TasksRepo.popNextQueued()` that returns the oldest `_tasks` row in `state = "queued"` (or `null`).
- [ ] **Step 4: Run and confirm pass.**
- [ ] **Step 5: Commit** — `plan3(task11): AdapterManager single-flight queue with cancel`.

---

## Task 12: Startup sweep + resume for `clarifying` tasks

**Files to create/modify:**
- Modify: `packages/dispatch/src/adapters/manager.ts` (extend `onStartup`)
- Create: `packages/dispatch/test/unit/adapter-manager-resume.test.ts`

- [ ] **Step 1: Write the failing test** — seed a `working` task and a `clarifying` task whose clarification row is already `answered`; assert `onStartup` sweeps the working task to `failed` and resumes the clarifying task.
- [ ] **Step 2: Run and confirm fail.**
- [ ] **Step 3: Extend** `AdapterManager.onStartup` per design §11.3: after `sweepOnStartup`, list `clarifying` `_tasks`, for each check `_task_clarifications` by `taskId`; if no `pending` row exists, call `adapter.resumeTask?.(taskId)` (or `markFailed("Adapter does not support resume")` if undefined); leave tasks with pending clarifications alone.
- [ ] **Step 4: Run and confirm pass.**
- [ ] **Step 5: Commit** — `plan3(task12): startup sweep and clarifying-task resume`.

---

## Task 13: Clarification relay + timeout modes

**Files to create:**
- Create: `packages/dispatch/src/lifecycle/clarification.ts`
- Create: `packages/dispatch/test/unit/clarification-relay.test.ts`

- [ ] **Step 1: Write the failing test** — three cases: `best_judgment` resolves with a fallback answer after timeout; `pause_indefinitely` never times out; answer arriving before the timeout resolves with the actual answer.
- [ ] **Step 2: Run and confirm fail.**
- [ ] **Step 3: Implement** `waitForAnswer(pb, clarificationId, timeoutMs, mode)` that subscribes to `_task_clarifications` realtime updates and races the subscription against the timeout per the mode.
- [ ] **Step 4: Run and confirm pass.**
- [ ] **Step 5: Commit** — `plan3(task13): clarification relay with configurable timeout`.

---

## Task 14: REST auth middleware

**Files to create:**
- Create: `packages/dispatch/src/rest/auth.ts`
- Create: `packages/dispatch/test/unit/auth.test.ts`

- [ ] **Step 1: Write the failing test** — `authRequired` middleware returns 401 when `Authorization` header is missing, 401 when the token is invalid per the injected verifier, and calls `next()` on success attaching `req.userToken`.
- [ ] **Step 2: Run and confirm fail.**
- [ ] **Step 3: Implement** `authRequired({ verify })` where `verify(token)` is injectable. In production, verify against PocketBase user auth.
- [ ] **Step 4: Run and confirm pass.**
- [ ] **Step 5: Commit** — `plan3(task14): REST auth middleware`.

---

## Task 15: REST API — tasks submit/answer/cancel + exactly-once

**Files to create:**
- Create: `packages/dispatch/src/rest/tasks.ts`
- Create: `packages/dispatch/src/rest/router.ts`
- Create: `packages/dispatch/test/integration/rest-tasks.test.ts`

- [ ] **Step 1: Write the failing test** using `supertest` against an Express app built by a `buildApp({ pb, manager, repo, verifyAuth })` factory:
  ```ts
  import request from "supertest";
  import { describe, it, expect, beforeEach } from "vitest";
  import { randomUUID } from "crypto";
  import { buildApp } from "../../src/app.js";
  // ... construct pb, repo, manager stub; verifyAuth: async (t) => t === "t" ? "user-1" : null

  describe("REST /api/tasks", () => {
    it("POST /api/tasks with new UUID returns queued", async () => {
      const r = await request(app).post("/api/tasks").set("authorization","Bearer t").send({ taskId: randomUUID(), request: "build it" });
      expect(r.status).toBe(200);
      expect(r.body.state).toBe("queued");
    });
    it("POST /api/tasks with existing UUID is idempotent", async () => {
      const id = randomUUID();
      const a = await request(app).post("/api/tasks").set("authorization","Bearer t").send({ taskId: id, request: "build it" });
      const b = await request(app).post("/api/tasks").set("authorization","Bearer t").send({ taskId: id, request: "build it" });
      expect(a.body.seq).toBe(b.body.seq);
      expect(countTasks()).toBe(1);
    });
    it("POST /api/tasks rejects malformed taskId", async () => {
      const r = await request(app).post("/api/tasks").set("authorization","Bearer t").send({ taskId: "not-a-uuid", request: "x" });
      expect(r.status).toBe(400);
    });
    it("POST /api/tasks/:id/answer writes _task_clarifications row and returns 204", async () => { /* ... */ });
    it("POST /api/tasks/:id/cancel calls manager.cancel and returns current status", async () => { /* ... */ });
    it("missing auth returns 401", async () => { /* ... */ });
  });
  ```
- [ ] **Step 2: Run and confirm fail.**
- [ ] **Step 3: Implement** `src/rest/tasks.ts`:
  ```ts
  import { Router } from "express";
  import { z } from "zod";
  import type { TasksRepo } from "../persistence/tasks-repo.js";
  import type { AdapterManager } from "../adapters/manager.js";

  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const SubmitBody = z.object({ taskId: z.string().regex(UUID_RE), request: z.string().min(1).max(8000) });
  const AnswerBody = z.object({ clarificationId: z.string(), answer: z.string().min(1).max(8000) });

  export interface TasksRouterDeps {
    repo: TasksRepo;
    manager: AdapterManager;
    buildSystemContext: (taskId: string) => Promise<any>;
    worktrees: { create(taskId: string): Promise<string> };
  }

  export function tasksRouter(deps: TasksRouterDeps): Router {
    const r = Router();

    r.post("/", async (req, res, next) => {
      try {
        const parsed = SubmitBody.safeParse(req.body);
        if (!parsed.success) return res.status(400).json({ error: "bad_request", details: parsed.error.flatten() });
        const { taskId, request } = parsed.data;
        const existing = await deps.repo.tryGet(taskId);
        if (existing) return res.json({ taskId, state: existing.state, seq: existing.seq });
        const worktreePath = await deps.worktrees.create(taskId);
        const systemContext = await deps.buildSystemContext(taskId);
        const row = await deps.repo.createIfAbsent({ taskId, request, adapterType: "claude-code", systemContext: JSON.stringify(systemContext), worktreePath });
        await deps.repo.enqueue(taskId);
        deps.manager.processQueue().catch(() => {});
        return res.json({ taskId, state: row.state, seq: row.seq });
      } catch (e) { next(e); }
    });

    r.post("/:taskId/answer", async (req, res, next) => {
      try {
        const parsed = AnswerBody.safeParse(req.body);
        if (!parsed.success) return res.status(400).json({ error: "bad_request" });
        await deps.repo.writeClarificationAnswer(parsed.data.clarificationId, parsed.data.answer);
        res.status(204).end();
      } catch (e) { next(e); }
    });

    r.post("/:taskId/cancel", async (req, res, next) => {
      try {
        await deps.manager.cancel(req.params.taskId);
        const row = await deps.repo.getByTaskId(req.params.taskId);
        res.json({ taskId: row.taskId, state: row.state, seq: row.seq });
      } catch (e) { next(e); }
    });

    r.get("/:taskId", async (req, res, next) => {
      try { res.json(await deps.repo.getByTaskId(req.params.taskId)); } catch (e) { next(e); }
    });
    r.get("/", async (_req, res, next) => {
      try { res.json(await deps.repo.listAll()); } catch (e) { next(e); }
    });
    r.get("/:taskId/activity", async (req, res, next) => {
      try { res.json(await deps.repo.listActivity(req.params.taskId)); } catch (e) { next(e); }
    });

    return r;
  }
  ```
  Also add `TasksRepo.tryGet`, `writeClarificationAnswer`, `listAll`, `listActivity`.
- [ ] **Step 4: Run and confirm pass.**
- [ ] **Step 5: Commit** — `plan3(task15): REST /api/tasks endpoints with idempotent upsert`.

---

## Task 16: REST API — `/api/health`

**Files to create:**
- Create: `packages/dispatch/src/rest/health.ts`
- Create: `packages/dispatch/test/integration/rest-health.test.ts`

> Plan 1's scaffold already exposes a `/health` check on the dispatch package. Plan 3 adds the richer `/api/health` that Plan 5 (Mobile App) calls — returning both dispatch liveness and adapter liveness.

- [ ] **Step 1: Write the failing test** — `GET /api/health` returns `{ ok: true, adapter: { ok: true }, uptimeMs: <number> }`; when the adapter reports not-ok, response `ok` is false but status is still 200.
- [ ] **Step 2: Run and confirm fail.**
- [ ] **Step 3: Implement** `healthRouter({ adapter })` that calls `adapter.healthCheck()` and returns both flags.
- [ ] **Step 4: Run and confirm pass.**
- [ ] **Step 5: Commit** — `plan3(task16): REST /api/health`.

---

## Task 17: REST API — `/api/settings` (GET / PATCH)

**Files to create:**
- Create: `packages/dispatch/src/rest/settings.ts`
- Create: `packages/dispatch/test/integration/rest-settings.test.ts`

> Plan 5 expects to read and update user preferences. Preferences are stored in `_user_preferences` (created by Plan 2). Plan 3 exposes the REST surface over it.

- [ ] **Step 1: Write the failing test** — `GET /api/settings` returns the key/value map; `PATCH /api/settings` with `{ clarificationTimeoutMode: "best_judgment" }` upserts that key; re-reading reflects the change. `PATCH` with an unknown key returns 400.
- [ ] **Step 2: Run and confirm fail.**
- [ ] **Step 3: Implement** `settingsRouter({ pb })`. Allowed keys: `clarificationTimeoutMode`, `clarificationTimeoutMs`, `maxBudgetUsd`, `adapterType`. Reads/writes `_user_preferences` via `pb.collection("_user_preferences")`.
- [ ] **Step 4: Run and confirm pass.**
- [ ] **Step 5: Commit** — `plan3(task17): REST /api/settings read/write user preferences`.

---

## Task 18: REST API — `/api/device/register`

**Files to create:**
- Create: `packages/dispatch/src/rest/devices.ts`
- Create: `packages/dispatch/test/integration/rest-devices.test.ts`

- [ ] **Step 1: Write the failing test** — `POST /api/device/register` with `{ expoPushToken, platform }` creates a `_devices` row bound to the authenticated `userToken`; re-posting the same `expoPushToken` is idempotent (one row); bad platform returns 400.
- [ ] **Step 2: Run and confirm fail.**
- [ ] **Step 3: Implement** `devicesRouter({ pb })` that validates `{ expoPushToken: string, platform: "ios" | "android" }` with zod, then upserts on `expo_push_token` unique index.
- [ ] **Step 4: Run and confirm pass.**
- [ ] **Step 5: Commit** — `plan3(task18): REST /api/device/register with _devices upsert`.

---

## Task 19: REST API — emergency, adapter config, webhook callback, versions

**Files to create:**
- Create: `packages/dispatch/src/rest/emergency.ts`
- Create: `packages/dispatch/src/rest/adapter.ts`
- Create: `packages/dispatch/src/rest/webhook-callback.ts`
- Create: `packages/dispatch/test/integration/rest-ops.test.ts`

- [ ] **Step 1: Write the failing test** covering:
  - `POST /api/rollback` calls the injected `rollbackManager.rollback` and `deployManager.promote`.
  - `POST /api/restart-app` invokes the injected `restartFn`.
  - `GET /api/versions` returns the list from `versionStore.list()`.
  - `PUT /api/adapter/config` calls `manager.reloadConfig`.
  - `POST /api/webhook/callback` maps each `event` (`progress`, `clarifying`, `deploying`, `done`, `failed`) onto the correct `repo.applyTransition` call and writes `_deployments` rows for `deploying`/`done`/`failed`.
- [ ] **Step 2: Run and confirm fail.**
- [ ] **Step 3: Implement** the three routers. `rollback`, `restart-app`, `versions` live in `emergency.ts`; take injected `versionStore`, `deployManager`, `rollbackManager`, `restartFn`. `adapter.ts` exposes `GET/PUT /api/adapter/config` and `GET /api/adapter/health`. `webhook-callback.ts` validates the body with zod and maps events:
  - `"progress"` → `applyTransition(id, "progress", { progressSummary })`.
  - `"clarifying"` → `ask_user` transition + write clarification row.
  - `"deploying"` → `deploy_called` + write `_deployments` row with `state: "deploying"`.
  - `"done"` → `validation_pass` + update `_deployments` row to `state: "deployed"` with `description`.
  - `"failed"` → `validation_fail` + update `_deployments` row to `state: "failed"` with `error`.
- [ ] **Step 4: Run and confirm pass.**
- [ ] **Step 5: Commit** — `plan3(task19): emergency, adapter config, webhook callback endpoints`.

---

## Task 20: Internal endpoint — `POST /internal/api-keys`

**Files to create:**
- Create: `packages/dispatch/src/rest/internal-api-keys.ts`
- Create: `packages/dispatch/test/integration/rest-internal-api-keys.test.ts`

> Called by Plan 6's install script (running on the same host as the dispatch server) to seal an LLM API key with the master key at `/data/.anyclaw/master.key` and store the sealed box in `_api_keys` (created by Plan 2). Exposed under `/internal/` and bound in Task 21 to `127.0.0.1` only — never reachable from the tunnel.

- [ ] **Step 1: Write the failing test**
  - Write a mock master key (32 random bytes) to a temp file and pass its path as `masterKeyPath`.
  - `POST /internal/api-keys` with `{ name: "anthropic", plaintext: "sk-..." }` encrypts with the master key (using `nacl.secretbox` from `@anyclaw/shared`'s crypto helpers) and writes a row to `_api_keys` with `{ name: "anthropic", sealed: <base64> }`; returns 204.
  - A second request with the same `name` overwrites the row (upsert by `name`).
  - Request without the correct loopback header / binding is rejected with 403 when the mounted router's middleware sees a non-loopback `req.ip` (simulate via `X-Forwarded-For` being ignored; trust proxy off).
  - Missing master key file returns 500 with `error: "master_key_missing"`.
- [ ] **Step 2: Run and confirm fail.**
- [ ] **Step 3: Implement** `internal-api-keys.ts`:
  ```ts
  import { Router } from "express";
  import { z } from "zod";
  import { readFile } from "fs/promises";
  import { seal } from "@anyclaw/shared"; // sealed-box helper from Plan 1
  import type PocketBase from "pocketbase";

  const Body = z.object({ name: z.string().min(1).max(64), plaintext: z.string().min(1) });

  export interface InternalApiKeysDeps { pb: PocketBase; masterKeyPath: string; }

  export function internalApiKeysRouter(deps: InternalApiKeysDeps): Router {
    const r = Router();
    r.use((req, res, next) => {
      if (req.ip !== "127.0.0.1" && req.ip !== "::1" && req.ip !== "::ffff:127.0.0.1") {
        return res.status(403).json({ error: "loopback_only" });
      }
      next();
    });
    r.post("/api-keys", async (req, res, next) => {
      try {
        const parsed = Body.safeParse(req.body);
        if (!parsed.success) return res.status(400).json({ error: "bad_request" });
        let masterKey: Buffer;
        try { masterKey = await readFile(deps.masterKeyPath); }
        catch { return res.status(500).json({ error: "master_key_missing" }); }
        const sealed = seal(Buffer.from(parsed.data.plaintext, "utf8"), masterKey);
        try {
          const existing = await deps.pb.collection("_api_keys").getFirstListItem(`name = "${parsed.data.name}"`);
          await deps.pb.collection("_api_keys").update(existing.id, { sealed: sealed.toString("base64") });
        } catch {
          await deps.pb.collection("_api_keys").create({ name: parsed.data.name, sealed: sealed.toString("base64") });
        }
        res.status(204).end();
      } catch (e) { next(e); }
    });
    return r;
  }
  ```
  The `seal` helper comes from `@anyclaw/shared` (Plan 1's crypto module). If the exact export name differs, use the equivalent one-shot NaCl secretbox helper from Plan 1 — it is not re-implemented here.
- [ ] **Step 4: Run and confirm pass.**
- [ ] **Step 5: Commit** — `plan3(task20): internal /internal/api-keys endpoint sealed with master key`.

---

## Task 21: End-to-end lifecycle integration test

**Files to create:**
- Create: `packages/dispatch/test/integration/task-lifecycle.test.ts`

- [ ] **Step 1: Write the failing test** — uses a `MockAdapter` (from Task 11) that drives the lifecycle via a controllable script, a real `WorktreeManager` (imported from `@anyclaw/shared`) over a temp git repo, a real `TasksRepo` over the fake PB, a real `AdapterManager`, and the full REST router mounted by `buildApp`. Asserts:
  - `queued -> working -> clarifying -> working -> deploying -> done` walks the full state machine.
  - The worktree is created after dispatch.
  - `POST /api/tasks/:id/answer` unblocks the adapter (the mock reads the answer back through the repo).
  - On `done`, the worktree branch is merged into `main` and the worktree directory is removed.
  - The failure path discards the worktree and leaves `main` untouched.
  - Cancel mid-`working` kills the adapter, applies the `cancelled` state, and discards the worktree.
- [ ] **Step 2: Run and confirm fail.**
- [ ] **Step 3: Implement** `buildApp(deps)` in `src/app.ts` wiring all routers; implement the test support that lets `MockAdapter` script the lifecycle; run until all three assertions pass.
- [ ] **Step 4: Run and confirm pass.**
- [ ] **Step 5: Commit** — `plan3(task21): end-to-end lifecycle integration tests`.

---

## Task 22: Process entry point — mount MCP + REST on the shared Express app

**Files to modify:**
- Modify: `packages/dispatch/src/index.ts` (extends Plan 1's scaffold)
- Create: `packages/dispatch/src/app.ts` (the `buildApp` factory, if not created in Task 21)
- Create: `packages/dispatch/test/integration/boot.test.ts`

- [ ] **Step 1: Write the failing test**
  ```ts
  import { describe, it, expect } from "vitest";
  import { buildServer } from "../../src/index.js";
  import { seedTask } from "../unit/helpers/fake-pb.js";

  describe("buildServer", () => {
    it("returns an http.Server that responds to GET /api/health on 127.0.0.1", async () => {
      const { server } = await buildServer({ config: testConfig });
      await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
      const addr = server.address() as any;
      const res = await fetch(`http://127.0.0.1:${addr.port}/api/health`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ok).toBe(true);
      await new Promise<void>((r) => server.close(() => r()));
    });

    it("mounts the MCP route from @anyclaw/mcp-server on the same app", async () => {
      const { server } = await buildServer({ config: testConfig });
      await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
      const addr = server.address() as any;
      const res = await fetch(`http://127.0.0.1:${addr.port}/mcp`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
      expect([200, 400, 401, 405]).toContain(res.status); // reachable — not 404
      await new Promise<void>((r) => server.close(() => r()));
    });

    it("runs AdapterManager.onStartup (sweep) before accepting traffic", async () => {
      await seedTask(testPb, "stranded", "working");
      await buildServer({ config: testConfig, pb: testPb });
      const row = await testPb.collection("_tasks").getFirstListItem('taskId = "stranded"');
      expect(row.state).toBe("failed");
    });
  });
  ```
- [ ] **Step 2: Run and confirm fail.**
- [ ] **Step 3: Implement** `src/index.ts` (extending Plan 1's scaffold):
  ```ts
  import http from "http";
  import express from "express";
  import { mountMcp } from "@anyclaw/mcp-server";
  import { WorktreeManager } from "@anyclaw/shared";
  import { getPocketBase } from "./persistence/pocketbase-client.js";
  import { ensureDispatchCollections } from "./persistence/collections-bootstrap.js";
  import { TasksRepo } from "./persistence/tasks-repo.js";
  import { AdapterManager } from "./adapters/manager.js";
  import { NoopResourceLimits } from "./resource-limits/noop.js";
  import { OpenClawAdapter } from "./adapters/openclaw.js";
  import { ClaudeCodeAdapter } from "./adapters/claude-code.js";
  import { WebhookAdapter } from "./adapters/webhook.js";
  import { buildApp } from "./app.js";

  export interface BuildServerOptions { config: DispatchConfig; pb?: any; }

  export async function buildServer(opts: BuildServerOptions) {
    const pb = opts.pb ?? await getPocketBase();
    await ensureDispatchCollections(pb);
    const repo = new TasksRepo(pb);
    const worktrees = new WorktreeManager({ repoDir: "/data/dev", worktreesDir: "/data/dev/.worktrees" });
    const adapter = makeAdapter(opts.config);
    const manager = new AdapterManager({ adapter, repo, worktrees, resourceLimits: new NoopResourceLimits(), config: opts.config, buildSystemContext: buildCtx(opts.config) });

    // CRITICAL: sweep before accepting traffic.
    await manager.onStartup();

    // Single Express app shared between MCP (Plan 2) and REST (Plan 3).
    const app = express();
    app.use(express.json({ limit: "2mb" }));
    app.set("trust proxy", false);

    // Mount MCP FIRST so its route prefix is claimed before any REST wildcard middleware.
    mountMcp(app, { pb, repo, manager, config: opts.config });

    // Mount REST routers (including /health, /api/*, /internal/*).
    buildApp(app, { pb, repo, manager, worktrees, adapter, config: opts.config });

    const server = http.createServer(app);
    return { server, pb, repo, manager, adapter };
  }

  export async function main(): Promise<void> {
    const config = loadConfigFromEnv();
    const { server } = await buildServer({ config });
    server.listen(4100, "127.0.0.1", () => console.log("dispatch listening on 127.0.0.1:4100"));
  }

  function makeAdapter(c: DispatchConfig) {
    switch (c.adapter) {
      case "openclaw":    return new OpenClawAdapter({ gatewayUrl: process.env.OPENCLAW_URL!, token: process.env.OPENCLAW_TOKEN!, workspace: process.env.OPENCLAW_WS! });
      case "claude-code": return new ClaudeCodeAdapter({ executablePath: process.env.CLAUDE_BIN ?? "claude", maxBudgetUsd: c.maxBudgetUsd, getApiKey: async () => readSealedApiKey("anthropic") });
      case "webhook":     return new WebhookAdapter({ dispatchUrl: process.env.WEBHOOK_DISPATCH_URL!, callbackBaseUrl: "http://127.0.0.1:4100", tasksRepo: /* injected */ null as any });
    }
  }
  ```
  `buildApp(app, deps)` mounts `/api/health`, `/api/tasks`, `/api/tasks/:id/answer`, `/api/tasks/:id/cancel`, `/api/settings`, `/api/device/register`, `/api/rollback`, `/api/restart-app`, `/api/versions`, `/api/adapter/config`, `/api/adapter/health`, `/api/webhook/callback`, and `/internal/api-keys`. MCP is mounted by `mountMcp(app, ctx)` from `@anyclaw/mcp-server` — Plan 3 does not implement it.
- [ ] **Step 4: Run and confirm pass.**
- [ ] **Step 5: Commit** — `plan3(task22): dispatch entry point mounts MCP + REST on shared Express app`.

---

## Done criteria

- All 22 tasks committed, each with its test(s) passing.
- `npm run -w @anyclaw/dispatch test` runs green end-to-end (unit + integration).
- `npm run -w @anyclaw/dispatch build` succeeds (TypeScript strict, no errors).
- The dispatch server boots, runs the startup sweep, exposes `/api/health`, and can be driven by a mock adapter through the full `queued → working → clarifying → working → deploying → done` cycle.
- Worktree isolation verified: a failed task never modifies `main` in the integration test's temp repo.
- Exactly-once verified: duplicate `POST /api/tasks` with the same UUID never creates a second row.
- Single-port verified: both `/mcp` (Plan 2) and `/api/*` (Plan 3) respond on the same `http.Server` instance returned by `buildServer` — the Plan 2 MCP router is mounted on the same Express app as the Plan 3 REST routers.
- `WorktreeManager` is imported from `@anyclaw/shared` — no duplicate implementation lives in `@anyclaw/dispatch`.
- The four REST endpoints Plan 5 depends on (`GET /api/health`, `GET/PATCH /api/settings`, `POST /api/device/register`) all respond successfully.
- The internal endpoint `POST /internal/api-keys` is reachable only from loopback and seals keys with the master key at `/data/.anyclaw/master.key` before writing them to `_api_keys`.
- Three additional internal collections are created by `ensureDispatchCollections`: `_task_clarifications`, `_devices`, `_deployments`.

## Hand-off to downstream plans

- **Plan 5 (Mobile App)** can call these REST endpoints on `http://127.0.0.1:4100` (over the Plan 4 tunnel): `POST /api/tasks`, `GET /api/tasks`, `GET /api/tasks/:id`, `GET /api/tasks/:id/activity`, `POST /api/tasks/:id/answer`, `POST /api/tasks/:id/cancel`, `GET /api/health`, `GET /api/settings`, `PATCH /api/settings`, `POST /api/device/register`, `GET /api/versions`, `POST /api/rollback`, `POST /api/restart-app`. It subscribes to `_tasks`, `_task_clarifications`, and `_deployments` via PocketBase realtime.
- **Plan 6 (Install / Skills Deployment)** calls `POST /internal/api-keys` from the install script while running on the same host, providing the LLM API key. The endpoint seals it with the master key and stores it in `_api_keys`.
- **Plan 2 (MCP Server)** is mounted on the shared Express app by this plan's Task 22. No changes to Plan 2 are required — Plan 3 just calls `mountMcp(app, ctx)`.
