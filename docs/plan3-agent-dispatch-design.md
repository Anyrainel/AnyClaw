# Plan 3: Agent Dispatch Layer -- Design Document

**Goal:** Define the pluggable adapter layer that lets the AnyClaw mobile app submit work requests to the user's coding agent, relay clarifying questions back to the user, and report progress/completion/failure. The adapter is agent-agnostic: initial implementations cover OpenClaw and Claude Code, with a generic webhook adapter for future agents (Codex, Aider, Gemini CLI, etc.).

**Depends on:** Plan 1 (Server Infrastructure) for PocketBase runtime and the supervised-process host layout.

---

## 1. Where the Adapter Runs

The adapter runs **on the user's host, inside the Dispatch / MCP Server process** -- not in the mobile app, not in the broker, and not in the logic service. The dispatch/MCP server is one of the supervised processes defined in the main spec's "Process Architecture" section. It is NOT a container; it is a long-lived Node.js process managed by supervisord / systemd / pm2 alongside PocketBase, the tunnel manager, and the logic service.

**Supervised-process architecture (locked decision):**

All AnyClaw services run as independent supervised processes on a single host (or inside a single cloud container with supervisord). There are no sub-containers. Crash isolation comes from process supervision with per-process restart policies, not from container boundaries.

The dispatch/MCP server is the small, stable "control plane" process. Its responsibilities:

1. Task dispatch REST API (`POST /tasks`, `POST /tasks/:id/answer`, etc.).
2. MCP HTTP/SSE endpoint for the agent to call AnyClaw MCP tools.
3. Emergency endpoints that always work even when the user's app is broken: `POST /rollback`, `POST /restart-app`.
4. Owning the `AdapterManager`, which spawns and supervises the transient agent subprocess for each task.

**The dispatch/MCP server source files live under `.anyclaw/` on the host filesystem and are NOT in the agent's writable path.** The `anyclaw_write_file` MCP tool path-checks every write against the agent workspace (`dev/`) and rejects anything outside it. The agent literally cannot edit the process that supervises it.

**Rationale for placing the adapter in the dispatch/MCP server:**

- The dispatch server is always running, always reachable, and `restart=always` under the supervisor. The mobile app can always submit tasks, even if the logic service is broken by bad agent code.
- The dispatch server already owns the MCP HTTP/SSE endpoint the agent talks to. Spawning the agent subprocess from the same process means the adapter can inject the MCP endpoint URL, set `ANYCLAW_TASK_ID` in the child environment, and manage the process lifecycle cleanly.
- Task state lives in PocketBase (another supervised process on the same host, reachable at `localhost:8090`). No cross-container networking, no Docker socket, no volume sharing.
- The broker is a thin signaling relay. Putting dispatch logic there would make it stateful, expensive, and a single point of failure.

**Communication path:**

```
Mobile App  --[WSS tunnel via Tunnel Manager]--> Dispatch / MCP Server process
                                                      |
                                                      +--> AdapterManager
                                                      |        |
                                                      |        +--> OpenClawAdapter
                                                      |        |     --[WS]--> OpenClaw on localhost
                                                      |        |     (existing user install or spawned)
                                                      |        |
                                                      |        +--> ClaudeCodeAdapter
                                                      |        |     --[spawn]--> claude -p (child process,
                                                      |        |                    cwd=dev/, cgroup limits)
                                                      |        |
                                                      |        +--> WebhookAdapter
                                                      |              --[HTTP]--> user-configured URL
                                                      |
                                                      +--> PocketBase (localhost:8090)
                                                      |      task state persistence
                                                      |
                                                      +--> MCP HTTP/SSE endpoint (localhost, same process)
                                                             the agent subprocess connects back here
```

The mobile app talks to the dispatch/MCP server over the existing WSS tunnel (terminated by the Tunnel Manager process and forwarded to the dispatch server on localhost). The adapter translates between AnyClaw's task protocol and the specific agent's protocol. Everything runs on one host and talks over loopback.

**Task isolation.** Since the locked decision is single-active-task + queue, each task gets a fresh subprocess spawn. The agent subprocess is transient: it does not survive the task. Future parallelization can spawn multiple subprocesses pointing at different per-task working directories (e.g., `dev-task1/`, `dev-task2/`) without changing the dispatch model. For MVP, all tasks share `dev/` sequentially.

---

## 2. Adapter Interface

### 2.1 Core Types

```typescript
// --- Task identity ---

/** Opaque handle returned by dispatch(). Adapters define the internal shape. */
type TaskHandle = {
  taskId: string;           // AnyClaw-assigned UUID
  adapterRef: string;       // Adapter-specific reference (e.g., session ID, run ID, PID)
};

// --- Task lifecycle states ---

type TaskState =
  | "queued"        // submitted but adapter hasn't started it yet
  | "clarifying"    // agent is asking a question; waiting for user answer
  | "working"       // agent is implementing
  | "deploying"     // agent is running validation + promoting to prod
  | "done"          // success
  | "failed"        // unrecoverable error
  | "cancelled";    // user cancelled

// --- Status payload ---

interface TaskStatus {
  state: TaskState;
  /** When state === "clarifying", the agent's question. */
  question?: string;
  /** When state === "done", the version description the agent wrote. */
  versionDescription?: string;
  /** When state === "failed", a human-readable error. */
  error?: string;
  /** Short progress summary, e.g. "Running type checker..." */
  progressSummary?: string;
  /** Monotonically increasing. Lets the mobile app skip stale status updates. */
  seq: number;
  /** ISO 8601 timestamp of this status snapshot. */
  updatedAt: string;
}

// --- Activity log ---

interface ActivityEntry {
  timestamp: string;   // ISO 8601
  message: string;
  type: "info" | "tool_use" | "warning" | "error";
}

// --- Adapter errors ---

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
  | "AGENT_UNREACHABLE"     // cannot connect to agent gateway or spawn subprocess
  | "AUTH_FAILED"           // bad token or expired credentials
  | "TASK_NOT_FOUND"        // handle refers to unknown task
  | "AGENT_BUSY"            // agent is already working on another task
  | "TIMEOUT"               // operation exceeded deadline
  | "CANCELLED"             // task was cancelled
  | "INTERNAL";             // unexpected adapter error
```

### 2.2 AgentAdapter Interface

