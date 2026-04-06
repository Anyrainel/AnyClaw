# Plan 3: Agent Dispatch Layer -- Design Document

**Goal:** Define the pluggable adapter layer that lets the AnyClaw mobile app submit work requests to the user's coding agent, relay clarifying questions back to the user, and report progress/completion/failure. The adapter is agent-agnostic: initial implementations cover OpenClaw and Claude Code, with a generic webhook adapter for future agents (Codex, Aider, Gemini CLI, etc.).

**Depends on:** Plan 1 (Server Infrastructure) for PocketBase runtime and Node.js logic service.

---

## 1. Where the Adapter Runs

The adapter runs **on the user's server**, inside the **control plane container** -- not in the mobile app, not in the broker, and not in the app server container.

**Three-container architecture (locked decision):**

1. **App server container** -- serves the agent-built frontend + PocketBase to the mobile WebView. Can be restarted/stopped by the user or agent.
2. **Control plane container** -- health checks, restart API, **agent task dispatch API**, all static (non-agent-modifiable) endpoints. Always available, even if the app server is down. The agent dispatch layer lives here.
3. **Sandbox container** -- command execution environment for the coding agent. The agent (Claude Code, OpenClaw) is spawned from the control plane and executes code in the sandbox via MCP tools.

**Rationale for control plane placement:**

- The adapter must be able to spawn and manage the coding agent. The control plane can reach the sandbox container over the Docker network.
- The adapter manages long-running processes (agent sessions can run for minutes). The control plane stays online even if the app server restarts; the mobile app can disconnect and reconnect without losing task state.
- Placing the adapter in the control plane (not the app server) means the user can always reach their agent and submit tasks, even if the app server is down or being redeployed by the agent.
- The broker is a thin signaling relay. Putting dispatch logic there would make it stateful, expensive, and a single point of failure.

**Communication path:**

```
Mobile App  --[WSS tunnel]--> Control Plane Container
                                  |
                                  +--> AdapterManager (picks the right adapter)
                                  |        |
                                  |        +--> OpenClawAdapter --[WS]--> OpenClaw Gateway :18789
                                  |        +--> ClaudeCodeAdapter --[subprocess]--> claude CLI
                                  |        |      (spawned in sandbox container)
                                  |        +--> WebhookAdapter --[HTTP]--> user-configured URL
                                  |
                                  +--> PocketBase (task state persistence, in app server container)
```

The mobile app talks to the control plane over the existing WSS tunnel (established via the broker). The control plane exposes a task dispatch API (REST + realtime SSE via PocketBase). PocketBase runs in the app server container; the control plane connects to it over the Docker network. The adapter translates between AnyClaw's task protocol and the specific agent's protocol.

---

## 2. Adapter Interface

### 2.1 Core Types

