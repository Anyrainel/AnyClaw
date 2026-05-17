# Plan 3: Agent Dispatch Layer -- Design Document

**Goal:** Define the pluggable adapter layer that lets the AnyRaven mobile app submit work requests to the user's coding agent, relay clarifying questions back to the user, and report progress/completion/failure. Initial adapters cover OpenClaw and Claude Code, with a generic webhook adapter for future agents (Codex, Aider, Gemini CLI).

**Depends on:** Plan 1 (Server Infrastructure) for PocketBase runtime and the supervised-process host layout.

---

## 1. Overview

The agent dispatch layer is the bridge between a mobile user typing "add a mood tracker" and a coding agent actually building it. It owns:

1. **Task lifecycle** -- input, clarification, work, deploy, done/failed -- including exactly-once submission semantics.
2. **Pluggable `AgentAdapter` interface** -- a uniform contract that each supported agent implements.
3. **Per-task git worktree** -- each task gets its own isolated workspace under `dev/.worktrees/`.
4. **Clarification relay** -- a universal `anyclaw_ask_user` MCP tool that works identically for every adapter.
5. **REST API** exposed to the mobile app over the WSS tunnel.
6. **Persistence and resume** so that a dispatch-server restart never loses an in-flight task.

Single active task + queue for MVP (locked decision #1). The design is isolation-first so future parallelization is a scheduler change, not an architectural rewrite.

---

## 2. Architecture

### 2.1 Where it runs

The dispatch layer runs **inside the Dispatch / MCP Server process** -- one of the supervised processes defined in the main spec's "Process Architecture" section. It is a long-lived Node.js process managed by systemd (primary) or supervisord (fallback) alongside PocketBase, the Tunnel Manager, the Logic Service, and the Prod Static Server.

The dispatch/MCP server is the "control plane": the small, stable process that always works even when the agent-written app backend is broken. Responsibilities:

1. Task dispatch REST API (`POST /api/tasks`, etc.).
2. MCP HTTP/SSE endpoint the agent calls back into.
3. Emergency endpoints (`POST /api/rollback`, `POST /api/restart-app`).
4. Owning the `AdapterManager`, which spawns and supervises the transient agent subprocess per task.

**Source file protection.** The dispatch/MCP server's source files live under `.anyclaw/` and are NOT inside the agent's writable path. The agent's `cwd` is a per-task worktree under `dev/.worktrees/`. It literally cannot edit the process that supervises it.

### 2.2 Communication path

```
Mobile App
    │ WSS (encrypted, NaCl over TLS)
    ▼
Tunnel Manager (supervised process)
    │ loopback HTTP/SSE
    ▼
Dispatch / MCP Server (supervised process)
    │
    ├── AdapterManager
    │     ├── OpenClawAdapter ──WS──> OpenClaw gateway (127.0.0.1:18789)
    │     ├── ClaudeCodeAdapter ──spawn──> `claude -p` (cwd=worktree)
    │     └── WebhookAdapter ──HTTP──> user-configured URL
    │
    ├── MCP HTTP/SSE endpoint (same process, loopback)
    │     the agent subprocess connects back here for anyclaw_* tools
    │
    └── PocketBase client ──loopback──> PocketBase (127.0.0.1:8090)
          persistence: tasks, clarifications, activity log, queue
```

All hops inside the host are loopback. Only the mobile hop traverses the WSS tunnel.

---

## 3. AgentAdapter Interface

### 3.1 Core types

```typescript
/** Opaque handle returned by dispatch(). Adapters define the adapterRef shape. */
type TaskHandle = {
  taskId: string;           // AnyRaven-assigned UUID (client-generated)
  adapterRef: string;       // Adapter-specific reference (session ID, run ID, PID)
};

type TaskState =
  | "queued"        // submitted, not yet started
  | "clarifying"    // agent asked a question; waiting for user
  | "working"       // agent is implementing
  | "deploying"     // validation + promotion to prod
  | "done"          // success
  | "failed"        // unrecoverable error
  | "cancelled";    // user cancelled

interface TaskStatus {
  state: TaskState;
  /** When state === "clarifying", the agent's current question. */
  question?: string;
  /** When state === "done", the version description the agent wrote. */
  versionDescription?: string;
  /** When state === "failed", a human-readable error. */
  error?: string;
  /** Short summary, e.g. "Running type checker...". */
  progressSummary?: string;
  /** Monotonically increasing. Lets the mobile app skip stale updates. */
  seq: number;
  /** ISO 8601 timestamp of this snapshot. */
  updatedAt: string;
}

interface ActivityEntry {
  timestamp: string;
  message: string;
  type: "info" | "tool_use" | "warning" | "error";
}

class AdapterError extends Error {
  constructor(
    message: string,
    public readonly code: AdapterErrorCode,
    public readonly retryable: boolean,
    public readonly cause?: unknown
  ) {
    super(message);
    this.name = "AdapterError";
  }
}

type AdapterErrorCode =
  | "AGENT_UNREACHABLE"
  | "AUTH_FAILED"
  | "TASK_NOT_FOUND"
  | "AGENT_BUSY"
  | "TIMEOUT"
  | "CANCELLED"
  | "INTERNAL";
```

### 3.2 Interface

```typescript
interface AgentAdapter {
  /** Human-readable adapter name ("OpenClaw", "Claude Code"). */
  readonly name: string;

  /** Quick reachability probe (< 5s). Used by the mobile app's status indicator. */
  healthCheck(): Promise<{ ok: boolean; detail?: string }>;

  /**
   * Submit a new task. The adapter translates the request into the agent's
   * native protocol and starts the agent session (typically by spawning a
   * subprocess into the per-task worktree).
   *
   * @param taskId       Client-generated UUID for this task.
   * @param request      The user's natural-language feature request.
   * @param systemContext  cwd (worktree), MCP endpoint, allowed tools, etc.
   * @param signal       AbortSignal for cancellation/timeout.
   * @throws AdapterError on connection/auth/spawn failures.
   */
  dispatch(
    taskId: string,
    request: string,
    systemContext: SystemContext,
    signal: AbortSignal
  ): Promise<TaskHandle>;

  /**
   * Subscribe to status changes. Yields at least one status on subscription
   * (the current state) and MUST yield the terminal status before completing.
   */
  subscribe(handle: TaskHandle, signal: AbortSignal): AsyncIterable<TaskStatus>;

  /** Send the user's answer. No-op for adapters where the answer flows via the
   *  anyclaw_ask_user MCP tool blocking inside the same process. */
  answerQuestion(handle: TaskHandle, answer: string): Promise<void>;

  /** Graceful stop (SIGTERM -> SIGKILL or abort RPC). Idempotent. */
  cancel(handle: TaskHandle): Promise<void>;

  /** Optional. Activity log since sequence N. */
  getActivityLog?(handle: TaskHandle, sinceSeq?: number): Promise<ActivityEntry[]>;

  /** Resume after dispatch-server restart (see Section 6). */
  resumeTask?(
    taskId: string,
    sessionId: string,
    systemContext: SystemContext,
    signal: AbortSignal
  ): Promise<TaskHandle>;

  /** Tear down connections and subprocess handles. Called on shutdown. */
  dispose(): Promise<void>;
}

interface SystemContext {
  /** Absolute path to the task's git worktree under dev/.worktrees/task-<id>/. */
  cwd: string;
  /** Loopback MCP HTTP/SSE URL, e.g. "http://127.0.0.1:4100/mcp". */
  mcpEndpointUrl: string;
  /** Per-task MCP bearer token. Written to the env and mcp-config. */
  mcpBearerToken: string;
  /** Per-task MCP config file path (for agents that take --mcp-config). */
  mcpConfigPath: string;
  /** System prompt additions that point the agent at the anyclaw_* tools. */
  systemPrompt: string;
  /** Tools the agent may call without interactive permission prompts. */
  allowedTools: string[];
  /** Opaque handle for the per-task cgroup / JobObject. No-op for MVP. */
  resourceLimitHandle?: string;
}
```

### 3.3 Timeout semantics

Timeouts are enforced by `AdapterManager`, not inside adapters. Adapters honor the `AbortSignal` passed to `dispatch()` and `subscribe()`; the manager wires up the deadline.

```typescript
interface DispatchConfig {
  /** Max wall-clock per task. Default 900_000 (15 min). */
  maxTaskDurationMs: number;
  /** Max time to wait for agent to become reachable. Default 10_000. */
  healthCheckTimeoutMs: number;
  /** User-configured clarification timeout mode. */
  clarificationTimeoutMode: "best_judgment" | "pause_indefinitely";
  /** Default 300_000 (5 min); ignored in pause_indefinitely mode. */
  clarificationTimeoutMs: number;
}
```

---

## 4. Task Lifecycle

### 4.1 State machine

```
          ┌──────────┐
submit -->│  queued  │
          └────┬─────┘
               │ scheduler picks task, adapter.dispatch()
               ▼
          ┌──────────┐      agent calls anyclaw_ask_user
          │ working  │◄────────────┐
          └────┬─────┘             │
               │                   │
     agent asks│question       user│answers
               ▼                   │
          ┌────────────┐           │
          │ clarifying │───────────┘
          └────┬───────┘
               │ agent calls anyclaw_deploy
               ▼
          ┌───────────┐
          │ deploying │
          └────┬──────┘
               │
        ┌──────┴──────┐
        ▼             ▼
   ┌────────┐    ┌────────┐
   │  done  │    │ failed │
   └────────┘    └────────┘

   cancel() from any non-terminal state → cancelled
```

Terminal states: `done`, `failed`, `cancelled`. Once a task reaches a terminal state, its row in `tasks` is immutable.

### 4.2 Exact transitions

| From | Event | To | Side effect |
|------|-------|----|----|
| (none) | `POST /api/tasks` with new UUID | `queued` | Row inserted in `tasks`, push to `task_queue`. |
| (none) | `POST /api/tasks` with existing UUID | (no-op) | Idempotent upsert returns current status. |
| `queued` | Scheduler picks task | `working` | Create worktree, spawn adapter. |
| `working` | `anyclaw_ask_user` tool called | `clarifying` | Write to `task_clarifications`, push notification. |
| `clarifying` | Answer written via REST | `working` | Tool resolves, agent continues. |
| `working` | `anyclaw_deploy` tool called | `deploying` | Progress event. |
| `deploying` | Validation pass + git merge + prod copy | `done` | Merge worktree branch to `main`, delete worktree. |
| `deploying` | Validation fail | `failed` | Delete worktree, leave `main` untouched. |
| any non-terminal | `POST /api/tasks/:id/cancel` | `cancelled` | SIGTERM agent, delete worktree. |
| any non-terminal | Wall-clock > `maxTaskDurationMs` | `failed` | SIGKILL agent, delete worktree, error = "task_timeout". |
| `working`/`deploying` | Dispatch server restart, no running subprocess | `failed` | Error = "server_restart". See 4.4. |
| `clarifying` | Dispatch server restart | `clarifying` | Preserved; resumed from persisted question. |

### 4.3 Exactly-once delivery (locked decision #40)

1. **Client generates the task UUID** in the mobile app. This is the idempotency key.
2. `POST /api/tasks { taskId, request }` is an **idempotent upsert** against `tasks.taskId` (unique index). A retried submission returns the existing row unchanged.
3. On dispatch-server startup, any task row in state `working` or `deploying` **without a currently running subprocess** is atomically moved to `failed` with `error = "server_restart"`. The mobile app sees the terminal state and can resubmit under a new UUID.
4. Tasks in `queued` or `clarifying` are not touched by the startup sweep (they have no subprocess; they are resumed normally).

The user can always retry a failed task by re-submitting with a new UUID. No instruction is lost; no instruction is duplicated.

### 4.4 Server restart sweep

```typescript
async function sweepOnStartup(pb: PocketBase): Promise<void> {
  // Move in-flight tasks to failed. They had subprocesses; those subprocesses
  // died when we did.
  await pb.collection("tasks").update(
    'state = "working" || state = "deploying"',
    { state: "failed", error: "server_restart" }
  );
}
```

Tasks in `clarifying` are handled by the resume logic in Section 6.

---

## 5. Worktree-Per-Task (Locked Decision #36)

Each task runs in its own git worktree. This gives full isolation from day one and makes future parallelization a scheduler change.

### 5.1 Layout

```
dev/                              # main git repo (branch: main)
├── src/ ...                      # canonical working tree
└── .worktrees/
    ├── task-a7f3e8c1/            # worktree for task a7f3e8c1 (branch: task/a7f3e8c1)
    │   └── src/ ...
    └── task-d2b9f0a5/             # worktree for task d2b9f0a5 (branch: task/d2b9f0a5)
        └── src/ ...
```

For MVP there is at most one worktree active at a time (single-task queue). The directory structure is already prepared for concurrent tasks.

### 5.2 Create / merge / cleanup

```typescript
class WorktreeManager {
  constructor(private devRoot: string) {}

  async create(taskId: string): Promise<string> {
    const branch = `task/${taskId}`;
    const path = join(this.devRoot, ".worktrees", `task-${taskId}`);
    await exec(`git -C "${this.devRoot}" worktree add -b ${branch} "${path}" main`);
    return path;
  }

  /** On successful deploy: fast-forward or merge the worktree branch into main, then remove it. */
  async mergeAndRemove(taskId: string): Promise<void> {
    const branch = `task/${taskId}`;
    const path = join(this.devRoot, ".worktrees", `task-${taskId}`);

    // The agent has already committed in the worktree (either directly or via anyclaw_deploy).
    await exec(`git -C "${this.devRoot}" merge --ff-only ${branch}`);
    await exec(`git -C "${this.devRoot}" worktree remove "${path}"`);
    await exec(`git -C "${this.devRoot}" branch -d ${branch}`);
  }

  /** On failure/cancel: drop the worktree and delete the branch. main stays untouched. */
  async discard(taskId: string): Promise<void> {
    const branch = `task/${taskId}`;
    const path = join(this.devRoot, ".worktrees", `task-${taskId}`);
    await exec(`git -C "${this.devRoot}" worktree remove --force "${path}"`).catch(() => {});
    await exec(`git -C "${this.devRoot}" branch -D ${branch}`).catch(() => {});
  }
}
```

### 5.3 Merge flow on successful deploy

Triggered inside the `anyclaw_deploy` MCP tool handler (part of Plan 2):

1. Run validation in the worktree (lint, typecheck, build, smoke tests).
2. Snapshot the DB (`anyclaw_snapshot_db`).
3. Commit staged changes in the worktree (`git commit` on `task/<id>`).
4. `WorktreeManager.mergeAndRemove(taskId)` -- fast-forward `main`.
5. Copy built artifacts to the prod static directory.
6. `systemctl --user restart anyclaw-logic` (decision #28).
7. Emit terminal `done` status with the version description.

If any step fails, the deploy tool throws; the adapter marks the task `failed` and the manager calls `WorktreeManager.discard(taskId)`. `main` and prod are never touched.

### 5.4 Merge conflicts

Impossible under MVP (sequential). When parallelism ships, a dedicated "merge agent" handles conflicts (decision #37). Not part of this plan.

---

## 6. Resource Limits (Locked Decision #26)

Resource limits are **deferred** for MVP. The interface is in place so limits can be added without changing adapters. The MVP implementation is a no-op.

```typescript
interface ResourceLimits {
  /** Called before the child is spawned. Returns an opaque handle placed in
   *  SystemContext.resourceLimitHandle, or null if limits are disabled. */
  prepare(taskId: string, config: ResourceLimitConfig): Promise<string | null>;

  /** Called immediately after spawn to place the PID into the group. No-op if
   *  prepare returned null. */
  apply(pid: number, handle: string): Promise<void>;

  /** Called when the task completes. Cleans up the cgroup / Job Object. */
  release(handle: string): Promise<void>;
}

interface ResourceLimitConfig {
  cpuQuotaPercent: number;    // e.g. 200 = 2 cores
  memoryMaxMb: number;
  pidsMax?: number;
}

/** MVP implementation: no-op. */
class NoopResourceLimits implements ResourceLimits {
  async prepare() { return null; }
  async apply() {}
  async release() {}
}
```

Post-MVP, real implementations will target:
- Linux: `systemd-run --user --scope -p CPUQuota=... -p MemoryMax=...` (decision #25 chose systemd user mode).
- Windows: Job Objects via native addon.
- macOS: `setrlimit` preload + wall-clock cap.

The adapters and manager already pass the handle through; enabling limits later is a config flip.

---

## 7. OpenClaw Adapter

### 7.1 Connection

Connects to a locally-running OpenClaw gateway at `ws://127.0.0.1:18789` over loopback. Two modes are the same code path: the user's existing install or an AnyRaven-bundled supervised process. Protocol version 3.

**Handshake:**

```
Gateway --> Client:  { type: "event", event: "connect.challenge", payload: { nonce, ts } }
Client  --> Gateway: { type: "req", id: "1", method: "connect", params: {
                         minProtocol: 3, maxProtocol: 3,
                         client: { name: "anyclaw-adapter", version: "1.0.0" },
                         role: "operator",
                         scopes: ["operator.read", "operator.write"],
                         auth: { token: OPENCLAW_GATEWAY_TOKEN }
                       }}
Gateway --> Client:  { type: "res", id: "1", ok: true, payload: { ...hello... } }
```

The token is stored AES-256-GCM-encrypted in PocketBase (`settings.openclawConfig.gatewayToken`) and decrypted at adapter construction time.

### 7.2 Implementation

```typescript
import WebSocket from "ws";

class OpenClawAdapter implements AgentAdapter {
  readonly name = "OpenClaw";
  private ws: WebSocket | null = null;
  private reqId = 0;
  private pendingRpcs = new Map<string, { resolve: (p: any) => void; reject: (e: Error) => void }>();
  private eventListeners = new Map<string, Set<(payload: any) => void>>();

  constructor(private config: {
    gatewayUrl: string;   // "ws://127.0.0.1:18789"
    token: string;        // decrypted from PocketBase
    workspace: string;    // OpenClaw workspace for AnyRaven tasks
  }) {}

  async healthCheck(): Promise<{ ok: boolean; detail?: string }> {
    try { await this.ensureConnected(); return { ok: true }; }
    catch (err) { return { ok: false, detail: String(err) }; }
  }

  async dispatch(taskId: string, request: string, ctx: SystemContext, signal: AbortSignal): Promise<TaskHandle> {
    await this.ensureConnected();
    const res = await this.rpc("chat.send", {
      workspace: this.config.workspace,
      message: { role: "user", content: request },
      idempotencyKey: taskId,
      metadata: {
        anyClawTaskId: taskId,
        mcpEndpointUrl: ctx.mcpEndpointUrl,
        cwd: ctx.cwd,
      }
    }, signal);
    return { taskId, adapterRef: res.runId };
  }

  async *subscribe(handle: TaskHandle, signal: AbortSignal): AsyncIterable<TaskStatus> {
    await this.ensureConnected();
    let seq = 0;
    await this.rpc("sessions.subscribe", { runId: handle.adapterRef }, signal);

    const queue = new AsyncQueue<TaskStatus>();
    const onEvent = (payload: any) => {
      const status = this.mapEventToStatus(payload, ++seq);
      if (status) queue.push(status);
      if (status && isTerminal(status.state)) queue.close();
    };
    this.addEventListener("session.message", onEvent);
    this.addEventListener("session.tool", onEvent);

    signal.addEventListener("abort", () => {
      queue.push({ state: "cancelled", seq: ++seq, updatedAt: new Date().toISOString() });
      queue.close();
    });

    try {
      for await (const status of queue) yield status;
    } finally {
      this.removeEventListener("session.message", onEvent);
      this.removeEventListener("session.tool", onEvent);
    }
  }

  /** No-op: the answer is picked up by anyclaw_ask_user blocking inside the
   *  dispatch server process via PocketBase realtime. */
  async answerQuestion(): Promise<void> {}

  async cancel(handle: TaskHandle): Promise<void> {
    await this.rpc("sessions.abort", { runId: handle.adapterRef }, AbortSignal.timeout(10_000));
  }

  async dispose(): Promise<void> { this.ws?.close(); this.ws = null; }

  // --- internals ---

  private async ensureConnected(): Promise<void> {
    if (this.ws?.readyState === WebSocket.OPEN) return;
    this.ws = new WebSocket(this.config.gatewayUrl);
    await new Promise<void>((resolve, reject) => {
      this.ws!.once("open", resolve);
      this.ws!.once("error", reject);
    });
    await this.performHandshake();
    this.ws.on("message", (data) => {
      const frame = JSON.parse(data.toString());
      if (frame.type === "res" && this.pendingRpcs.has(frame.id)) {
        const rpc = this.pendingRpcs.get(frame.id)!;
        this.pendingRpcs.delete(frame.id);
        frame.ok ? rpc.resolve(frame.payload)
                 : rpc.reject(new AdapterError(frame.error?.message ?? "RPC failed", "INTERNAL", false));
      } else if (frame.type === "event") {
        this.eventListeners.get(frame.event)?.forEach(fn => fn(frame.payload));
      }
    });
  }

  private rpc(method: string, params: any, signal: AbortSignal): Promise<any> {
    const id = String(++this.reqId);
    return new Promise((resolve, reject) => {
      this.pendingRpcs.set(id, { resolve, reject });
      signal.addEventListener("abort", () => {
        this.pendingRpcs.delete(id);
        reject(new AdapterError("Aborted", "CANCELLED", false));
      });
      this.ws!.send(JSON.stringify({ type: "req", id, method, params }));
    });
  }

  private mapEventToStatus(payload: any, seq: number): TaskStatus | null {
    const now = new Date().toISOString();
    if (payload.type === "tool_call" && payload.tool === "anyclaw_ask_user") {
      return { state: "clarifying", question: payload.args?.question, seq, updatedAt: now };
    }
    if (payload.type === "tool_call" && payload.tool === "anyclaw_deploy") {
      return { state: "deploying", progressSummary: "Running validation and deploying...", seq, updatedAt: now };
    }
    if (payload.type === "tool_call" && payload.tool === "anyclaw_update_progress") {
      return { state: "working", progressSummary: payload.args?.message, seq, updatedAt: now };
    }
    if (payload.type === "run_complete") {
      return payload.status === "success"
        ? { state: "done", versionDescription: payload.summary, seq, updatedAt: now }
        : { state: "failed", error: payload.error, seq, updatedAt: now };
    }
    return null;
  }

  private addEventListener(event: string, fn: (p: any) => void) {
    if (!this.eventListeners.has(event)) this.eventListeners.set(event, new Set());
    this.eventListeners.get(event)!.add(fn);
  }
  private removeEventListener(event: string, fn: (p: any) => void) {
    this.eventListeners.get(event)?.delete(fn);
  }

  private async performHandshake(): Promise<void> {
    const challenge = await new Promise<any>((resolve) => this.addEventListener("connect.challenge", resolve));
    await this.rpc("connect", {
      minProtocol: 3, maxProtocol: 3,
      client: { name: "anyclaw-adapter", version: "1.0.0" },
      role: "operator",
      scopes: ["operator.read", "operator.write"],
      auth: { token: this.config.token },
    }, AbortSignal.timeout(5_000));
  }
}
```

Clarification works identically to Claude Code: the agent calls `anyclaw_ask_user` and the tool blocks inside the dispatch server waiting on PocketBase realtime. The OpenClaw adapter only needs to **surface** the tool call as a status update (so the mobile app shows the question); it doesn't handle the answer itself.

---

## 8. Claude Code Adapter (Locked Decision #3)

### 8.1 Execution model

The adapter spawns `claude -p <request>` as a transient child of the dispatch/MCP server using `child_process.spawn`. The process runs to completion and exits; there is no long-lived daemon.

- `cwd = systemContext.cwd` (the per-task worktree).
- Claude Code's native `Read`, `Write`, `Edit`, `Bash` tools operate directly on the worktree.
- `--mcp-config` points at a per-task JSON file that includes the loopback MCP URL and a per-task bearer token.
- `--allowedTools` is scoped to the tools the adapter wants to permit without prompts.
- `ANTHROPIC_API_KEY` is decrypted from PocketBase (`settings.claudeCodeConfig.apiKey`) and injected into `env`. Not in the environment of the dispatch server itself.
- After spawn, the PID is placed into the per-task resource-limit handle (no-op for MVP).

### 8.2 Implementation

```typescript
import { spawn, ChildProcess } from "child_process";
import { writeFile } from "fs/promises";

class ClaudeCodeAdapter implements AgentAdapter {
  readonly name = "Claude Code";
  private active = new Map<string, {
    proc: ChildProcess;
    status: TaskStatus;
    sessionId?: string;   // Claude Code session ID (for --resume)
  }>();

  constructor(private config: {
    executablePath: string;          // default "claude"
    model?: string;
    maxBudgetUsd: number;            // default 5.00
    applyResourceLimits: (pid: number, handle: string) => Promise<void>;
    getApiKey: () => Promise<string>;
  }) {}

  async healthCheck(): Promise<{ ok: boolean; detail?: string }> {
    try {
      const proc = spawn(this.config.executablePath,
        ["-p", "Reply with OK", "--max-turns", "1", "--output-format", "json"],
        { timeout: 10_000 });
      const out = await collectStdout(proc);
      return { ok: out.includes("OK") };
    } catch (err) { return { ok: false, detail: String(err) }; }
  }

  async dispatch(taskId: string, request: string, ctx: SystemContext, signal: AbortSignal): Promise<TaskHandle> {
    // Write per-task MCP config
    await writeFile(ctx.mcpConfigPath, JSON.stringify({
      mcpServers: {
        anyclaw: {
          type: "http",
          url: ctx.mcpEndpointUrl,
          headers: {
            "x-anyclaw-task-id": taskId,
            "authorization": `Bearer ${ctx.mcpBearerToken}`,
          },
        },
      },
    }));

    const args = [
      "-p", request,
      "--output-format", "stream-json",
      "--mcp-config", ctx.mcpConfigPath,
      "--allowedTools", ctx.allowedTools.join(","),
      "--max-budget", String(this.config.maxBudgetUsd),
    ];
    if (this.config.model) args.push("--model", this.config.model);

    const proc = spawn(this.config.executablePath, args, {
      cwd: ctx.cwd,
      env: {
        ...process.env,
        ANTHROPIC_API_KEY: await this.config.getApiKey(),
        ANYCLAW_TASK_ID: taskId,
        ANYCLAW_MCP_URL: ctx.mcpEndpointUrl,
        ANYCLAW_MCP_TOKEN: ctx.mcpBearerToken,
      },
      signal,
    });

    if (ctx.resourceLimitHandle && proc.pid) {
      await this.config.applyResourceLimits(proc.pid, ctx.resourceLimitHandle);
    }

    const session = {
      proc,
      status: { state: "working" as TaskState, seq: 0, updatedAt: new Date().toISOString() } as TaskStatus,
      sessionId: undefined as string | undefined,
    };
    this.active.set(taskId, session);
    this.consumeOutput(taskId);
    return { taskId, adapterRef: taskId };
  }

  async *subscribe(handle: TaskHandle, signal: AbortSignal): AsyncIterable<TaskStatus> {
    const session = this.active.get(handle.taskId);
    if (!session) throw new AdapterError("Task not found", "TASK_NOT_FOUND", false);

    const queue = new AsyncQueue<TaskStatus>();
    queue.push(session.status);

    const watcher = setInterval(() => {
      const s = this.active.get(handle.taskId);
      if (s && s.status.seq > (queue.lastSeq ?? -1)) {
        queue.push(s.status);
        if (isTerminal(s.status.state)) { queue.close(); clearInterval(watcher); }
      }
    }, 500);

    signal.addEventListener("abort", () => { clearInterval(watcher); queue.close(); });

    for await (const status of queue) yield status;
  }

  async answerQuestion(): Promise<void> {
    // No-op. anyclaw_ask_user picks up answers via PocketBase realtime in-process.
  }

  async cancel(handle: TaskHandle): Promise<void> {
    const s = this.active.get(handle.taskId);
    if (!s || s.proc.killed) return;
    s.proc.kill("SIGTERM");
    setTimeout(() => { if (!s.proc.killed) s.proc.kill("SIGKILL"); }, 5000);
  }

  async resumeTask(taskId: string, sessionId: string, ctx: SystemContext, signal: AbortSignal): Promise<TaskHandle> {
    const args = [
      "-p", "--resume", sessionId,
      "--output-format", "stream-json",
      "--mcp-config", ctx.mcpConfigPath,
      "--allowedTools", ctx.allowedTools.join(","),
    ];
    const proc = spawn(this.config.executablePath, args, {
      cwd: ctx.cwd,
      env: {
        ...process.env,
        ANTHROPIC_API_KEY: await this.config.getApiKey(),
        ANYCLAW_TASK_ID: taskId,
        ANYCLAW_MCP_URL: ctx.mcpEndpointUrl,
        ANYCLAW_MCP_TOKEN: ctx.mcpBearerToken,
      },
      signal,
    });
    if (ctx.resourceLimitHandle && proc.pid) {
      await this.config.applyResourceLimits(proc.pid, ctx.resourceLimitHandle);
    }
    this.active.set(taskId, {
      proc,
      status: { state: "working", progressSummary: "Resuming after restart...", seq: 0, updatedAt: new Date().toISOString() },
      sessionId,
    });
    this.consumeOutput(taskId);
    return { taskId, adapterRef: taskId };
  }

  async dispose(): Promise<void> {
    for (const [, s] of this.active) if (!s.proc.killed) s.proc.kill("SIGTERM");
    this.active.clear();
  }

  // --- internal ---

  private async consumeOutput(taskId: string): Promise<void> {
    const session = this.active.get(taskId);
    if (!session) return;
    const rl = createReadlineInterface(session.proc.stdout!);
    try {
      for await (const line of rl) {
        const event = JSON.parse(line);
        this.updateStatusFromEvent(taskId, event);
        if (event.type === "system" && event.session_id) {
          session.sessionId = event.session_id;
          await persistSessionId(taskId, event.session_id);
        }
      }
      const exitCode = await waitForExit(session.proc);
      if (!isTerminal(session.status.state)) {
        session.status = exitCode === 0
          ? { state: "done", seq: ++session.status.seq, updatedAt: new Date().toISOString() }
          : { state: "failed", error: `claude exited with code ${exitCode}`, seq: ++session.status.seq, updatedAt: new Date().toISOString() };
      }
    } catch (err) {
      session.status = { state: "failed", error: String(err), seq: ++session.status.seq, updatedAt: new Date().toISOString() };
    } finally {
      await persistTaskStatus(taskId, session.status);
      setTimeout(() => this.active.delete(taskId), 5 * 60 * 1000);
    }
  }

  private updateStatusFromEvent(taskId: string, event: any): void {
    const session = this.active.get(taskId);
    if (!session) return;
    const now = new Date().toISOString();
    const seq = ++session.status.seq;

    if (event.type === "assistant" && event.message?.content) {
      for (const block of event.message.content) {
        if (block.type !== "tool_use") continue;
        if (block.name === "anyclaw_ask_user") {
          session.status = { state: "clarifying", question: block.input?.question, seq, updatedAt: now };
          return;
        }
        if (block.name === "anyclaw_deploy") {
          session.status = { state: "deploying", progressSummary: "Running validation and deploying...", seq, updatedAt: now };
          return;
        }
        if (block.name === "anyclaw_update_progress") {
          session.status = { state: "working", progressSummary: block.input?.message, seq, updatedAt: now };
          return;
        }
      }
    }
    if (event.type === "result") {
      session.status = { state: "done", versionDescription: event.result, seq, updatedAt: now };
    }
  }
}
```

### 8.3 Per-task session persistence

Claude Code writes its session directory under `~/.claude/` on the host. That directory is outside the dispatch server and untouched by its restart. As soon as `stream-json` reports the `session_id`, the adapter persists it to `tasks.sessionId`. On restart, the AdapterManager calls `resumeTask(sessionId)` which re-spawns with `--resume <sessionId>` and the agent continues.

---

## 9. Generic Webhook Adapter

For agents without a subprocess interface or native SDK (custom harnesses, remote hosted agents). The contract:

**Dispatch request (server → agent):**

```typescript
POST {dispatchUrl}
{
  taskId: string,
  request: string,
  callbackUrl: string,           // where the agent POSTs events
  mcpEndpointUrl: string,        // loopback-only; the agent must be on-host to use MCP
  mcpBearerToken: string,
  cwd: string,                   // per-task worktree path
}
```

**Callback events (agent → server):**

```typescript
POST {callbackUrl}
{
  taskId: string,
  event: "progress" | "clarifying" | "deploying" | "done" | "failed",
  progressSummary?: string,
  question?: string,
  versionDescription?: string,
  error?: string,
}
```

**Cancel:**

```typescript
DELETE {dispatchUrl}
{ taskId: string }
```

**Implementation skeleton:**

```typescript
class WebhookAdapter implements AgentAdapter {
  readonly name = "Webhook";

  constructor(private config: {
    dispatchUrl: string;
    callbackBaseUrl: string;
    authHeader?: string;
  }) {}

  async dispatch(taskId: string, request: string, ctx: SystemContext, signal: AbortSignal): Promise<TaskHandle> {
    const res = await fetch(this.config.dispatchUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(this.config.authHeader ? { Authorization: this.config.authHeader } : {}),
      },
      body: JSON.stringify({
        taskId,
        request,
        callbackUrl: `${this.config.callbackBaseUrl}/api/webhook/callback`,
        mcpEndpointUrl: ctx.mcpEndpointUrl,
        mcpBearerToken: ctx.mcpBearerToken,
        cwd: ctx.cwd,
      }),
      signal,
    });
    if (!res.ok) {
      throw new AdapterError(
        `Webhook dispatch failed: ${res.status}`,
        res.status === 401 ? "AUTH_FAILED" : "INTERNAL",
        res.status >= 500
      );
    }
    const body = await res.json();
    return { taskId, adapterRef: body.externalId ?? taskId };
  }

  async *subscribe(handle: TaskHandle, signal: AbortSignal): AsyncIterable<TaskStatus> {
    // Implemented against a PocketBase realtime subscription on the
    // tasks collection; the webhook callback handler writes rows that this
    // subscription sees.
    yield* subscribeToPocketBaseTaskStatus(handle.taskId, signal);
  }

  async answerQuestion(): Promise<void> {
    // Answer is written by the REST handler; the remote agent reads it via
    // anyclaw_ask_user or its own polling of the callback contract.
  }

  async cancel(handle: TaskHandle): Promise<void> {
    await fetch(this.config.dispatchUrl, {
      method: "DELETE",
      headers: {
        "Content-Type": "application/json",
        ...(this.config.authHeader ? { Authorization: this.config.authHeader } : {}),
      },
      body: JSON.stringify({ taskId: handle.taskId }),
    }).catch(() => {});
  }

  async dispose(): Promise<void> {}
  async healthCheck(): Promise<{ ok: boolean }> { return { ok: true }; }
}
```

The webhook callback endpoint (`POST /api/webhook/callback`) is a REST handler in the dispatch server that validates the `taskId`, maps the event to a `TaskStatus`, and writes to the `tasks` collection. PocketBase realtime fans out to the mobile app.

---

## 10. Clarification Relay

### 10.1 The universal mechanism: `anyclaw_ask_user`

Regardless of adapter, clarification flows through the `anyclaw_ask_user` MCP tool. The tool is registered on the dispatch/MCP server's MCP endpoint -- the same process as the adapter.

```typescript
const askUserTool = tool(
  "anyclaw_ask_user",
  "Ask the user a clarifying question and wait for their answer",
  {
    question: z.string().describe("The question to ask the user"),
    taskId: z.string().optional(),
  },
  async ({ question, taskId: explicit }, ctx) => {
    const taskId = explicit
      ?? ctx.request.headers["x-anyclaw-task-id"]
      ?? process.env.ANYCLAW_TASK_ID;
    if (!taskId) throw new Error("No task ID available");

    const pb = getPocketBase();
    const record = await pb.collection("task_clarifications").create({
      taskId, question, status: "pending", answer: null,
    });

    const settings = await pb.collection("settings").getFirstListItem("");
    const mode: "best_judgment" | "pause_indefinitely"
      = settings.dispatch?.clarificationTimeoutMode ?? "best_judgment";
    const timeoutMs: number = settings.dispatch?.clarificationTimeoutMs ?? 300_000;

    const answer = await waitForAnswer(pb, record.id, timeoutMs, mode);
    return { content: [{ type: "text", text: answer }] };
  }
);

async function waitForAnswer(
  pb: PocketBase,
  clarificationId: string,
  timeoutMs: number,
  mode: "best_judgment" | "pause_indefinitely"
): Promise<string> {
  return new Promise((resolve, reject) => {
    const timer = mode === "pause_indefinitely"
      ? null
      : setTimeout(() => {
          unsubscribe();
          resolve("The user is unavailable. Use your best judgment and proceed.");
        }, timeoutMs);

    const unsubscribe = pb.collection("task_clarifications")
      .subscribe(clarificationId, (event) => {
        if (event.action === "update" && event.record.status === "answered") {
          if (timer) clearTimeout(timer);
          unsubscribe();
          resolve(event.record.answer);
        }
      });
  });
}
```

### 10.2 End-to-end path

```
Agent child process
    │ calls anyclaw_ask_user(...)
    │ HTTP/SSE loopback
    ▼
Dispatch/MCP server (anyclaw_ask_user handler)
    │ insert task_clarifications row {status: pending}
    ▼
PocketBase (loopback)
    │ realtime event
    ▼
Adapter sees tool_call "anyclaw_ask_user", yields TaskStatus {state: clarifying, question}
    │ PocketBase realtime on tasks collection
    ▼
Tunnel Manager ─── WSS ───> Mobile app shows question
                                │
                                │ user answers
                                ▼
Mobile app ─── WSS ───> POST /api/tasks/:id/answer
    │
    ▼
Dispatch REST handler updates task_clarifications {status: answered, answer}
    │ PocketBase realtime
    ▼
anyclaw_ask_user resolves with answer text, MCP tool returns to agent
    │
    ▼
Agent continues
```

All hops inside the host are loopback. Only the user-facing hop traverses the tunnel.

### 10.3 Clarification timeout (Locked Decision #2)

User-configurable in `settings.dispatch`:

- `clarificationTimeoutMode: "best_judgment"` (default) -- after `clarificationTimeoutMs` (default 300_000 / 5 min), the tool resolves with a canned `"The user is unavailable. Use your best judgment and proceed."` string. The agent then continues.
- `clarificationTimeoutMode: "pause_indefinitely"` -- no timer is set. The tool waits forever. This is the "I want to review every question" mode.

The mode is honored on resume as well: if the dispatch server restarts while an `anyclaw_ask_user` call is blocked, the fresh handler re-subscribes with the same mode.

### 10.4 Push notifications

When a task enters `clarifying`, the dispatch server sends a push notification:

```typescript
if (newStatus.state === "clarifying" && newStatus.question) {
  await pushNotifier.send("Agent has a question", newStatus.question);
}
```

---

## 11. Task Persistence & Resume

### 11.1 PocketBase collections

```typescript
// tasks
{
  id: string;                 // PB auto id
  taskId: string;             // client UUID, unique index
  request: string;
  state: TaskState;
  adapterType: "openclaw" | "claude-code" | "webhook";
  adapterRef: string;
  progressSummary?: string;
  versionDescription?: string;
  error?: string;
  seq: number;

  // resume state
  sessionId?: string;         // agent session ID (Claude Code, OpenClaw run, etc.)
  systemContext: string;      // JSON-serialized SystemContext at dispatch time
  worktreePath: string;       // absolute path to dev/.worktrees/task-<id>
  lastCompletedStep?: string; // decision #38: agent-agnostic step tracker
  filesModified?: string;     // JSON array
  agentCheckpoint?: string;   // optional adapter-specific blob

  createdAt: string;
  updatedAt: string;
}

// task_clarifications
{
  id: string;
  taskId: string;
  question: string;
  answer?: string;
  status: "pending" | "answered";
  createdAt: string;
  updatedAt: string;
}

// task_activity_log
{
  id: string;
  taskId: string;
  message: string;
  type: "info" | "tool_use" | "warning" | "error";
  seq: number;
  createdAt: string;
}

// task_queue -- single active task + queue
{
  id: string;
  taskId: string;
  priority: number;
  position: number;
  createdAt: string;
}
```

### 11.2 What gets persisted

1. **Task request** -- the original natural-language instruction.
2. **System context** -- cwd (worktree path), MCP endpoint URL, allowed tools. Serialized as JSON.
3. **Session ID** -- agent-specific resume identifier, written as soon as the adapter learns it.
4. **Conversation history** -- completed Q&A pairs are in `task_clarifications`.
5. **Worktree path** -- so `WorktreeManager` can clean up on failure during startup sweep.

### 11.3 Resume protocol on startup

```typescript
class AdapterManager {
  async onStartup(): Promise<void> {
    const pb = getPocketBase();

    // First: exactly-once sweep. working/deploying tasks had subprocesses that
    // died with us. Move them to failed; user can retry with a new UUID.
    await pb.collection("tasks").update(
      'state = "working" || state = "deploying"',
      { state: "failed", error: "server_restart" }
    );

    // Clean up any orphaned worktrees for sweeped tasks.
    const sweeped = await pb.collection("tasks").getFullList({
      filter: 'state = "failed" && error = "server_restart"',
    });
    for (const t of sweeped) await this.worktrees.discard(t.taskId);

    // Resume clarifying tasks: the agent subprocess is gone, but the question
    // is still valid. On answer, the agent is re-dispatched with Q&A history
    // prepended (or --resume for Claude Code).
    const clarifying = await pb.collection("tasks").getFullList({ filter: 'state = "clarifying"' });
    for (const task of clarifying) {
      const pending = await pb.collection("task_clarifications").getFullList({
        filter: `taskId = "${task.taskId}" && status = "pending"`,
      });
      if (pending.length === 0) {
        // Answer landed during downtime. Resume immediately.
        await this.resumeTask(task);
      }
      // else: still waiting on the user. Mobile will see it on reconnect.
    }

    this.processQueue();
  }

  private async resumeTask(task: TaskRecord): Promise<void> {
    const ctx: SystemContext = JSON.parse(task.systemContext);
    if (!this.adapter.resumeTask) {
      await this.markFailed(task, "Adapter does not support resume");
      return;
    }
    try {
      await this.adapter.resumeTask(task.taskId, task.sessionId!, ctx, this.createSignal(task.taskId));
    } catch (err) {
      await this.markFailed(task, `Failed to resume after restart: ${err}`);
    }
  }
}
```

### 11.4 Resume per adapter

| Adapter | Resume mechanism | Agent experience |
|---------|------------------|------------------|
| **Claude Code** | Spawn `claude -p --resume <sessionId>` in the same worktree. `~/.claude/` persists across dispatch restarts. | Continues from last turn. If mid-tool-call, the result is lost; the agent re-tries. |
| **OpenClaw** | Re-open the gateway WebSocket; re-subscribe to the existing `runId`. (OpenClaw gateway session persistence is deferred to post-MVP per decision #41; for now, best-effort reconnect.) | Reconnect if the gateway still has the run; otherwise marked failed. |
| **Webhook** | `POST {dispatchUrl} { taskId, action: "resume" }`. External agent handles its own state. | Contract-defined. |

### 11.5 "Pause indefinitely" across restart

The scenario: user set `clarificationTimeoutMode = "pause_indefinitely"`, the agent asks a question, the user is AFK, the dispatch server is restarted by supervisord.

- The `tasks` row is `clarifying`.
- The `task_clarifications` row is `pending`.
- The startup sweep does **not** touch `clarifying` tasks.
- When the user eventually answers via `POST /api/tasks/:id/answer`, the handler writes the answer to `task_clarifications`.
- An immediate follow-up step in the handler checks if the task's agent subprocess is alive. If not, it calls `resumeTask(task)` which re-spawns the agent with `--resume`. The freshly-spawned `anyclaw_ask_user` handler on that task sees the `answered` row immediately and resolves with the answer.

No question is ever duplicated. No instruction is lost.

---

## 12. REST API

All endpoints are served by the dispatch/MCP server over loopback, forwarded by the Tunnel Manager to the mobile app over WSS. Authentication: PocketBase auth token in `Authorization: Bearer <token>`.

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/api/tasks` | Submit a new task. Body: `{ taskId, request }`. Idempotent upsert on `taskId`. Returns current `TaskStatus`. |
| `GET` | `/api/tasks/:taskId` | Get current status. |
| `POST` | `/api/tasks/:taskId/answer` | Answer a pending clarification. Body: `{ answer }`. |
| `POST` | `/api/tasks/:taskId/cancel` | Request cancellation. Idempotent. |
| `GET` | `/api/tasks/:taskId/activity` | Activity log. Query: `?sinceSeq=N`. |
| `GET` | `/api/tasks` | List recent tasks (paginated). |
| `GET` | `/api/adapter/health` | Adapter reachability probe. |
| `GET` | `/api/adapter/config` | Current adapter type + non-secret config. |
| `PUT` | `/api/adapter/config` | Switch adapter or update config. Body: `{ activeAdapter, ... }`. |
| `POST` | `/api/rollback` | Emergency rollback. Always works. |
| `POST` | `/api/restart-app` | Restart app backend via `systemctl --user restart anyclaw-logic`. |
| `POST` | `/api/webhook/callback` | Webhook adapter callback sink. |

The mobile app does not poll `GET /api/tasks/:id` for status; it subscribes to PocketBase realtime on the `tasks` collection (filtered by `taskId`) through the tunnel. The REST endpoints exist for the commands (submit, answer, cancel) and for initial snapshots.

### 12.1 Submission handler (exactly-once)

```typescript
app.post("/api/tasks", authRequired, async (req, res) => {
  const { taskId, request } = req.body;
  if (!taskId || !UUID_REGEX.test(taskId)) return res.status(400).json({ error: "invalid taskId" });

  const pb = getPocketBase();
  try {
    const existing = await pb.collection("tasks").getFirstListItem(`taskId = "${taskId}"`);
    return res.json(statusFromRow(existing));  // idempotent: return existing
  } catch (err) {
    if (!(err instanceof ClientResponseError && err.status === 404)) throw err;
  }

  const ctx = await adapterManager.buildSystemContext(taskId);
  const worktree = await worktrees.create(taskId);
  ctx.cwd = worktree;

  const row = await pb.collection("tasks").create({
    taskId,
    request,
    state: "queued",
    adapterType: currentAdapterType,
    adapterRef: "",
    seq: 0,
    systemContext: JSON.stringify(ctx),
    worktreePath: worktree,
  });
  await pb.collection("task_queue").create({ taskId, priority: 0, position: Date.now() });

  adapterManager.processQueue();  // fire-and-forget
  res.json(statusFromRow(row));
});
```

---

## 13. Adapter Selection & Configuration

```typescript
// settings (singleton PocketBase collection)
{
  activeAdapter: "openclaw" | "claude-code" | "webhook";

  openclawConfig?: {
    gatewayUrl: string;                 // "ws://127.0.0.1:18789"
    gatewayToken: string;               // AES-256-GCM encrypted
    workspace: string;
  };
  claudeCodeConfig?: {
    executablePath?: string;            // default "claude"
    model?: string;
    maxBudgetUsd: number;               // default 5.00
    apiKey: string;                     // AES-256-GCM encrypted
  };
  webhookConfig?: {
    dispatchUrl: string;
    callbackBaseUrl: string;
    authHeader?: string;                // AES-256-GCM encrypted
  };

  dispatch: {
    maxTaskDurationMs: number;            // default 900_000
    clarificationTimeoutMode: "best_judgment" | "pause_indefinitely";
    clarificationTimeoutMs: number;       // default 300_000
    // Reserved; no-op until ResourceLimits ships post-MVP.
    cpuLimitPercent: number;              // default 200
    memoryLimitMb: number;                // default 2048
  };
}
```

The `AdapterManager` instantiates the active adapter at startup and re-instantiates it on `PUT /api/adapter/config`:

```typescript
class AdapterManager {
  private adapter!: AgentAdapter;

  async initialize(): Promise<void> {
    const s = await this.pb.collection("settings").getFirstListItem("");
    this.adapter = this.createAdapter(s);
    await this.onStartup();
  }

  private createAdapter(s: Settings): AgentAdapter {
    switch (s.activeAdapter) {
      case "openclaw":
        return new OpenClawAdapter({
          gatewayUrl: s.openclawConfig!.gatewayUrl,
          token: decrypt(s.openclawConfig!.gatewayToken),
          workspace: s.openclawConfig!.workspace,
        });
      case "claude-code":
        return new ClaudeCodeAdapter({
          executablePath: s.claudeCodeConfig?.executablePath ?? "claude",
          model: s.claudeCodeConfig?.model,
          maxBudgetUsd: s.claudeCodeConfig?.maxBudgetUsd ?? 5.0,
          applyResourceLimits: this.resourceLimits.apply.bind(this.resourceLimits),
          getApiKey: async () => decrypt((await this.pb.collection("settings").getFirstListItem("")).claudeCodeConfig.apiKey),
        });
      case "webhook":
        return new WebhookAdapter({
          dispatchUrl: s.webhookConfig!.dispatchUrl,
          callbackBaseUrl: s.webhookConfig!.callbackBaseUrl,
          authHeader: s.webhookConfig?.authHeader ? decrypt(s.webhookConfig.authHeader) : undefined,
        });
    }
  }
}
```

---

## 14. File Structure

```
.anyclaw/dispatch-server/
├── src/
│   ├── index.ts                   # process entry; supervisord target
│   ├── rest/
│   │   ├── router.ts              # express/fastify routes
│   │   ├── tasks.ts               # POST /api/tasks, answer, cancel
│   │   ├── adapter.ts             # adapter config endpoints
│   │   ├── emergency.ts           # rollback, restart-app
│   │   └── webhook-callback.ts    # POST /api/webhook/callback
│   ├── mcp/
│   │   ├── server.ts              # HTTP/SSE MCP endpoint
│   │   ├── auth.ts                # per-task bearer token validation
│   │   └── tools/
│   │       ├── ask-user.ts        # anyclaw_ask_user
│   │       ├── update-progress.ts # anyclaw_update_progress
│   │       ├── deploy.ts          # anyclaw_deploy (Plan 2)
│   │       └── ...                # rollback, snapshot, etc.
│   ├── adapters/
│   │   ├── types.ts               # AgentAdapter, TaskStatus, etc.
│   │   ├── manager.ts             # AdapterManager, queue, resume
│   │   ├── openclaw.ts
│   │   ├── claude-code.ts
│   │   ├── webhook.ts
│   │   └── subprocess-base.ts     # SubprocessAdapter skeleton
│   ├── worktrees/
│   │   └── manager.ts             # WorktreeManager
│   ├── resource-limits/
│   │   ├── types.ts               # ResourceLimits interface
│   │   └── noop.ts                # MVP implementation
│   ├── persistence/
│   │   ├── pocketbase-client.ts
│   │   ├── crypto.ts              # AES-256-GCM for secrets
│   │   └── schema.ts              # PocketBase collection definitions
│   └── util/
│       ├── async-queue.ts
│       └── terminal-states.ts
├── test/
│   ├── unit/
│   │   ├── adapter-manager.test.ts
│   │   ├── worktree-manager.test.ts
│   │   ├── openclaw-adapter.test.ts
│   │   └── claude-code-adapter.test.ts
│   └── integration/
│       ├── task-lifecycle.test.ts
│       ├── clarification.test.ts
│       ├── resume-after-restart.test.ts
│       └── exactly-once-delivery.test.ts
├── package.json
└── tsconfig.json
```

The entire tree lives under `.anyclaw/` and is NOT inside the agent's writable path (`dev/`). The `anyclaw_write_file` MCP tool rejects any path outside `dev/`.

---

## 15. Error Handling & Testing

### 15.1 Error classification

`AdapterError.code` drives the response:

| Code | HTTP mapping | User-facing action |
|------|-------------|-------------------|
| `AGENT_UNREACHABLE` | 503 | "Your agent is not reachable. Check OpenClaw/Claude Code is running." |
| `AUTH_FAILED` | 401 | "Agent authentication failed. Update your API key in settings." |
| `AGENT_BUSY` | 409 | "Agent is busy. Please wait or cancel the current task." |
| `TASK_NOT_FOUND` | 404 | "Task not found. It may have been cleaned up." |
| `TIMEOUT` | 504 | "Task exceeded the time budget and was cancelled." |
| `CANCELLED` | 200 | Normal cancellation. |
| `INTERNAL` | 500 | "Something went wrong. Please retry." |

`retryable: true` errors allow the client to retry with the same taskId (idempotent upsert).

### 15.2 Key error scenarios

1. **Adapter dispatch fails before any state change.** No row in `tasks`. Return `AdapterError` synchronously from `POST /api/tasks`.
2. **Adapter dispatch succeeds but subscribe() fails.** Task is already `queued` or `working`; the supervisor loop will retry subscribe once, then mark `failed`.
3. **Agent subprocess crashes mid-task.** The `consumeOutput` loop ends with a non-zero exit code; status transitions to `failed`. Worktree is discarded.
4. **PocketBase unreachable.** Retry with exponential backoff (up to 30s). If still failing, surface `INTERNAL` to the caller.
5. **`anyclaw_deploy` fails in the deploying state.** Worktree stays on disk in `task/<id>` branch for post-mortem; status is `failed`; user can retry with a new UUID.
6. **Merge fails on success** (should never happen in MVP due to sequential ff-only). Log, mark `failed`, leave worktree for inspection.

### 15.3 Testing strategy

**Unit tests:**

- `AdapterManager` queue, priority, resume sweep.
- `WorktreeManager` create/merge/discard with a temp git repo.
- State-machine transitions for each `TaskState`.
- Exactly-once idempotent submission.
- Clarification timeout (both modes).
- Per-adapter event → status mapping.

**Integration tests (with a real PocketBase instance):**

- End-to-end task lifecycle with a **mock adapter** that scripts a sequence of status updates.
- Resume after simulated restart (kill process, restart, verify state).
- Clarification round-trip with PocketBase realtime.
- "Pause indefinitely" across restart: answer written while the dispatch server was down, task resumes correctly on next boot.
- `SIGTERM` during `working` → `cancelled` within 10 seconds.
- Mock OpenClaw WebSocket server verifying the OpenClaw adapter handshake and RPC flow.
- Mock `claude` binary (a small Node script emitting stream-json) verifying the Claude Code adapter stream parser and `--resume` behavior.

**Chaos tests (optional, post-MVP):**

- Random kill of the dispatch server during each lifecycle state; verify no lost or duplicated tasks.
- Slow PocketBase responses to exercise timeouts.

---

## 16. Locked Decisions

All open questions from earlier drafts have been resolved per the main spec. Pulled here for reference:

| # | Decision | Value |
|---|----------|-------|
| 1 | Concurrency | Single active task + queue. Designed with task isolation for future parallelization. |
| 2 | Clarification timeout | User-configurable: `best_judgment` (default 5 min) or `pause_indefinitely`. |
| 3 | Claude Code adapter | CLI `-p` mode for MVP. |
| 4 | MCP transport | HTTP/SSE. |
| 7 | Task persistence | Persist + resume after dispatch-server restart. |
| 26 | Resource limits | Deferred (`ResourceLimits` interface, no-op MVP implementation). |
| 35 | MCP loopback auth | Per-task bearer token, written to env + mcp-config. |
| 36 | Workspace isolation | Worktree-per-task from day one under `dev/.worktrees/`. |
| 38 | Checkpoint schema | Agent-agnostic step tracker + optional agent blob. |
| 39 | ask_user resume | On restart, re-check `task_clarifications` for pending/answered before re-dispatching. |
| 40 | Task delivery guarantee | Exactly-once via client UUID + idempotent upsert + startup sweep. |
| 41 | OpenClaw gateway failures | Deferred to post-MVP; best-effort reconnect for now. |
| 42 | Queue stall detection | Hard timeout only (`maxTaskDurationMs`). No heartbeat requirement. |