```typescript
interface AgentAdapter {
  /** Human-readable adapter name for UI display ("OpenClaw", "Claude Code"). */
  readonly name: string;

  /**
   * Check whether the agent is reachable and ready to accept work.
   * Returns quickly (< 5s). Used by the mobile app's status indicator.
   */
  healthCheck(): Promise<{ ok: boolean; detail?: string }>;

  /**
   * Submit a new task. The adapter translates the request into the agent's
   * native protocol and starts the agent session (typically by spawning a
   * subprocess).
   *
   * @param taskId - AnyClaw-assigned UUID for this task.
   * @param request - The user's natural-language feature request.
   * @param systemContext - Injected instructions (MCP endpoint URL, cwd, allowed tools).
   * @param signal - AbortSignal for cancellation. When aborted, the adapter
   *                 MUST attempt to stop the agent and resolve the promise
   *                 with state "cancelled". Timeout is enforced by the caller.
   * @returns The initial TaskStatus (typically state "queued" or "working").
   * @throws AdapterError on connection/auth/spawn failures.
   */
  dispatch(
    taskId: string,
    request: string,
    systemContext: SystemContext,
    signal: AbortSignal
  ): Promise<TaskHandle>;

  /**
   * Subscribe to status changes for a running task. Returns an async iterable
   * that yields TaskStatus objects whenever the state or progress changes.
   * The iterable completes when the task reaches a terminal state
   * (done | failed | cancelled).
   *
   * Adapters MUST yield at least one status on subscription (the current state)
   * and MUST yield the terminal status before completing.
   */
  subscribe(handle: TaskHandle, signal: AbortSignal): AsyncIterable<TaskStatus>;

  /**
   * Send the user's answer to a clarifying question.
   * Only valid when the current state is "clarifying".
   *
   * @throws AdapterError with code TASK_NOT_FOUND or INTERNAL.
   */
  answerQuestion(handle: TaskHandle, answer: string): Promise<void>;

  /**
   * Request cancellation. The adapter should attempt a graceful stop
   * (SIGTERM -> SIGKILL for subprocess adapters, abort RPC for gateway adapters).
   * The subscribe() iterable will eventually yield state "cancelled".
   * Calling cancel on an already-terminal task is a no-op.
   */
  cancel(handle: TaskHandle): Promise<void>;

  /**
   * Get the activity log since the given sequence number.
   * Returns an empty array if the adapter does not support activity logs.
   * Optional -- callers must handle the method being absent.
   */
  getActivityLog?(
    handle: TaskHandle,
    sinceSeq?: number
  ): Promise<ActivityEntry[]>;

  /**
   * Tear down any persistent connections (WebSocket, child process handles).
   * Called on dispatch server shutdown.
   */
  dispose(): Promise<void>;
}

interface SystemContext {
  /** Absolute path to the agent workspace. This is always the `dev/` directory
   *  for MVP. The agent's own file tools operate natively on this path. */
  cwd: string;
  /** URL of the MCP HTTP/SSE endpoint the agent connects back to.
   *  Always loopback, e.g. "http://127.0.0.1:4100/mcp". */
  mcpEndpointUrl: string;
  /** Path to an MCP config file the adapter generates per task
   *  (for agents like Claude Code that take --mcp-config). */
  mcpConfigPath: string;
  /** System prompt additions that instruct the agent to use AnyClaw tools. */
  systemPrompt: string;
  /** List of MCP tools the agent is allowed to call without permission prompts. */
  allowedTools: string[];
  /** cgroup path (Linux) or job-object handle name (Windows) that limits the
   *  child process's CPU and memory. The AdapterManager creates this per task
   *  and passes it to the adapter so the agent spawn can be placed into it. */
  resourceLimitHandle?: string;
}
```

### 2.3 Timeout Semantics

Timeouts are NOT managed inside adapters. The caller (AdapterManager) enforces them:

```typescript
class AdapterManager {
  private adapter: AgentAdapter;
  private config: DispatchConfig;

  async dispatchTask(taskId: string, request: string): Promise<TaskHandle> {
    const controller = new AbortController();

    // Hard timeout: kill the task if it exceeds the budget
    const timer = setTimeout(
      () => controller.abort(new AdapterError(
        `Task exceeded ${this.config.maxTaskDurationMs}ms`,
        "TIMEOUT",
        false
      )),
      this.config.maxTaskDurationMs  // default: 15 minutes
    );

    try {
      const handle = await this.adapter.dispatch(
        taskId,
        request,
        this.buildSystemContext(taskId),
        controller.signal
      );
      return handle;
    } finally {
      // Note: timer is NOT cleared here. It continues running and will
      // abort the task if it's still going after the deadline.
      // It IS cleared when subscribe() yields a terminal state.
    }
  }
}

interface DispatchConfig {
  /** Max time a single task can run before forced cancellation. Default: 900000 (15 min). */
  maxTaskDurationMs: number;
  /** Max time to wait for agent to become reachable. Default: 10000 (10s). */
  healthCheckTimeoutMs: number;
  /** Max time between status updates before declaring the agent stalled. Default: 120000 (2 min). */
  stallTimeoutMs: number;
}
```

---

## 3. OpenClaw Adapter

### 3.1 Connection

The OpenClaw adapter connects to a locally-running OpenClaw gateway. Two modes:

1. **Existing install (plugin mode).** The user already runs OpenClaw on the same host. The adapter connects to it at `ws://127.0.0.1:18789` (configurable via `OPENCLAW_GATEWAY_PORT`).
2. **Bundled install (standalone mode).** The AnyClaw installer set up OpenClaw as another supervised process on the same host. The adapter connects the same way -- it is just loopback regardless.

There is no cross-container networking. The WebSocket goes over loopback on a single host. Protocol version 3.

**Handshake sequence:**

```
Gateway --> Client:  { type: "event", event: "connect.challenge", payload: { nonce, ts } }
Client  --> Gateway: { type: "req", id: "1", method: "connect", params: {
                         minProtocol: 3, maxProtocol: 3,
                         client: { name: "anyclaw-adapter", version: "1.0.0" },
                         role: "operator",
                         scopes: ["operator.read", "operator.write"],
                         auth: { token: process.env.OPENCLAW_GATEWAY_TOKEN }
                       }}
Gateway --> Client:  { type: "res", id: "1", ok: true, payload: { ... hello-ok ... } }
```

### 3.2 Task Dispatch

Tasks are submitted using `chat.send`, which creates or continues a session:

```typescript
import WebSocket from "ws";

class OpenClawAdapter implements AgentAdapter {
  readonly name = "OpenClaw";
  private ws: WebSocket | null = null;
  private reqId = 0;
  private pendingRpcs = new Map<string, {
    resolve: (payload: any) => void;
    reject: (err: Error) => void;
  }>();
  private eventListeners = new Map<string, Set<(payload: any) => void>>();

  constructor(private config: {
    gatewayUrl: string;   // default: "ws://127.0.0.1:18789"
    token: string;        // OPENCLAW_GATEWAY_TOKEN (decrypted from PocketBase)
    workspace: string;    // OpenClaw workspace name for AnyClaw tasks
  }) {}

  async healthCheck(): Promise<{ ok: boolean; detail?: string }> {
    try {
      await this.ensureConnected();
      return { ok: true };
    } catch (err) {
      return { ok: false, detail: String(err) };
    }
  }

  async dispatch(
    taskId: string,
    request: string,
    systemContext: SystemContext,
    signal: AbortSignal
  ): Promise<TaskHandle> {
    await this.ensureConnected();

    // Send the task as a chat message in the AnyClaw workspace.
    // The system prompt (loaded via OpenClaw skills) instructs the agent
    // to use anyclaw_* MCP tools reachable at systemContext.mcpEndpointUrl.
    const res = await this.rpc("chat.send", {
      workspace: this.config.workspace,
      message: { role: "user", content: request },
      idempotencyKey: taskId,
      metadata: {
        anyClawTaskId: taskId,
        mcpEndpointUrl: systemContext.mcpEndpointUrl,
        cwd: systemContext.cwd,
      }
    }, signal);

    return { taskId, adapterRef: res.runId };
  }

  async *subscribe(handle: TaskHandle, signal: AbortSignal): AsyncIterable<TaskStatus> {
    await this.ensureConnected();
    let seq = 0;

    await this.rpc("sessions.subscribe", { runId: handle.adapterRef }, signal);

    const statusQueue = new AsyncQueue<TaskStatus>();

    const onEvent = (payload: any) => {
      const status = this.mapGatewayEventToStatus(payload, ++seq);
      if (status) statusQueue.push(status);
      if (status && isTerminal(status.state)) statusQueue.close();
    };

    this.addEventListener("session.message", onEvent);
    this.addEventListener("session.tool", onEvent);

    signal.addEventListener("abort", () => {
      statusQueue.push({
        state: "cancelled", seq: ++seq,
        updatedAt: new Date().toISOString()
      });
      statusQueue.close();
    });

    try {
      for await (const status of statusQueue) {
        yield status;
      }
    } finally {
      this.removeEventListener("session.message", onEvent);
      this.removeEventListener("session.tool", onEvent);
    }
  }

  async answerQuestion(handle: TaskHandle, answer: string): Promise<void> {
    // No-op at the adapter level: the answer is written to PocketBase by
    // the dispatch REST handler and picked up by the anyclaw_ask_user MCP
    // tool via PocketBase realtime subscription. The OpenClaw gateway
    // doesn't need to be notified -- the MCP tool blocking call resolves
    // and the agent continues.
  }

  async cancel(handle: TaskHandle): Promise<void> {
    await this.rpc("sessions.abort", {
      runId: handle.adapterRef
    }, AbortSignal.timeout(10_000));
  }

  async dispose(): Promise<void> {
    this.ws?.close();
    this.ws = null;
  }

  // --- Internal helpers ---

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
        frame.ok ? rpc.resolve(frame.payload) : rpc.reject(
          new AdapterError(frame.error?.message ?? "RPC failed", "INTERNAL", false)
        );
      } else if (frame.type === "event") {
        const listeners = this.eventListeners.get(frame.event);
        listeners?.forEach(fn => fn(frame.payload));
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

  private mapGatewayEventToStatus(payload: any, seq: number): TaskStatus | null {
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
    const challenge = await new Promise<any>((resolve) => {
      this.addEventListener("connect.challenge", resolve);
    });
    await this.rpc("connect", {
      minProtocol: 3,
      maxProtocol: 3,
      client: { name: "anyclaw-adapter", version: "1.0.0" },
      role: "operator",
      scopes: ["operator.read", "operator.write"],
      auth: { token: this.config.token }
    }, AbortSignal.timeout(5_000));
  }
}
```

### 3.3 Multi-Turn Clarification via Gateway

OpenClaw's gateway natively supports multi-turn conversation within a session. The flow:

1. Adapter sends `chat.send` with the user's request. Gateway returns `{ runId, status: "accepted" }`.
2. The agent's reasoning loop runs. If the agent calls the `anyclaw_ask_user` MCP tool, the tool handler (inside the dispatch/MCP server process) writes the question to PocketBase and blocks on a realtime subscription waiting for the answer record.
3. The adapter detects the `session.tool` event for `anyclaw_ask_user` and yields a `TaskStatus` with `state: "clarifying"`.
4. The mobile app shows the question. When the user replies, the mobile app calls the dispatch REST API, which writes the answer to PocketBase.
5. The `anyclaw_ask_user` MCP tool handler (subscribed to PocketBase realtime) picks up the answer and returns it to the agent.
6. The agent continues its reasoning loop.

This design means clarification works identically for every adapter: the `anyclaw_ask_user` MCP tool is the universal mechanism. The adapter-specific part is only how the adapter *detects* that the tool was called (OpenClaw: gateway events; Claude Code: subprocess stream; Webhook: callback POST).

---

## 4. Claude Code Adapter

### 4.1 Approach: CLI `-p` Mode (Locked Decision)

The Claude Code adapter uses the CLI's `-p` (print) mode for MVP. The dispatch/MCP server spawns `claude -p <request>` as a **transient child process** using Node's `child_process.spawn`. The process runs to completion and exits; when it exits, the task is over. There is no long-lived claude daemon.

**Why CLI `-p` over the TypeScript SDK:** The `-p` flag is simpler to implement and debug. All clarification goes through the `anyclaw_ask_user` MCP tool (which blocks inside the dispatch server process, not the adapter), so the SDK's multi-turn `AsyncIterable<SDKUserMessage>` capability is not needed. The adapter's job is to spawn, monitor, and kill a child process. Upgrade to `@anthropic-ai/claude-agent-sdk` later if richer lifecycle control is needed.

**Execution model:**

- The child process is spawned with `cwd: systemContext.cwd`, which points at the agent workspace (`dev/`).
- Claude Code's built-in `Read`, `Write`, `Edit`, `Bash` tools operate **natively** on the `dev/` directory. There is no sandbox proxy; the agent's own tools are what do file edits and shell commands.
- The AnyClaw MCP server (running in the same dispatch/MCP server process that spawned the child) is reachable at `systemContext.mcpEndpointUrl` on loopback. The adapter writes a small MCP config file per task (`~/.anyclaw/tmp/mcp-<taskId>.json`) that points Claude Code at that endpoint, and passes it via `--mcp-config`.
- **cgroup / resource limits (locked decision).** Before spawning, the AdapterManager creates a per-task cgroup (Linux) or Job Object (Windows) with CPU and memory caps, and places the child PID into it immediately after spawn. This prevents a runaway agent from starving PocketBase, the tunnel manager, or the dispatch server itself. On macOS (no cgroups), the adapter falls back to `ulimit`-style `resource.setrlimit` via a small preload shim plus wall-clock timeouts.
- **Path write protection.** The dispatch/MCP server's own source files live in `.anyclaw/` and are not inside `dev/`. The agent cannot reach them with its own file tools because its `cwd` is `dev/` and the `anyclaw_write_file` MCP tool rejects paths that escape `dev/`. A bad agent can still crash its own process, but it cannot modify the dispatch server or PocketBase.

### 4.2 Implementation