```typescript
// --- Task identity ---

/** Opaque handle returned by dispatch(). Adapters define the internal shape. */
type TaskHandle = {
  taskId: string;           // AnyClaw-assigned UUID
  adapterRef: string;       // Adapter-specific reference (e.g., session ID, run ID)
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
  | "AGENT_UNREACHABLE"     // cannot connect to agent gateway/process
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
   * native protocol and starts the agent session.
   *
   * @param taskId - AnyClaw-assigned UUID for this task.
   * @param request - The user's natural-language feature request.
   * @param systemContext - Injected instructions (skill refs, MCP config path).
   * @param signal - AbortSignal for cancellation. When aborted, the adapter
   *                 MUST attempt to stop the agent and resolve the promise
   *                 with state "cancelled". Timeout is enforced by the caller.
   * @returns The initial TaskStatus (typically state "queued" or "working").
   * @throws AdapterError on connection/auth failures.
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
   * Request cancellation. The adapter should attempt a graceful stop.
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
   * Tear down any persistent connections (WebSocket, subprocess).
   * Called on server shutdown.
   */
  dispose(): Promise<void>;
}

interface SystemContext {
  /** Absolute path to the AnyClaw project's dev workspace. */
  cwd: string;
  /** Path to the MCP server config (for agents that accept --mcp-config). */
  mcpConfigPath: string;
  /** System prompt additions that instruct the agent to use AnyClaw tools. */
  systemPrompt: string;
  /** List of MCP tools the agent is allowed to call without permission prompts. */
  allowedTools: string[];
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
        this.buildSystemContext(),
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

OpenClaw's gateway listens on `ws://127.0.0.1:18789` (configurable via `OPENCLAW_GATEWAY_PORT`). The protocol is WebSocket with text frames containing JSON payloads. Protocol version 3.

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
    token: string;        // OPENCLAW_GATEWAY_TOKEN
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
    // to use anyclaw_* MCP tools.
    const res = await this.rpc("chat.send", {
      workspace: this.config.workspace,
      message: {
        role: "user",
        content: request
      },
      idempotencyKey: taskId,
      // Metadata lets us correlate gateway events back to our taskId
      metadata: { anyClawTaskId: taskId }
    }, signal);

    return {
      taskId,
      adapterRef: res.runId  // gateway-assigned run identifier
    };
  }

  async *subscribe(handle: TaskHandle, signal: AbortSignal): AsyncIterable<TaskStatus> {
    await this.ensureConnected();
    let seq = 0;

    // Subscribe to session events for this run
    await this.rpc("sessions.subscribe", {
      runId: handle.adapterRef
    }, signal);

    // Yield statuses as gateway events arrive
    const statusQueue = new AsyncQueue<TaskStatus>();

    const onEvent = (payload: any) => {
      // Map OpenClaw gateway events to AnyClaw TaskStatus
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
    await this.rpc("chat.send", {
      workspace: this.config.workspace,
      message: { role: "user", content: answer },
      parentRunId: handle.adapterRef
    }, AbortSignal.timeout(10_000));
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

    // Handle the connect.challenge / connect handshake
    await this.performHandshake();

    // Route incoming frames to pending RPCs or event listeners
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

    // Detect clarifying questions: the agent calls anyclaw_ask_user MCP tool
    if (payload.type === "tool_call" && payload.tool === "anyclaw_ask_user") {
      return {
        state: "clarifying",
        question: payload.args?.question,
        seq, updatedAt: now
      };
    }

    // Detect deployment
    if (payload.type === "tool_call" && payload.tool === "anyclaw_deploy") {
      return {
        state: "deploying",
        progressSummary: "Running validation and deploying...",
        seq, updatedAt: now
      };
    }

    // Detect progress updates via anyclaw_update_progress
    if (payload.type === "tool_call" && payload.tool === "anyclaw_update_progress") {
      return {
        state: "working",
        progressSummary: payload.args?.message,
        seq, updatedAt: now
      };
    }

    // Detect completion
    if (payload.type === "run_complete") {
      return payload.status === "success"
        ? { state: "done", versionDescription: payload.summary, seq, updatedAt: now }
        : { state: "failed", error: payload.error, seq, updatedAt: now };
    }

    return null;
  }

  // (addEventListener, removeEventListener, performHandshake elided for brevity)
  private addEventListener(event: string, fn: (p: any) => void) {
    if (!this.eventListeners.has(event)) this.eventListeners.set(event, new Set());
    this.eventListeners.get(event)!.add(fn);
  }
  private removeEventListener(event: string, fn: (p: any) => void) {
    this.eventListeners.get(event)?.delete(fn);
  }
  private async performHandshake(): Promise<void> {
    // Wait for connect.challenge event
    const challenge = await new Promise<any>((resolve) => {
      this.addEventListener("connect.challenge", resolve);
    });
    // Send connect request
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
2. The agent's reasoning loop runs. If the agent calls the `anyclaw_ask_user` MCP tool, the tool handler (in the AnyClaw MCP server) writes the question to PocketBase and blocks.
3. The adapter detects the `session.tool` event for `anyclaw_ask_user` and yields a `TaskStatus` with `state: "clarifying"`.
4. The mobile app shows the question. When the user replies, the mobile app calls the dispatch API, which calls `adapter.answerQuestion()`.
5. `answerQuestion()` writes the answer to PocketBase. The `anyclaw_ask_user` MCP tool handler (which has been polling or subscribed to PocketBase realtime) picks up the answer and returns it to the agent.
6. The agent continues its reasoning loop.

This design means clarification works identically for every adapter: the `anyclaw_ask_user` MCP tool is the universal mechanism. The adapter-specific part is only how the adapter *detects* that the tool was called (OpenClaw: gateway events; Claude Code: subprocess stream; Webhook: callback POST).

---

## 4. Claude Code Adapter

### 4.1 Approach: CLI `-p` Mode (Locked Decision)

The Claude Code adapter uses the CLI's `-p` (print) mode for MVP. This spawns `claude -p` as a subprocess with the user's request as the prompt. The process runs to completion and exits.

**Why CLI `-p` over the TypeScript SDK:** The `-p` flag is simpler to implement and debug. All clarification goes through the `anyclaw_ask_user` MCP tool (which blocks inside the MCP server, not in the adapter), so the SDK's multi-turn `AsyncIterable<SDKUserMessage>` capability is not needed. The adapter's job is to spawn, monitor, and kill a subprocess. Upgrade to the TypeScript SDK (`@anthropic-ai/claude-agent-sdk`) later if richer lifecycle control is needed (e.g., user wants to steer the agent mid-task beyond answering questions).

**Subprocess execution model:** The control plane spawns the `claude` CLI process, but the agent executes its file operations and shell commands inside the **sandbox container** via MCP tools. The control plane does NOT give the claude process direct access to the app server filesystem. The MCP tools (`anyclaw_read_file`, `anyclaw_write_file`, `anyclaw_run_dev`) proxy all operations into the sandbox.

### 4.2 Implementation

```typescript
import { spawn, ChildProcess } from "child_process";

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
    const args = [
      "-p", request,
      "--output-format", "stream-json",
      "--mcp-config", systemContext.mcpConfigPath,
      "--allowedTools", systemContext.allowedTools.join(","),
      "--max-budget", String(this.config.maxBudgetUsd),
    ];

    if (this.config.model) {
      args.push("--model", this.config.model);
    }

    // Retrieve API key from PocketBase (encrypted storage)
    const apiKey = await this.getApiKey();

    const proc = spawn(this.config.executablePath, args, {
      cwd: systemContext.cwd,
      env: {
        ...process.env,
        ANTHROPIC_API_KEY: apiKey,
        ANYCLAW_TASK_ID: taskId,
      },
      signal
    });

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

    // Parse the stream-json stdout in the background
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
    // In CLI -p mode, clarification is handled entirely by the
    // anyclaw_ask_user MCP tool. The adapter does not need to inject
    // messages into the subprocess. The MCP tool writes the question
    // to PocketBase, the mobile app writes the answer back, and the
    // MCP tool picks it up via PocketBase realtime subscription.
    // No adapter-specific action needed.
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

        // Capture session ID for resume capability
        if (event.type === "system" && event.session_id) {
          session.sessionId = event.session_id;
          // Persist session ID to PocketBase for resume after restart
          await this.persistSessionId(taskId, event.session_id);
        }
      }

      // Process exited -- check exit code
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
      // Persist final state to PocketBase
      await this.persistTaskState(taskId, session.status);
      // Clean up after terminal state, but keep status accessible for 5 min
      setTimeout(() => this.activeProcesses.delete(taskId), 5 * 60 * 1000);
    }
  }

  private updateStatusFromStreamEvent(taskId: string, event: any): void {
    const session = this.activeProcesses.get(taskId);
    if (!session) return;
    const now = new Date().toISOString();
    const seq = ++session.status.seq;

    // Detect MCP tool calls in the stream-json output
    if (event.type === "assistant" && event.message?.content) {
      for (const block of event.message.content) {
        if (block.type === "tool_use") {
          if (block.name === "anyclaw_ask_user") {
            session.status = {
              state: "clarifying",
              question: block.input?.question,
              seq, updatedAt: now
            };
            return;
          }
          if (block.name === "anyclaw_deploy") {
            session.status = {
              state: "deploying",
              progressSummary: "Running validation and deploying...",
              seq, updatedAt: now
            };
            return;
          }
          if (block.name === "anyclaw_update_progress") {
            session.status = {
              state: "working",
              progressSummary: block.input?.message,
              seq, updatedAt: now
            };
            return;
          }
        }
      }
    }

    if (event.type === "result") {
      session.status = {
        state: "done",
        versionDescription: event.result,
        seq, updatedAt: now
      };
    }
  }

  /**
   * Resume a task after server restart.
   * Uses Claude Code's --resume flag with the persisted session ID.
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
      },
      signal
    });

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
    // Retrieve encrypted API key from PocketBase settings collection
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

**CLI `-p` mode (locked decision).** The adapter spawns `claude -p <request>` as a subprocess with `--output-format stream-json` for progress tracking. This is simpler than the TypeScript SDK and sufficient for MVP because all clarification is handled by the `anyclaw_ask_user` MCP tool (blocking inside the MCP server process, not the adapter).

**Sandbox execution.** The `claude` process is spawned from the control plane but its file operations and shell commands execute in the sandbox container via MCP tools. The `cwd` in `SystemContext` points to the sandbox workspace mount.

**Budget cap: `maxBudgetUsd`.** Passed via `--max-budget`. Prevents runaway token spend. Default $5 per task.

**MCP server injection.** The adapter passes `--mcp-config` pointing to the AnyClaw MCP server configuration. The MCP tools are pre-listed in `--allowedTools` so the agent can call them without permission prompts.

**Task state persistence and resume (locked decision).** The adapter persists the Claude Code session ID to PocketBase as soon as it appears in the stream-json output. On server restart, the AdapterManager queries PocketBase for any tasks in a non-terminal state and calls `resumeTask()` with the persisted session ID. Claude Code's `--resume <sessionId>` flag restores the agent's conversation context and continues where it left off. See Section 6.5 for the full resume protocol.

**API key from PocketBase (locked decision).** The `ANTHROPIC_API_KEY` is stored encrypted in PocketBase (not in environment variables). The adapter decrypts it at dispatch time and passes it to the subprocess environment. This enables the mobile app settings screen to manage keys consistently across self-hosted and cloud deployments.

### 4.4 Authentication

Claude Code authenticates via the `ANTHROPIC_API_KEY` environment variable, which the adapter injects into the subprocess from the encrypted PocketBase store. No browser OAuth flow is needed. The user configures this key through the mobile app settings screen or during initial AnyClaw setup.

---

## 5. Non-Interactive Mode Patterns for Other Agents

### 5.1 Codex CLI (OpenAI)

Codex CLI supports non-interactive execution via the `codex exec` subcommand (alias `codex e`):

```bash
codex exec "Add a mood tracker page with trend charts" \
  --approval-mode full-auto \
  --jsonl
```

Key flags:
- `codex exec`: runs a single session to completion without user interaction
- `--approval-mode full-auto`: auto-approves all tool calls
- `--jsonl`: outputs newline-delimited JSON events to stdout (parseable for progress tracking)
- Environment: `CODEX_QUIET_MODE=1` suppresses interactive UI prompts

**Adapter strategy:** Spawn `codex exec` as a subprocess. Parse the JSONL stdout stream for progress events. Clarification is handled via the `anyclaw_ask_user` MCP tool (Codex supports MCP). Cancellation via `SIGTERM` on the subprocess.

**Known limitation:** The `--yes` / quiet mode has reported issues where certain prompts (e.g., git warnings) can still block the subprocess. The adapter should set a stall timeout and kill the process if no output arrives within the deadline.

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
        ANYCLAW_TASK_ID: taskId
      },
      signal
    });

    // Store proc reference for status tracking and cancellation
    this.activeProcesses.set(taskId, proc);
    return { taskId, adapterRef: taskId };
  }
  // subscribe() parses proc.stdout JSONL stream
  // cancel() sends SIGTERM to proc
  // answerQuestion() writes to PocketBase; anyclaw_ask_user MCP tool polls for it
}
```

### 5.2 Aider

Aider supports non-interactive execution via the `--message` flag combined with `--yes`:

```bash
aider --message "Add a mood tracker page" --yes --no-auto-commits
```

Key flags:
- `--message` / `-m`: single message, process reply, then exit
- `--yes`: auto-confirm all prompts
- `--no-auto-commits`: let AnyClaw's deploy pipeline handle commits
- Environment: `AIDER_YES=true`, `AIDER_MESSAGE="..."`

**Adapter strategy:** Spawn `aider` as a subprocess with `--message`. Aider does not currently support MCP, so clarification via `anyclaw_ask_user` requires a workaround: the adapter would need to run aider in a loop, checking for questions in its stdout output.

**Limitation:** Aider's `--message` mode runs a single prompt and exits. Multi-turn clarification within a single aider session is not supported in non-interactive mode. The adapter would need to:
1. Run the first prompt with `--message`.
2. If the output contains a question pattern, surface it to the user.
3. Run a second `aider --message <answer> --yes` in the same repo.

This is less seamless than OpenClaw or Claude Code but functional for simple tasks.

### 5.3 Gemini CLI

Google's Gemini CLI supports non-interactive mode:

```bash
gemini -p "Add a mood tracker page" --non-interactive
```

Adapter strategy would follow the same subprocess + stdout parsing pattern as Codex.

### 5.4 Generic Pattern

All non-interactive agents follow the same adapter skeleton:

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
      cwd: systemContext.cwd,
      env: { ...process.env, ...env },
      signal
    });
    this.activeProcesses.set(taskId, proc);
    return { taskId, adapterRef: taskId };
  }

  async cancel(handle: TaskHandle): Promise<void> {
    const proc = this.activeProcesses.get(handle.taskId);
    if (proc && !proc.killed) {
      proc.kill("SIGTERM");
      // Force kill after 5s if still alive
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

The clarification relay is the hardest part of the dispatch layer. The agent is server-side, the user is on a phone, and there may be seconds of network latency between them.

### 6.1 The Universal Mechanism: `anyclaw_ask_user` MCP Tool

Regardless of which adapter is active, the agent asks clarifying questions by calling the `anyclaw_ask_user` MCP tool. This tool is provided by the AnyClaw MCP server (which runs on the same server as the adapter).

The MCP tool does NOT communicate directly with the mobile app. Instead, it writes to PocketBase and waits for an answer:

```typescript
// Inside the AnyClaw MCP server
const askUserTool = tool(
  "anyclaw_ask_user",
  "Ask the user a clarifying question and wait for their answer",
  {
    question: z.string().describe("The question to ask the user"),
    taskId: z.string().optional().describe("Task ID (injected from env if omitted)")
  },
  async ({ question, taskId: explicitTaskId }) => {
    const taskId = explicitTaskId ?? process.env.ANYCLAW_TASK_ID;
    if (!taskId) throw new Error("No task ID available");

    const pb = getPocketBase();

    // Write the question to the task_clarifications collection
    const record = await pb.collection("task_clarifications").create({
      taskId,
      question,
      status: "pending",   // pending | answered
      answer: null
    });

    // Wait for the answer (with user-configurable timeout behavior)
    const settings = await pb.collection("settings").getFirstListItem("");
    const timeoutMode = settings.dispatch?.clarificationTimeoutMode ?? "best_judgment";
    const timeoutMs = settings.dispatch?.clarificationTimeoutMs ?? 300_000; // default 5 min

    const answer = await waitForAnswer(pb, record.id, taskId, timeoutMs, timeoutMode);

    return {
      content: [{ type: "text", text: answer }]
    };
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
    // User-configurable timeout behavior (locked decision):
    // - "best_judgment": after timeoutMs (default 5 min), tell the agent to proceed
    // - "pause_indefinitely": no timeout, wait forever for user response
    const timer = timeoutMode === "pause_indefinitely"
      ? null  // no timer -- wait indefinitely
      : setTimeout(() => {
          unsubscribe();
          resolve("The user is unavailable. Use your best judgment and proceed.");
        }, timeoutMs);

    // PocketBase realtime subscription
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
Agent calls anyclaw_ask_user("Daily check-in or multiple times per day?")
    |
    v
AnyClaw MCP server writes question to PocketBase task_clarifications collection
    |
    v  (PocketBase SSE realtime)
Adapter detects the question (via gateway events or subprocess stream)
    |
    v
Adapter updates TaskStatus to { state: "clarifying", question: "..." }
    |
    v  (PocketBase SSE realtime to mobile app, via WSS tunnel)
Mobile app receives status update, shows question card
    |
    v  (user types answer, mobile app calls REST API)
Mobile app POSTs answer to /api/tasks/:taskId/answer
    |
    v
Logic service writes answer to PocketBase task_clarifications record (status: "answered")
    |
    v  (PocketBase realtime subscription in MCP tool)
anyclaw_ask_user() resolves with the answer text
    |
    v
Agent receives the answer and continues its reasoning loop
```

### 6.3 PocketBase Collections for Task State

```typescript
// Collection: tasks
{
  id: string;              // PocketBase auto-ID
  taskId: string;          // AnyClaw UUID (indexed, unique)
  request: string;         // original user request
  state: TaskState;
  adapterType: string;     // "openclaw" | "claude-code" | "webhook"
  adapterRef: string;
  progressSummary?: string;
  versionDescription?: string;
  error?: string;
  seq: number;

  // --- Resume state (locked decision: persist for restart recovery) ---
  sessionId?: string;      // Agent session ID for resume (Claude Code: session ID, OpenClaw: run ID)
  systemContext: string;    // JSON-serialized SystemContext used at dispatch time
  conversationHistory?: string;  // JSON-serialized array of clarification Q&A pairs completed so far
  lastCheckpoint?: string; // Adapter-specific checkpoint data (e.g., last tool call completed)

  createdAt: string;
  updatedAt: string;
}

// Collection: task_clarifications
{
  id: string;
  taskId: string;          // relation to tasks.taskId
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
// New tasks go to "queued" state. AdapterManager dequeues the next
// task when the active one reaches a terminal state.
{
  id: string;
  taskId: string;          // relation to tasks.taskId
  priority: number;        // lower = higher priority, default 0
  position: number;        // queue order (auto-increment)
  createdAt: string;
}
```

The mobile app subscribes to PocketBase realtime on the `tasks` collection (filtered by `taskId`) to get live status updates. PocketBase Realtime SSE + REST is the sole communication mechanism between the server and mobile app (locked decision). SSE for server-to-client push (progress, questions). REST POST for client-to-server (answers, commands). Task state survives app close/reopen -- the user can resume clarification questions.

### 6.5 Task Persistence and Resume After Restart

**Locked decision:** Task state is persisted to PocketBase with enough context to resume after a server restart.

#### What Gets Persisted

For each active task, the adapter persists to PocketBase:

1. **Task request** -- the original user request text (already stored at dispatch time).
2. **System context** -- the `SystemContext` used at dispatch time (cwd, MCP config path, system prompt, allowed tools). Serialized as JSON.
3. **Session ID** -- the agent's session identifier. For Claude Code, this is the session ID from the `--output-format stream-json` output. For OpenClaw, this is the gateway run ID. For webhooks, this is the external task ID.
4. **Conversation history** -- all completed clarification Q&A pairs. Stored as a JSON array of `{ question, answer }` objects.
5. **Last checkpoint** -- adapter-specific data about where the agent was. For Claude Code, the session ID is sufficient (Claude Code maintains its own conversation state on disk). For OpenClaw, the gateway maintains session state server-side.

#### Resume Protocol on Startup

When the control plane starts (or restarts), the AdapterManager runs this sequence:

```typescript
class AdapterManager {
  async onStartup(): Promise<void> {
    const pb = getPocketBase();

    // Find all tasks that were in a non-terminal state when the server stopped
    const activeTasks = await pb.collection("tasks").getFullList({
      filter: 'state != "done" && state != "failed" && state != "cancelled"'
    });

    for (const task of activeTasks) {
      if (task.state === "queued") {
        // Re-queue: these never started, just re-add to the queue
        continue;
      }

      if (task.state === "clarifying") {
        // Was waiting for user input. Check if answer arrived while server was down.
        const pending = await pb.collection("task_clarifications").getFullList({
          filter: `taskId = "${task.taskId}" && status = "pending"`
        });
        if (pending.length === 0) {
          // No pending questions -- answer was provided. Resume the agent.
          await this.resumeTask(task);
        } else {
          // Still waiting for user. Re-publish the question via SSE.
          // The mobile app will show it again when it reconnects.
          // No agent resume needed yet.
        }
        continue;
      }

      // state === "working" or "deploying"
      // Attempt to resume the agent session.
      if (task.sessionId) {
        try {
          await this.resumeTask(task);
        } catch (err) {
          // Resume failed -- mark as failed so user can retry
          await pb.collection("tasks").update(task.id, {
            state: "failed",
            error: `Failed to resume after restart: ${err}`
          });
        }
      } else {
        // No session ID -- cannot resume. Mark as failed.
        await pb.collection("tasks").update(task.id, {
          state: "failed",
          error: "Server restarted and task could not be resumed (no session ID)."
        });
      }
    }

    // Start processing the queue
    this.processQueue();
  }

  private async resumeTask(task: TaskRecord): Promise<void> {
    const systemContext: SystemContext = JSON.parse(task.systemContext);

    switch (task.adapterType) {
      case "claude-code": {
        const adapter = this.adapter as ClaudeCodeAdapter;
        await adapter.resumeTask(
          task.taskId,
          task.sessionId!,
          systemContext,
          this.createSignal(task.taskId)
        );
        break;
      }
      case "openclaw": {
        // OpenClaw gateway maintains session state server-side.
        // Reconnect to the gateway and re-subscribe to the existing run.
        const adapter = this.adapter as OpenClawAdapter;
        await adapter.reconnectToRun(task.taskId, task.sessionId!);
        break;
      }
      case "webhook": {
        // Webhook agents manage their own state. POST a resume signal.
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
| **Claude Code** | `claude -p --resume <sessionId>`. Claude Code restores conversation context from its local session storage (in the sandbox container's filesystem). | Agent continues from where it left off. If it was mid-tool-call, the tool result may be lost and the agent retries the tool call. |
| **OpenClaw** | Reconnect WebSocket to gateway, re-subscribe to `sessions.subscribe({ runId })`. Gateway keeps session state in memory/DB. | If the gateway also restarted, the session may be gone. Fall back to re-dispatching the original request with conversation history prepended. |
| **Webhook** | POST to dispatch URL with `{ taskId, action: "resume" }`. | External agent is responsible for its own resume logic. |

#### Edge Cases

- **Resume fails:** Mark the task as `failed` with an explanatory error. The user can retry from the mobile app, which re-dispatches the original request.
- **Agent was mid-deployment:** The `anyclaw_deploy` MCP tool is idempotent. If the agent resumes and calls deploy again, it re-runs validation and promotion. No double-deploy risk.
- **Answer arrived during downtime:** The clarification answer is in PocketBase. On resume, the `anyclaw_ask_user` MCP tool will find the answered record immediately and return it to the agent without blocking.

### 6.4 Push Notifications for Clarification

When the task enters `clarifying` state, the logic service sends a push notification to the mobile app:

```typescript
// In the AdapterManager, when status changes to "clarifying"
if (newStatus.state === "clarifying" && newStatus.question) {
  await sendNotification(
    "Agent has a question",
    newStatus.question
  );
}
```

This ensures the user sees the question even if the app is backgrounded.

---

## 7. REST API for Task Dispatch

The logic service exposes these endpoints for the mobile app:

```typescript
// POST /api/tasks
// Submit a new task
// Body: { request: string }
// Returns: { taskId: string, status: TaskStatus }

// GET /api/tasks/:taskId
// Get current task status
// Returns: TaskStatus

// POST /api/tasks/:taskId/answer
// Answer a clarifying question
// Body: { answer: string }
// Returns: { ok: true }

// POST /api/tasks/:taskId/cancel
// Cancel a running task
// Returns: { ok: true }

// GET /api/tasks/:taskId/activity
// Get activity log
// Query: ?sinceSeq=N
// Returns: ActivityEntry[]

// GET /api/tasks
// List recent tasks
// Query: ?limit=20&offset=0
// Returns: { tasks: TaskStatus[], total: number }

// GET /api/adapter/health
// Check adapter health
// Returns: { ok: boolean, adapter: string, detail?: string }

// GET /api/adapter/config
// Get current adapter configuration
// Returns: { adapter: "openclaw" | "claude-code" | "webhook", ... }

// PUT /api/adapter/config
// Switch adapter or update config
// Body: { adapter: "openclaw", token: "...", ... }
// Returns: { ok: true }
```

All endpoints require PocketBase auth token in the `Authorization` header (the mobile app authenticates with PocketBase during tunnel setup).

---

## 8. Adapter Selection and Configuration

The user configures which adapter to use during AnyClaw setup. The configuration is stored in PocketBase:

```typescript
// Collection: settings (singleton pattern -- one record)
{
  activeAdapter: "openclaw" | "claude-code" | "webhook";
  openclawConfig?: {
    gatewayUrl: string;            // default "ws://127.0.0.1:18789"
    gatewayToken: string;          // OPENCLAW_GATEWAY_TOKEN -- encrypted at rest in PocketBase
    workspace: string;             // workspace name
  };
  claudeCodeConfig?: {
    executablePath?: string;       // path to claude binary
    model?: string;                // model override
    maxBudgetUsd: number;          // default 5.00
    apiKey: string;                // ANTHROPIC_API_KEY -- encrypted at rest in PocketBase
  };
  webhookConfig?: {
    dispatchUrl: string;           // POST URL for task dispatch
    callbackBaseUrl: string;       // base URL the agent will POST back to
    authHeader?: string;           // optional auth header value -- encrypted at rest
  };
  dispatch: {
    maxTaskDurationMs: number;     // default 900000 (15 min)
    stallTimeoutMs: number;        // default 120000 (2 min)
    clarificationTimeoutMode: "best_judgment" | "pause_indefinitely";  // default: "best_judgment"
    clarificationTimeoutMs: number;  // default 300000 (5 min), only used in "best_judgment" mode
  };
}

// NOTE (locked decision): All API keys and tokens are stored encrypted in PocketBase,
// not in environment variables. This applies to both self-hosted and cloud deployments.
// The mobile app settings screen can manage keys in both modes via the REST API.
// Encryption uses application-level AES-256-GCM. The encryption key is derived from
// the PocketBase admin password (self-hosted) or a per-tenant secret (cloud).
```

The AdapterManager reads this config on startup and instantiates the appropriate adapter:

```typescript
class AdapterManager {
  private adapter: AgentAdapter;

  constructor(private pb: PocketBase) {}

  async initialize(): Promise<void> {
    const settings = await this.pb.collection("settings").getFirstListItem("");
    this.adapter = this.createAdapter(settings);
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

For agents that do not have a native TypeScript SDK or subprocess interface, the webhook adapter provides a simple HTTP contract:

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
        ...(this.config.authHeader
          ? { Authorization: this.config.authHeader }
          : {})
      },
      body: JSON.stringify({
        taskId,
        request,
        callbackUrl: `${this.config.callbackBaseUrl}/api/webhook/callback`,
        mcpServerCommand: `node ${systemContext.mcpConfigPath}`,
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

  // The webhook agent POSTs status updates back to /api/webhook/callback
  // The logic service receives these and writes to PocketBase.
  // subscribe() reads from PocketBase realtime (same as mobile app).

  async answerQuestion(handle: TaskHandle, answer: string): Promise<void> {
    // Answers are written to PocketBase by the REST API.
    // The agent picks them up via the anyclaw_ask_user MCP tool.
    // No adapter-specific action needed beyond the PocketBase write.
  }

  async cancel(handle: TaskHandle): Promise<void> {
    // Best-effort: POST to the dispatch URL with a cancel action
    await fetch(this.config.dispatchUrl, {
      method: "DELETE",
      headers: {
        "Content-Type": "application/json",
        ...(this.config.authHeader
          ? { Authorization: this.config.authHeader }
          : {})
      },
      body: JSON.stringify({ taskId: handle.taskId })
    }).catch(() => {}); // best effort
  }

  // healthCheck, dispose, subscribe use PocketBase-based patterns
}
```

**Webhook callback contract** (what the external agent POSTs back):

```typescript
// POST /api/webhook/callback
// Body:
{
  taskId: string;
  event: "progress" | "clarifying" | "deploying" | "done" | "failed";
  // For "progress":
  progressSummary?: string;
  // For "clarifying":
  question?: string;
  // For "done":
  versionDescription?: string;
  // For "failed":
  error?: string;
}
```

---

## 10. Technical Decisions (Resolved)

All open decisions from the original draft have been resolved per the locked decisions in the main spec. These are binding for implementation.

| # | Decision | Resolution | Notes |
|---|----------|-----------|-------|
| 1 | Concurrent task limit | **Single active task + queue.** Design with task isolation for future parallelization. User can submit while one is running; it queues and starts when the current one finishes. | `task_queue` collection added in Section 6.3. |
| 2 | Clarification timeout | **User-configurable.** Two modes: (a) "best_judgment" -- agent proceeds after timeout (default 5 min), (b) "pause_indefinitely" -- wait forever for user response. Configured in dispatch settings. | Updated `waitForAnswer()` in Section 6.1 and `dispatch` config in Section 8. |
| 3 | API key storage | **Encrypted in PocketBase for both self-hosted and cloud.** All API keys (ANTHROPIC_API_KEY, OPENCLAW_GATEWAY_TOKEN, webhook auth headers) are stored with AES-256-GCM encryption. Mobile app settings screen manages keys via REST. No environment variables for secrets. | Updated Section 8 config and adapter constructors. |
| 4 | Claude Code adapter approach | **CLI `-p` mode for MVP.** Simpler, clarification via MCP tool works fine. Upgrade to TypeScript SDK later if richer lifecycle control is needed. | Section 4 fully rewritten. |
| 5 | Task persistence across restart | **Persist task state and resume.** Adapter persists session ID, system context, and conversation history to PocketBase. On restart, attempt to resume via adapter-specific mechanism (Claude Code: `--resume`; OpenClaw: reconnect to run; Webhook: POST resume signal). Fall back to marking as failed if resume is not possible. | Section 6.5 added with full resume protocol. |

---

## New Gaps

These are new technical questions that emerged from integrating the locked decisions. Each needs resolution before implementation.

### Gap 1: Encryption key management for PocketBase secrets

All API keys are now stored encrypted in PocketBase (locked decision). The encryption key itself needs to come from somewhere.

**Question:** Where does the AES-256-GCM encryption key live, and how is it provisioned?

**Options:**
- (A) **Derived from PocketBase admin password** using PBKDF2/scrypt. The admin password is set during setup and stored nowhere else. Pro: no additional secret to manage. Con: changing the admin password requires re-encrypting all secrets; if the admin password is lost, all keys are unrecoverable.
- (B) **Generated at install time, stored in a file** on the host filesystem (e.g., `/data/anyclaw.key`), mounted into the control plane container. Pro: independent of PocketBase credentials. Con: another file to protect; if the volume is lost, keys are unrecoverable.
- (C) **Generated at install time, stored as a Docker secret** (or Kubernetes secret for cloud). Pro: standard secret management pattern. Con: Docker secrets are only available in swarm mode; for docker-compose, falls back to a bind-mounted file (same as B).

### Gap 2: Claude Code session storage across containers

Claude Code's `--resume` relies on session state stored on disk (typically in `~/.claude/`). The `claude` process is spawned from the control plane but may need its session data to persist across container restarts.

**Question:** Where is the Claude Code session directory mounted, and how do we ensure it survives container recreation?

**Options:**
- (A) **Named Docker volume** mounted at `/home/anyclaw/.claude/` in the control plane container. Survives container recreation. Simple.
- (B) **Shared volume between control plane and sandbox containers.** The claude process runs in the control plane but its session data is on a volume that both containers can access. Needed if the sandbox needs to read session context.
- (C) **Don't rely on disk-based resume.** Instead, persist the full conversation as messages in PocketBase and replay them as a new prompt if resume fails. More resilient but higher token cost on resume.

### Gap 3: Cross-container process spawning model

The locked architecture says the agent is "spawned from the control plane and executes code in the sandbox container." The exact mechanism needs to be defined.

**Question:** How does the control plane spawn and manage the `claude` CLI process inside (or targeting) the sandbox container?

**Options:**
- (A) **`claude` runs in the control plane container, sandbox access via MCP tools only.** The claude subprocess lives in the control plane. All file reads/writes and shell commands go through AnyClaw MCP tools that proxy into the sandbox via Docker exec or a thin RPC service. Pro: simple process management. Con: MCP tools must proxy everything; Claude Code's built-in file tools (Read, Write, Bash) would operate on the control plane filesystem, not the sandbox.
- (B) **`docker exec` into the sandbox container.** The control plane spawns `docker exec sandbox-container claude -p ...`. The claude process runs inside the sandbox with direct filesystem access. Pro: Claude Code's built-in tools work naturally on the sandbox filesystem. Con: control plane needs Docker socket access; process management is indirect.
- (C) **`claude` runs in the sandbox container as a long-running service.** The control plane communicates with it via HTTP/WebSocket. Pro: clean separation. Con: more infrastructure to maintain; doesn't match the "spawn on demand" model of CLI `-p`.

### Gap 4: Queue processing and task isolation boundaries

The locked decision is "single task + queue with task isolation for future parallelization." The isolation boundaries need definition.

**Question:** What exactly is isolated between tasks, and how does the queue interact with the resume mechanism?

**Options:**
- (A) **Git branch per task.** Each task works on a separate branch. On completion, merge to the main dev branch. Pro: clean isolation, easy rollback of individual tasks. Con: merge conflicts if tasks touch the same files; agent needs to handle merges.
- (B) **Sequential execution, shared workspace.** Tasks run one at a time in the same workspace. Isolation is purely temporal -- the next task sees the result of the previous one. Pro: simplest, no merge issues. Con: no isolation if we later add parallelism.
- (C) **Copy-on-write workspace snapshots.** Before each task, snapshot the workspace (via git stash or filesystem snapshot). On failure, restore. On success, the workspace moves forward. Pro: rollback granularity per task. Con: snapshot overhead.

### Gap 5: OpenClaw gateway session persistence across gateway restarts

The resume protocol assumes the OpenClaw gateway maintains session state. If the gateway also restarts (e.g., as part of a full server restart), the session may be lost.

**Question:** How does the OpenClaw adapter handle gateway restart when a task was in progress?

**Options:**
- (A) **Replay conversation.** Persist the full conversation (original request + all clarification Q&A) in PocketBase. On gateway restart, re-dispatch the original request with conversation history prepended as context. The agent starts fresh but with full context. Pro: reliable. Con: re-does work the agent already completed; higher token cost.
- (B) **Gateway-side persistence.** Rely on OpenClaw's gateway to persist sessions to its own database. On reconnect, the gateway restores the session. Pro: no extra work in AnyClaw. Con: depends on OpenClaw gateway capabilities that may not exist yet.
- (C) **Mark as failed, let user retry.** If the gateway session cannot be recovered, mark the task as failed. The user retries from the mobile app. Pro: simplest, honest. Con: frustrating for long tasks that were nearly done.