```typescript
import { spawn, ChildProcess } from "child_process";
import { writeFile } from "fs/promises";
import { join } from "path";

class ClaudeCodeAdapter implements AgentAdapter {
  readonly name = "Claude Code";
  private activeProcesses = new Map<string, {
    proc: ChildProcess;
    status: TaskStatus;
    sessionId?: string;  // Claude Code session ID for resume
  }>();

  constructor(private config: {
    /** Path to claude binary. Default: "claude" (from PATH). */
    executablePath: string;
    /** Model override, e.g. "claude-sonnet-4-20250514". */
    model?: string;
    /** Max budget per task in USD. Default: 5.00 */
    maxBudgetUsd: number;
    /** Function that applies the per-task cgroup/JobObject to a PID. */
    applyResourceLimits: (pid: number, handle: string) => Promise<void>;
  }) {}

  async healthCheck(): Promise<{ ok: boolean; detail?: string }> {
    try {
      const proc = spawn(this.config.executablePath, [
        "-p", "Reply with OK",
        "--max-turns", "1",
        "--output-format", "json"
      ], { timeout: 10_000 });

      const result = await collectStdout(proc);
      return { ok: result.includes("OK") };
    } catch (err) {
      return { ok: false, detail: String(err) };
    }
  }

  async dispatch(
    taskId: string,
    request: string,
    systemContext: SystemContext,
    signal: AbortSignal
  ): Promise<TaskHandle> {
    // Write a per-task MCP config file pointing claude at our loopback endpoint.
    const mcpConfig = {
      mcpServers: {
        anyclaw: {
          type: "http",
          url: systemContext.mcpEndpointUrl,
          headers: { "x-anyclaw-task-id": taskId }
        }
      }
    };
    await writeFile(systemContext.mcpConfigPath, JSON.stringify(mcpConfig));

    const args = [
      "-p", request,
      "--output-format", "stream-json",
      "--mcp-config", systemContext.mcpConfigPath,
      "--allowedTools", systemContext.allowedTools.join(","),
      "--max-budget", String(this.config.maxBudgetUsd),
    ];
    if (this.config.model) args.push("--model", this.config.model);

    const apiKey = await this.getApiKey();

    const proc = spawn(this.config.executablePath, args, {
      cwd: systemContext.cwd,  // always the dev/ directory
      env: {
        ...process.env,
        ANTHROPIC_API_KEY: apiKey,
        ANYCLAW_TASK_ID: taskId,
        ANYCLAW_MCP_URL: systemContext.mcpEndpointUrl,
      },
      signal
    });

    // Place the child into its per-task resource limit group immediately.
    if (systemContext.resourceLimitHandle && proc.pid) {
      await this.config.applyResourceLimits(proc.pid, systemContext.resourceLimitHandle);
    }

    const session = {
      proc,
      status: {
        state: "working" as TaskState,
        seq: 0,
        updatedAt: new Date().toISOString()
      } as TaskStatus,
      sessionId: undefined as string | undefined
    };
    this.activeProcesses.set(taskId, session);

    this.consumeOutputStream(taskId);
    return { taskId, adapterRef: taskId };
  }

  async *subscribe(handle: TaskHandle, signal: AbortSignal): AsyncIterable<TaskStatus> {
    const session = this.activeProcesses.get(handle.taskId);
    if (!session) throw new AdapterError("Task not found", "TASK_NOT_FOUND", false);

    const statusQueue = new AsyncQueue<TaskStatus>();
    statusQueue.push(session.status);

    const watcher = setInterval(() => {
      const s = this.activeProcesses.get(handle.taskId);
      if (s && s.status.seq > (statusQueue.lastSeq ?? -1)) {
        statusQueue.push(s.status);
        if (isTerminal(s.status.state)) {
          statusQueue.close();
          clearInterval(watcher);
        }
      }
    }, 500);

    signal.addEventListener("abort", () => {
      clearInterval(watcher);
      statusQueue.close();
    });

    for await (const status of statusQueue) {
      yield status;
    }
  }

  async answerQuestion(handle: TaskHandle, answer: string): Promise<void> {
    // No-op at the adapter level. The anyclaw_ask_user MCP tool (blocking
    // inside the same dispatch/MCP server process) picks up the answer via
    // PocketBase realtime as soon as the REST handler writes it.
  }

  async cancel(handle: TaskHandle): Promise<void> {
    const session = this.activeProcesses.get(handle.taskId);
    if (!session || session.proc.killed) return;
    session.proc.kill("SIGTERM");
    setTimeout(() => {
      if (!session.proc.killed) session.proc.kill("SIGKILL");
    }, 5000);
  }

  async dispose(): Promise<void> {
    for (const [, session] of this.activeProcesses) {
      if (!session.proc.killed) session.proc.kill("SIGTERM");
    }
    this.activeProcesses.clear();
  }

  // --- Internal ---

  private async consumeOutputStream(taskId: string): Promise<void> {
    const session = this.activeProcesses.get(taskId);
    if (!session) return;

    const rl = createReadlineInterface(session.proc.stdout!);

    try {
      for await (const line of rl) {
        const event = JSON.parse(line);
        this.updateStatusFromStreamEvent(taskId, event);

        if (event.type === "system" && event.session_id) {
          session.sessionId = event.session_id;
          await this.persistSessionId(taskId, event.session_id);
        }
      }

      const exitCode = await waitForExit(session.proc);
      if (!isTerminal(session.status.state)) {
        session.status = exitCode === 0
          ? { state: "done", seq: ++session.status.seq, updatedAt: new Date().toISOString() }
          : { state: "failed", error: `claude exited with code ${exitCode}`, seq: ++session.status.seq, updatedAt: new Date().toISOString() };
      }
    } catch (err) {
      session.status = {
        state: "failed",
        error: String(err),
        seq: ++session.status.seq,
        updatedAt: new Date().toISOString()
      };
    } finally {
      await this.persistTaskState(taskId, session.status);
      // Drop the slot after a grace period so late subscribers can still read the final status.
      setTimeout(() => this.activeProcesses.delete(taskId), 5 * 60 * 1000);
    }
  }

  private updateStatusFromStreamEvent(taskId: string, event: any): void {
    const session = this.activeProcesses.get(taskId);
    if (!session) return;
    const now = new Date().toISOString();
    const seq = ++session.status.seq;

    if (event.type === "assistant" && event.message?.content) {
      for (const block of event.message.content) {
        if (block.type === "tool_use") {
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
    }

    if (event.type === "result") {
      session.status = { state: "done", versionDescription: event.result, seq, updatedAt: now };
    }
  }

  /**
   * Resume a task after dispatch-server restart by re-spawning claude with --resume.
   * Claude Code maintains its session state in its own directory (~/.claude/) which
   * is on the host filesystem and survives dispatch-server restarts naturally.
   */
  async resumeTask(
    taskId: string,
    sessionId: string,
    systemContext: SystemContext,
    signal: AbortSignal
  ): Promise<TaskHandle> {
    const apiKey = await this.getApiKey();

    const args = [
      "-p", "--resume", sessionId,
      "--output-format", "stream-json",
      "--mcp-config", systemContext.mcpConfigPath,
      "--allowedTools", systemContext.allowedTools.join(","),
    ];

    const proc = spawn(this.config.executablePath, args, {
      cwd: systemContext.cwd,
      env: {
        ...process.env,
        ANTHROPIC_API_KEY: apiKey,
        ANYCLAW_TASK_ID: taskId,
        ANYCLAW_MCP_URL: systemContext.mcpEndpointUrl,
      },
      signal
    });

    if (systemContext.resourceLimitHandle && proc.pid) {
      await this.config.applyResourceLimits(proc.pid, systemContext.resourceLimitHandle);
    }

    const session = {
      proc,
      status: {
        state: "working" as TaskState,
        progressSummary: "Resuming after restart...",
        seq: 0,
        updatedAt: new Date().toISOString()
      } as TaskStatus,
      sessionId
    };
    this.activeProcesses.set(taskId, session);
    this.consumeOutputStream(taskId);

    return { taskId, adapterRef: taskId };
  }

  private async getApiKey(): Promise<string> {
    const pb = getPocketBase();
    const settings = await pb.collection("settings").getFirstListItem("");
    return decrypt(settings.claudeCodeConfig.apiKey);
  }

  private async persistSessionId(taskId: string, sessionId: string): Promise<void> {
    const pb = getPocketBase();
    await pb.collection("tasks").update(taskId, { sessionId });
  }

  private async persistTaskState(taskId: string, status: TaskStatus): Promise<void> {
    const pb = getPocketBase();
    await pb.collection("tasks").update(taskId, {
      state: status.state,
      progressSummary: status.progressSummary,
      versionDescription: status.versionDescription,
      error: status.error,
      seq: status.seq,
    });
  }
}
```

### 4.3 Key Design Decisions for Claude Code

**CLI `-p` mode (locked decision).** The adapter spawns `claude -p <request>` as a child process with `--output-format stream-json` for progress tracking. This is simpler than the TypeScript SDK and sufficient for MVP because all clarification is handled by the `anyclaw_ask_user` MCP tool (blocking inside the dispatch/MCP server process, not the adapter).

**Native execution in `dev/`.** The child process runs with `cwd` set to the agent workspace (`dev/`). Claude Code's built-in `Read`, `Write`, `Edit`, `Bash` tools operate directly on files there. There is no sandbox container and no MCP proxy for file I/O.

**cgroup / JobObject resource limits (locked decision).** Every spawned agent child is placed into a per-task cgroup (Linux) or Job Object (Windows) that caps CPU and memory. This prevents runaway agents from starving the supervised processes. Macroscopic isolation (can't break the dispatch server) comes from the agent not being able to write outside `dev/`.

**MCP server on loopback.** The dispatch/MCP server process hosts the MCP HTTP/SSE endpoint on localhost. The adapter writes a per-task MCP config file (`--mcp-config`) that points claude at `http://127.0.0.1:<port>/mcp` and includes the task ID as a header so the MCP tools can correlate calls to the right task.

**Budget cap: `maxBudgetUsd`.** Passed via `--max-budget`. Prevents runaway token spend. Default $5 per task.

**Task state persistence and resume (locked decision).** The adapter persists the Claude Code session ID to PocketBase as soon as it appears in the stream-json output. On dispatch-server restart, the AdapterManager queries PocketBase for any tasks in a non-terminal state and calls `resumeTask()` with the persisted session ID. Claude Code's `--resume <sessionId>` flag restores the conversation context from `~/.claude/` on the host filesystem (which is untouched by the dispatch server restart, since both live on the same host). See Section 6.5.

**API key from PocketBase (locked decision).** The `ANTHROPIC_API_KEY` is stored encrypted in PocketBase (not in environment variables). The adapter decrypts it at dispatch time and injects it into the child's environment.

### 4.4 Authentication

Claude Code authenticates via the `ANTHROPIC_API_KEY` environment variable, injected into the child process from the encrypted PocketBase store. No browser OAuth. The user configures the key through the mobile app settings screen.

---

## 5. Non-Interactive Mode Patterns for Other Agents

All other CLI-based adapters follow the same spawn-child-on-loopback model as Claude Code: the dispatch server spawns the agent binary with `cwd = dev/`, puts the PID into the per-task cgroup/JobObject, and points it at the loopback MCP endpoint.

### 5.1 Codex CLI (OpenAI)

```bash
codex exec "Add a mood tracker page with trend charts" \
  --approval-mode full-auto \
  --jsonl
```

**Adapter strategy:** Spawn `codex exec` as a child process of the dispatch server. Parse the JSONL stdout stream for progress events. Clarification is handled via the `anyclaw_ask_user` MCP tool. Cancellation via `SIGTERM` on the child. Set a stall timeout in case quiet-mode prompts still block.

```typescript
class CodexAdapter implements AgentAdapter {
  readonly name = "Codex CLI";

  async dispatch(
    taskId: string,
    request: string,
    systemContext: SystemContext,
    signal: AbortSignal
  ): Promise<TaskHandle> {
    const proc = spawn("codex", [
      "exec", request,
      "--approval-mode", "full-auto",
      "--jsonl",
      "--mcp-config", systemContext.mcpConfigPath
    ], {
      cwd: systemContext.cwd,
      env: {
        ...process.env,
        CODEX_QUIET_MODE: "1",
        ANYCLAW_TASK_ID: taskId,
        ANYCLAW_MCP_URL: systemContext.mcpEndpointUrl,
      },
      signal
    });

    if (systemContext.resourceLimitHandle && proc.pid) {
      await applyResourceLimits(proc.pid, systemContext.resourceLimitHandle);
    }

    this.activeProcesses.set(taskId, proc);
    return { taskId, adapterRef: taskId };
  }
  // subscribe() parses proc.stdout JSONL stream
  // cancel() sends SIGTERM to proc
  // answerQuestion() writes to PocketBase; anyclaw_ask_user MCP tool picks it up
}
```

### 5.2 Aider

```bash
aider --message "Add a mood tracker page" --yes --no-auto-commits
```

**Adapter strategy:** Spawn `aider` as a child process with `--message`. Aider does not currently support MCP, so clarification via `anyclaw_ask_user` requires a workaround: the adapter runs aider in a loop, parsing its stdout for question patterns.

**Limitation:** Multi-turn clarification within a single aider session is not supported in non-interactive mode. The adapter would:
1. Run the first prompt with `--message`.
2. If the output contains a question pattern, surface it via the REST API.
3. Run a second `aider --message <answer> --yes` in the same repo.

### 5.3 Gemini CLI

```bash
gemini -p "Add a mood tracker page" --non-interactive
```

Same child-process + stdout-parsing pattern as Codex.

### 5.4 Generic Pattern

All subprocess adapters share this skeleton:

```typescript
abstract class SubprocessAdapter implements AgentAdapter {
  protected activeProcesses = new Map<string, ChildProcess>();

  protected abstract buildCommand(
    request: string,
    systemContext: SystemContext,
    taskId: string
  ): { command: string; args: string[]; env: Record<string, string> };

  protected abstract parseOutput(line: string): TaskStatus | null;

  async dispatch(
    taskId: string,
    request: string,
    systemContext: SystemContext,
    signal: AbortSignal
  ): Promise<TaskHandle> {
    const { command, args, env } = this.buildCommand(request, systemContext, taskId);
    const proc = spawn(command, args, {
      cwd: systemContext.cwd,                // always the dev/ directory
      env: { ...process.env, ...env },
      signal
    });

    if (systemContext.resourceLimitHandle && proc.pid) {
      await applyResourceLimits(proc.pid, systemContext.resourceLimitHandle);
    }

    this.activeProcesses.set(taskId, proc);
    return { taskId, adapterRef: taskId };
  }

  async cancel(handle: TaskHandle): Promise<void> {
    const proc = this.activeProcesses.get(handle.taskId);
    if (proc && !proc.killed) {
      proc.kill("SIGTERM");
      setTimeout(() => { if (!proc.killed) proc.kill("SIGKILL"); }, 5000);
    }
  }

  async dispose(): Promise<void> {
    for (const [, proc] of this.activeProcesses) {
      if (!proc.killed) proc.kill("SIGTERM");
    }
    this.activeProcesses.clear();
  }
}
```

---

## 6. Clarification Relay

The clarification relay is the hardest part of the dispatch layer. The agent is running as a child process on the host, the user is on a phone, and there may be seconds of network latency between them.

### 6.1 The Universal Mechanism: `anyclaw_ask_user` MCP Tool

Regardless of which adapter is active, the agent asks clarifying questions by calling the `anyclaw_ask_user` MCP tool. This tool is registered inside the dispatch/MCP server process (same process that owns the AdapterManager).

The MCP tool does NOT communicate directly with the mobile app. Instead, it writes to PocketBase and waits for an answer:

```typescript
// Registered on the dispatch/MCP server's MCP HTTP/SSE endpoint
const askUserTool = tool(
  "anyclaw_ask_user",
  "Ask the user a clarifying question and wait for their answer",
  {
    question: z.string().describe("The question to ask the user"),
    taskId: z.string().optional().describe("Task ID (injected from env/header if omitted)")
  },
  async ({ question, taskId: explicitTaskId }, ctx) => {
    const taskId = explicitTaskId
      ?? ctx.request.headers["x-anyclaw-task-id"]
      ?? process.env.ANYCLAW_TASK_ID;
    if (!taskId) throw new Error("No task ID available");

    const pb = getPocketBase();

    const record = await pb.collection("task_clarifications").create({
      taskId,
      question,
      status: "pending",
      answer: null
    });

    const settings = await pb.collection("settings").getFirstListItem("");
    const timeoutMode = settings.dispatch?.clarificationTimeoutMode ?? "best_judgment";
    const timeoutMs = settings.dispatch?.clarificationTimeoutMs ?? 300_000;

    const answer = await waitForAnswer(pb, record.id, taskId, timeoutMs, timeoutMode);

    return { content: [{ type: "text", text: answer }] };
  }
);

async function waitForAnswer(
  pb: PocketBase,
  clarificationId: string,
  taskId: string,
  timeoutMs: number,
  timeoutMode: "best_judgment" | "pause_indefinitely"
): Promise<string> {
  return new Promise((resolve, reject) => {
    const timer = timeoutMode === "pause_indefinitely"
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

### 6.2 Full Communication Path

```
Agent (child process) calls anyclaw_ask_user("Daily or multiple times per day?")
    |  HTTP/SSE over loopback
    v
Dispatch/MCP server writes question to PocketBase task_clarifications
    |  (PocketBase SSE realtime, loopback)
    v
Adapter detects the tool call (via gateway events or subprocess stream)
    |
    v
Adapter updates TaskStatus to { state: "clarifying", question: "..." }
    |  PocketBase Realtime SSE -> Tunnel Manager -> WSS -> Mobile app
    v
Mobile app shows question card
    |  user types answer, REST POST via WSS -> Tunnel Manager -> Dispatch server
    v
Dispatch REST handler writes answer to PocketBase task_clarifications (status: "answered")
    |  (PocketBase realtime subscription inside anyclaw_ask_user)
    v
anyclaw_ask_user() resolves with the answer text, MCP tool returns to agent
    |
    v
Agent continues its reasoning loop
```

All hops inside the host are loopback. Only the user-facing hop goes through the tunnel.

### 6.3 PocketBase Collections for Task State

```typescript
// Collection: tasks
{
  id: string;              // PocketBase auto-ID
  taskId: string;          // AnyClaw UUID (indexed, unique)
  request: string;
  state: TaskState;
  adapterType: string;     // "openclaw" | "claude-code" | "webhook"
  adapterRef: string;
  progressSummary?: string;
  versionDescription?: string;
  error?: string;
  seq: number;

  // --- Resume state ---
  sessionId?: string;      // Agent session ID for resume
  systemContext: string;   // JSON-serialized SystemContext used at dispatch time
  conversationHistory?: string;  // JSON array of completed Q&A pairs
  lastCheckpoint?: string;

  createdAt: string;
  updatedAt: string;
}

// Collection: task_clarifications
{
  id: string;
  taskId: string;
  question: string;
  answer?: string;
  status: "pending" | "answered";
  createdAt: string;
  updatedAt: string;
}

// Collection: task_activity_log
{
  id: string;
  taskId: string;
  message: string;
  type: "info" | "tool_use" | "warning" | "error";
  seq: number;
  createdAt: string;
}

// Collection: task_queue
// Single active task + queue (locked decision).
{
  id: string;
  taskId: string;
  priority: number;        // lower = higher priority
  position: number;        // queue order
  createdAt: string;
}
```

The mobile app subscribes to PocketBase realtime on the `tasks` collection (filtered by `taskId`) through the tunnel. PocketBase Realtime SSE + REST is the sole mobile<->server mechanism (locked decision). Task state survives app close/reopen.

### 6.4 Push Notifications for Clarification

When a task enters `clarifying` state, the dispatch server sends a push notification to the mobile app:

```typescript
if (newStatus.state === "clarifying" && newStatus.question) {
  await sendNotification("Agent has a question", newStatus.question);
}
```

### 6.5 Task Persistence and Resume After Restart

**Locked decision:** Task state is persisted to PocketBase with enough context to resume after the dispatch/MCP server restarts. Since the dispatch server is supervised (`restart=always`) it may restart independently from PocketBase or the tunnel manager.

#### What Gets Persisted

1. **Task request** -- original user request.
2. **System context** -- cwd, MCP endpoint URL, allowed tools. JSON.
3. **Session ID** -- agent session identifier (Claude Code session, OpenClaw run ID, webhook task ID).
4. **Conversation history** -- completed clarification Q&A pairs.
5. **Last checkpoint** -- adapter-specific.

#### Resume Protocol on Startup

When the dispatch server starts, the AdapterManager runs:

```typescript
class AdapterManager {
  async onStartup(): Promise<void> {
    const pb = getPocketBase();

    // Any tasks that were in progress when the dispatch server was killed
    // still have their agent child processes gone -- they died with us.
    const activeTasks = await pb.collection("tasks").getFullList({
      filter: 'state != "done" && state != "failed" && state != "cancelled"'
    });

    for (const task of activeTasks) {
      if (task.state === "queued") continue;  // just re-enter the queue

      if (task.state === "clarifying") {
        const pending = await pb.collection("task_clarifications").getFullList({
          filter: `taskId = "${task.taskId}" && status = "pending"`
        });
        if (pending.length === 0) {
          // Answer arrived while we were down. Resume.
          await this.resumeTask(task);
        }
        // else: still waiting on the user. Mobile app will see it on reconnect.
        continue;
      }

      // state === "working" or "deploying"
      if (task.sessionId) {
        try {
          await this.resumeTask(task);
        } catch (err) {
          await pb.collection("tasks").update(task.id, {
            state: "failed",
            error: `Failed to resume after restart: ${err}`
          });
        }
      } else {
        await pb.collection("tasks").update(task.id, {
          state: "failed",
          error: "Dispatch server restarted and task could not be resumed (no session ID)."
        });
      }
    }

    this.processQueue();
  }

  private async resumeTask(task: TaskRecord): Promise<void> {
    const systemContext: SystemContext = JSON.parse(task.systemContext);
    switch (task.adapterType) {
      case "claude-code": {
        const adapter = this.adapter as ClaudeCodeAdapter;
        await adapter.resumeTask(task.taskId, task.sessionId!, systemContext, this.createSignal(task.taskId));
        break;
      }
      case "openclaw": {
        const adapter = this.adapter as OpenClawAdapter;
        await adapter.reconnectToRun(task.taskId, task.sessionId!);
        break;
      }
      case "webhook": {
        const adapter = this.adapter as WebhookAdapter;
        await adapter.notifyResume(task.taskId);
        break;
      }
    }
  }
}
```

#### Resume Behavior Per Adapter

| Adapter | Resume mechanism | What the agent sees |
|---------|-----------------|---------------------|
| **Claude Code** | Spawn a fresh child with `claude -p --resume <sessionId>`. Claude Code's session directory `~/.claude/` lives on the host and is untouched by the dispatch-server restart. | Agent continues from where it left off. If it was mid-tool-call, the tool result may be lost and the agent retries the call. |
| **OpenClaw** | Reconnect WebSocket to the OpenClaw process (still running on localhost if it's its own supervised process), re-subscribe to the existing `runId`. | If OpenClaw also restarted and lost the session, re-dispatch with conversation history prepended. |
| **Webhook** | POST `{ taskId, action: "resume" }` to the configured dispatch URL. | External agent handles its own resume logic. |

#### Edge Cases

- **Resume fails:** Mark the task as `failed` with an explanatory error. User can retry from the mobile app.
- **Agent was mid-deployment:** `anyclaw_deploy` is idempotent. Safe to retry.
- **Answer arrived during downtime:** The answer record is in PocketBase. On resume, the freshly-spawned `anyclaw_ask_user` handler finds the answered record immediately.

---

## 7. REST API for Task Dispatch

The dispatch/MCP server exposes these endpoints for the mobile app (reachable via the WSS tunnel):

```typescript
// POST /api/tasks                         submit new task
// GET  /api/tasks/:taskId                 get current status
// POST /api/tasks/:taskId/answer          answer a clarifying question
// POST /api/tasks/:taskId/cancel          cancel a running task
// GET  /api/tasks/:taskId/activity        activity log (?sinceSeq=N)
// GET  /api/tasks                         list recent tasks
// GET  /api/adapter/health                adapter health probe
// GET  /api/adapter/config                current adapter config
// PUT  /api/adapter/config                switch adapter / update config

// Emergency endpoints (always available, even if the logic service is broken)
// POST /api/rollback                      emergency rollback
// POST /api/restart-app                   restart the logic service process
```

All endpoints require a PocketBase auth token in the `Authorization` header.

---

## 8. Adapter Selection and Configuration

Configuration is stored in PocketBase:

```typescript
// Collection: settings (singleton)
{
  activeAdapter: "openclaw" | "claude-code" | "webhook";
  openclawConfig?: {
    gatewayUrl: string;            // default "ws://127.0.0.1:18789"
    gatewayToken: string;          // encrypted at rest
    workspace: string;
  };
  claudeCodeConfig?: {
    executablePath?: string;       // default "claude"
    model?: string;
    maxBudgetUsd: number;          // default 5.00
    apiKey: string;                // encrypted at rest
  };
  webhookConfig?: {
    dispatchUrl: string;
    callbackBaseUrl: string;
    authHeader?: string;           // encrypted at rest
  };
  dispatch: {
    maxTaskDurationMs: number;            // default 900000
    stallTimeoutMs: number;               // default 120000
    clarificationTimeoutMode: "best_judgment" | "pause_indefinitely";
    clarificationTimeoutMs: number;       // default 300000
    cpuLimitPercent: number;              // default 200 (2 cores worth)
    memoryLimitMb: number;                // default 2048
  };
}

// Locked decision: all secrets are encrypted with AES-256-GCM at rest.
// Encryption key management is covered in Plan 1.
```

The AdapterManager instantiates the appropriate adapter on startup:

```typescript
class AdapterManager {
  private adapter: AgentAdapter;

  constructor(private pb: PocketBase) {}

  async initialize(): Promise<void> {
    const settings = await this.pb.collection("settings").getFirstListItem("");
    this.adapter = this.createAdapter(settings);
    await this.onStartup();  // resume any in-flight tasks
  }

  private createAdapter(settings: Settings): AgentAdapter {
    switch (settings.activeAdapter) {
      case "openclaw":
        return new OpenClawAdapter({
          gatewayUrl: settings.openclawConfig!.gatewayUrl,
          token: decrypt(settings.openclawConfig!.gatewayToken),
          workspace: settings.openclawConfig!.workspace,
        });
      case "claude-code":
        return new ClaudeCodeAdapter({
          executablePath: settings.claudeCodeConfig?.executablePath ?? "claude",
          model: settings.claudeCodeConfig?.model,
          maxBudgetUsd: settings.claudeCodeConfig?.maxBudgetUsd ?? 5.0,
          applyResourceLimits: this.resourceLimiter.apply.bind(this.resourceLimiter),
        });
      case "webhook":
        return new WebhookAdapter({
          ...settings.webhookConfig!,
          authHeader: settings.webhookConfig?.authHeader
            ? decrypt(settings.webhookConfig.authHeader)
            : undefined,
        });
      default:
        throw new Error(`Unknown adapter: ${settings.activeAdapter}`);
    }
  }
}
```

---

## 9. Generic Webhook Adapter

For agents without a subprocess interface or native SDK:

```typescript
class WebhookAdapter implements AgentAdapter {
  readonly name = "Webhook";

  constructor(private config: {
    dispatchUrl: string;
    callbackBaseUrl: string;
    authHeader?: string;
  }) {}

  async dispatch(
    taskId: string,
    request: string,
    systemContext: SystemContext,
    signal: AbortSignal
  ): Promise<TaskHandle> {
    const res = await fetch(this.config.dispatchUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(this.config.authHeader ? { Authorization: this.config.authHeader } : {})
      },
      body: JSON.stringify({
        taskId,
        request,
        callbackUrl: `${this.config.callbackBaseUrl}/api/webhook/callback`,
        mcpEndpointUrl: systemContext.mcpEndpointUrl,
        cwd: systemContext.cwd
      }),
      signal
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

  async answerQuestion(handle: TaskHandle, answer: string): Promise<void> {
    // Answers are written to PocketBase by the REST API.
    // The external agent picks them up via the anyclaw_ask_user MCP tool.
  }

  async cancel(handle: TaskHandle): Promise<void> {
    await fetch(this.config.dispatchUrl, {
      method: "DELETE",
      headers: {
        "Content-Type": "application/json",
        ...(this.config.authHeader ? { Authorization: this.config.authHeader } : {})
      },
      body: JSON.stringify({ taskId: handle.taskId })
    }).catch(() => {});
  }

  // healthCheck, dispose, subscribe use PocketBase-based patterns
}
```

**Webhook callback contract:**

```typescript
// POST /api/webhook/callback
{
  taskId: string;
  event: "progress" | "clarifying" | "deploying" | "done" | "failed";
  progressSummary?: string;
  question?: string;
  versionDescription?: string;
  error?: string;
}
```

---

## 10. Technical Decisions (Resolved)

All open decisions from the original draft have been resolved per the locked decisions in the main spec.

| # | Decision | Resolution | Notes |
|---|----------|-----------|-------|
| 1 | Concurrent task limit | **Single active task + queue.** Designed with task isolation for future parallelization. | `task_queue` collection in Section 6.3. |
| 2 | Clarification timeout | **User-configurable:** `best_judgment` (default 5 min) or `pause_indefinitely`. | Section 6.1. |
| 3 | API key storage | **Encrypted in PocketBase** (AES-256-GCM) for both self-hosted and cloud. | Section 8. |
| 4 | Claude Code adapter approach | **CLI `-p` mode for MVP.** | Section 4. |
| 5 | Task persistence across restart | **Persist + resume.** Claude Code `--resume`, OpenClaw re-subscribe, webhook notify. | Section 6.5. |
| 6 | Process model | **Supervised processes, no containers.** Dispatch/MCP server is a supervised process; agent is a transient child with cgroup/JobObject limits; workspace is `dev/` on the host filesystem. | Section 1, Section 4. |
| 7 | Agent execution location | **Agent runs as a transient child process of the dispatch/MCP server**, with `cwd=dev/`, loopback MCP, and per-task resource limits. Its own file tools operate natively on `dev/`. | Sections 1 and 4. |

---

## New Gaps

These are the open questions that remain after folding in the supervised-process architecture. The pre-existing container-era gaps (cross-container process spawning, Docker socket access, sandbox volume sharing, Claude Code session volume layout) are resolved by the new model and have been removed.

### Gap 1: cgroup / JobObject provisioning across platforms

The adapter relies on a per-task resource-limit handle passed via `SystemContext.resourceLimitHandle`. The dispatch server must create these limits portably.

**Question:** What is the concrete `applyResourceLimits(pid, handle)` implementation on each host platform?

**Options:**
- (A) **Linux cgroup v2:** dispatch server creates `/sys/fs/cgroup/anyclaw/task-<taskId>` at startup, writes `cpu.max` and `memory.max`, and writes the child PID to `cgroup.procs` immediately after spawn. Requires cgroup v2 delegation (e.g., running under a systemd user slice).
- (B) **Linux cgroup via systemd-run:** instead of spawning `claude` directly, spawn `systemd-run --user --scope -p CPUQuota=200% -p MemoryMax=2G claude ...`. No manual cgroup plumbing, but adds a dependency on systemd and a shell wrapper.
- (C) **Windows Job Objects:** create a Job Object with `JOB_OBJECT_LIMIT_JOB_MEMORY` and `JOB_OBJECT_LIMIT_PROCESS_TIME`, assign the child PID with `AssignProcessToJobObject`. Requires a small native addon or `ffi-napi` binding because Node doesn't expose this.
- (D) **macOS:** no real cgroup equivalent. Fall back to `ulimit`/`setrlimit` via a shell preload (`sh -c 'ulimit -v 2097152; exec claude ...'`) plus wall-clock timeouts. Accept weaker enforcement on macOS.

### Gap 2: MCP endpoint authentication on loopback

The dispatch/MCP server hosts the MCP HTTP/SSE endpoint on `127.0.0.1`. The agent child process connects back to it. Anything else on the host that can open a loopback socket could also connect.

**Question:** How does the MCP endpoint authenticate the agent child process?

**Options:**
- (A) **Per-task bearer token.** Adapter generates a random token per task, injects it into the per-task MCP config file and the child env, and the MCP server validates it on every request. Token is revoked when the task completes.
- (B) **PID-gated unix socket.** On Linux/macOS, host the MCP endpoint on a unix socket in `.anyclaw/mcp.sock` and check `SO_PEERCRED` / `LOCAL_PEERPID` against the known child PID. More secure, no token handling, but Windows needs a named pipe fallback.
- (C) **Both.** Unix socket + token for defence in depth.

### Gap 3: Task workspace isolation for future parallelism

Locked decision: single task + queue today, but "design with task isolation for future parallelization." Today all tasks share `dev/` sequentially.

**Question:** What is the isolation boundary when we later allow concurrent tasks?

**Options:**
- (A) **Git worktree per task.** Each concurrent task gets its own worktree (`dev-task-<id>/`) pointing at the same repo. On success, merge back into the canonical `dev/`. Pro: natural git semantics, independent working trees. Con: merge conflicts possible.
- (B) **Copy-on-write snapshots.** Use `cp --reflink` (Linux btrfs/xfs) or APFS clones (macOS) to snapshot `dev/` per task. Fast, space-efficient. Con: not portable to all filesystems.
- (C) **Locked sequential.** Keep single-task forever; never parallelize. Simplest but limits future scale.

MVP ships with (C). (A) is the intended future path.

### Gap 4: OpenClaw gateway restart while a task is mid-flight

The OpenClaw process is a separate supervised process. It can crash and restart independently of the dispatch server.

**Question:** How does the OpenClaw adapter handle OpenClaw itself restarting during a task?

**Options:**
- (A) **Replay conversation.** Persist the full conversation (request + Q&A history) in PocketBase. On detecting a dropped WebSocket, re-dispatch the original request with the Q&A prepended as context. Reliable but burns tokens re-doing partial work.
- (B) **Gateway-side persistence.** Rely on OpenClaw's own session store. On reconnect, re-subscribe to the existing `runId`. Depends on OpenClaw gateway capabilities.
- (C) **Mark failed, user retries.** Simplest, honest, frustrating for long nearly-done tasks.

### Gap 5: Queue starvation and stall detection

With a single active task, a stuck agent blocks all other queued tasks until the `maxTaskDurationMs` hard timeout fires (default 15 min).

**Question:** Should the dispatch server detect stalls earlier using `stallTimeoutMs` (default 2 min of no status updates) and force-cancel?

**Options:**
- (A) **Yes, aggressive.** If no `TaskStatus` update arrives for `stallTimeoutMs`, force-cancel and mark failed with "agent stalled." Pro: protects the queue. Con: may kill legitimately long-running work that just happens to be quiet (e.g., a long `vite build`).
- (B) **Yes, with MCP heartbeat.** Require the agent skill to periodically call `anyclaw_update_progress`. If no heartbeat arrives for `stallTimeoutMs`, force-cancel. Pro: distinguishes "agent is working" from "agent is hung." Con: depends on skill cooperation.
- (C) **No, rely on hard timeout only.** Simplest. Accept worst-case 15-minute delays on stuck tasks.
