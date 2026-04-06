# Plan 3: Agent Dispatch Layer -- Design Document

**Goal:** Define the pluggable adapter layer that lets the AnyClaw mobile app submit work requests to the user's coding agent, relay clarifying questions back to the user, and report progress/completion/failure. The adapter is agent-agnostic: initial implementations cover OpenClaw and Claude Code, with a generic webhook adapter for future agents (Codex, Aider, Gemini CLI, etc.).

**Depends on:** Plan 1 (Server Infrastructure) for PocketBase runtime and Node.js logic service.

---

## 1. Where the Adapter Runs

The adapter runs **on the user's server**, inside the Node.js logic service -- not in the mobile app and not in the broker.

**Rationale:**

- The adapter must be able to reach the coding agent. The agent runs on the same machine (or Docker network) as the server. A server-side adapter can connect to OpenClaw's local gateway on `127.0.0.1:18789` or spawn a Claude Code subprocess directly. A mobile-side adapter would need the tunnel to reach back to the agent, doubling latency and adding failure modes.
- The adapter manages long-running processes (agent sessions can run for minutes). The server stays online; the mobile app can disconnect and reconnect without losing task state.
- The broker is a thin signaling relay. Putting dispatch logic there would make it stateful, expensive, and a single point of failure.

**Communication path:**

```
Mobile App  --[WSS tunnel]--> AnyClaw Server (Node.js logic service)
                                  |
                                  +--> AdapterManager (picks the right adapter)
                                  |        |
                                  |        +--> OpenClawAdapter --[WS]--> OpenClaw Gateway :18789
                                  |        +--> ClaudeCodeAdapter --[subprocess]--> claude CLI
                                  |        +--> WebhookAdapter --[HTTP]--> user-configured URL
                                  |
                                  +--> PocketBase (task state persistence)
```

The mobile app talks to the logic service over the existing WSS tunnel (established via the broker). The logic service exposes a task dispatch API (REST + realtime SSE via PocketBase). The adapter translates between AnyClaw's task protocol and the specific agent's protocol.

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

### 4.1 Approach: Agent SDK (TypeScript)

Claude Code provides a TypeScript SDK (`@anthropic-ai/claude-agent-sdk`) that spawns the `claude` CLI as a subprocess and communicates over stdin/stdout via JSON lines. This gives us full lifecycle control: start, stream progress, inject follow-up messages, and cancel.

**Why the SDK over CLI `-p` mode:** The `-p` flag runs a single prompt to completion and exits. It does not support mid-task interaction (answering clarifying questions). The SDK's `query()` function returns an async generator that streams events, and accepts `AsyncIterable<SDKUserMessage>` as prompt input, enabling multi-turn interaction within a single session.

### 4.2 Implementation

```typescript
import { query, type Query, type SDKMessage } from "@anthropic-ai/claude-agent-sdk";

class ClaudeCodeAdapter implements AgentAdapter {
  readonly name = "Claude Code";
  private activeSessions = new Map<string, {
    query: Query;
    controller: AbortController;
    inputStream: AsyncPushStream<SDKUserMessage>;
    status: TaskStatus;
  }>();

  constructor(private config: {
    /** Path to claude binary, or undefined to use the SDK's built-in. */
    executablePath?: string;
    /** Model override, e.g. "claude-sonnet-4-20250514". */
    model?: string;
    /** Max budget per task in USD. Default: 5.00 */
    maxBudgetUsd: number;
  }) {}

  async healthCheck(): Promise<{ ok: boolean; detail?: string }> {
    try {
      // Spawn a minimal query to verify the agent is reachable
      const q = query({
        prompt: "Reply with OK",
        options: {
          maxTurns: 1,
          permissionMode: "plan",  // no tool execution
          abortController: AbortController.timeout(8_000)
        }
      });
      for await (const msg of q) {
        if (msg.type === "result") {
          return { ok: true };
        }
      }
      return { ok: false, detail: "No result received" };
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
    const controller = new AbortController();
    // Link external signal to our controller
    signal.addEventListener("abort", () => controller.abort(signal.reason));

    // Create a push-based input stream for multi-turn interaction
    const inputStream = new AsyncPushStream<SDKUserMessage>();

    // Push the initial user request
    inputStream.push({
      type: "user",
      content: request
    });

    const q = query({
      prompt: inputStream,
      options: {
        cwd: systemContext.cwd,
        abortController: controller,
        permissionMode: "acceptEdits",
        allowedTools: [
          ...systemContext.allowedTools,
          "Read", "Edit", "Write", "Bash", "Glob", "Grep"
        ],
        mcpServers: {
          anyclaw: {
            type: "stdio",
            command: "node",
            args: [systemContext.mcpConfigPath],
            env: { ANYCLAW_TASK_ID: taskId }
          }
        },
        systemPrompt: {
          type: "preset",
          preset: "claude_code",
          append: systemContext.systemPrompt
        },
        maxBudgetUsd: this.config.maxBudgetUsd,
        model: this.config.model,
        pathToClaudeCodeExecutable: this.config.executablePath,
        settingSources: ["project"],  // load CLAUDE.md
      }
    });

    const session = {
      query: q,
      controller,
      inputStream,
      status: {
        state: "working" as TaskState,
        seq: 0,
        updatedAt: new Date().toISOString()
      }
    };
    this.activeSessions.set(taskId, session);

    // Start consuming the query stream in the background
    this.consumeStream(taskId);

    return { taskId, adapterRef: taskId };
  }

  async *subscribe(handle: TaskHandle, signal: AbortSignal): AsyncIterable<TaskStatus> {
    const session = this.activeSessions.get(handle.taskId);
    if (!session) throw new AdapterError("Task not found", "TASK_NOT_FOUND", false);

    const statusQueue = new AsyncQueue<TaskStatus>();
    // Yield current status immediately
    statusQueue.push(session.status);

    // Watch for changes
    const watcher = setInterval(() => {
      const s = this.activeSessions.get(handle.taskId);
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
    const session = this.activeSessions.get(handle.taskId);
    if (!session) throw new AdapterError("Task not found", "TASK_NOT_FOUND", false);

    // Push the user's answer into the input stream.
    // The SDK will deliver it to the running claude subprocess.
    session.inputStream.push({
      type: "user",
      content: answer
    });
  }

  async cancel(handle: TaskHandle): Promise<void> {
    const session = this.activeSessions.get(handle.taskId);
    if (!session) return;
    session.controller.abort();
    session.query.close();
  }

  async dispose(): Promise<void> {
    for (const [, session] of this.activeSessions) {
      session.controller.abort();
      session.query.close();
    }
    this.activeSessions.clear();
  }

  // --- Internal ---

  private async consumeStream(taskId: string): Promise<void> {
    const session = this.activeSessions.get(taskId);
    if (!session) return;

    try {
      for await (const message of session.query) {
        this.updateStatusFromMessage(taskId, message);
      }
      // Stream completed normally -- mark done if not already terminal
      if (!isTerminal(session.status.state)) {
        session.status = {
          state: "done", seq: ++session.status.seq,
          updatedAt: new Date().toISOString()
        };
      }
    } catch (err) {
      session.status = {
        state: "failed",
        error: String(err),
        seq: ++session.status.seq,
        updatedAt: new Date().toISOString()
      };
    } finally {
      // Clean up after terminal state, but keep status accessible for 5 min
      setTimeout(() => this.activeSessions.delete(taskId), 5 * 60 * 1000);
    }
  }

  private updateStatusFromMessage(taskId: string, msg: SDKMessage): void {
    const session = this.activeSessions.get(taskId);
    if (!session) return;
    const now = new Date().toISOString();
    const seq = ++session.status.seq;

    // Detect MCP tool calls by inspecting the message stream
    if (msg.type === "assistant" && msg.message?.content) {
      for (const block of msg.message.content) {
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

    if (msg.type === "result") {
      session.status = {
        state: "done",
        versionDescription: msg.result,
        seq, updatedAt: now
      };
    }
  }
}
```

### 4.3 Key Design Decisions for Claude Code

**Multi-turn via `AsyncIterable<SDKUserMessage>` prompt.** The SDK's `query()` accepts an async iterable as the prompt parameter. We create an `AsyncPushStream` -- a simple async iterable backed by a queue -- and push the initial request. When the user answers a clarifying question, we push the answer into the same stream. The SDK delivers it to the running subprocess as a follow-up user message. This avoids the polling-via-PocketBase approach (Option A from the spec) and uses a direct in-process channel instead.

**Permission mode: `acceptEdits`.** The adapter pre-approves file reads/writes and the AnyClaw MCP tools. Bash commands that match the allowed patterns run without prompting. This enables fully non-interactive execution.

**Budget cap: `maxBudgetUsd`.** Prevents runaway token spend. Default $5 per task.

**MCP server injection.** The adapter passes the AnyClaw MCP server config directly via `mcpServers` in the SDK options. The SDK loads it automatically -- no need to write `.mcp.json` to disk.

**Session persistence.** Set `persistSession: true` (the default). This lets us resume a task if the server restarts mid-execution, using `resume: sessionId`.

### 4.4 Authentication

For server-side (headless) usage, Claude Code authenticates via the `ANTHROPIC_API_KEY` environment variable. No browser OAuth flow is needed. The user configures this key during AnyClaw setup.

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

    // Wait for the answer (with timeout)
    const answer = await waitForAnswer(pb, record.id, 300_000); // 5 min timeout

    return {
      content: [{ type: "text", text: answer }]
    };
  }
);

async function waitForAnswer(
  pb: PocketBase,
  clarificationId: string,
  timeoutMs: number
): Promise<string> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      unsubscribe();
      reject(new Error("User did not respond within timeout"));
    }, timeoutMs);

    // PocketBase realtime subscription
    const unsubscribe = pb.collection("task_clarifications")
      .subscribe(clarificationId, (event) => {
        if (event.action === "update" && event.record.status === "answered") {
          clearTimeout(timer);
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
  id: string;          // PocketBase auto-ID
  taskId: string;      // AnyClaw UUID (indexed, unique)
  request: string;     // original user request
  state: TaskState;
  adapterRef: string;
  progressSummary?: string;
  versionDescription?: string;
  error?: string;
  seq: number;
  createdAt: string;
  updatedAt: string;
}

// Collection: task_clarifications
{
  id: string;
  taskId: string;      // relation to tasks.taskId
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
```

The mobile app subscribes to PocketBase realtime on the `tasks` collection (filtered by `taskId`) to get live status updates. This works through the existing WSS tunnel without any additional protocol.

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
    gatewayUrl: string;        // default "ws://127.0.0.1:18789"
    gatewayToken: string;      // OPENCLAW_GATEWAY_TOKEN
    workspace: string;         // workspace name
  };
  claudeCodeConfig?: {
    executablePath?: string;   // path to claude binary
    model?: string;            // model override
    maxBudgetUsd: number;      // default 5.00
    apiKey: string;            // ANTHROPIC_API_KEY (encrypted at rest)
  };
  webhookConfig?: {
    dispatchUrl: string;       // POST URL for task dispatch
    callbackBaseUrl: string;   // base URL the agent will POST back to
    authHeader?: string;       // optional auth header value
  };
  dispatch: {
    maxTaskDurationMs: number; // default 900000 (15 min)
    stallTimeoutMs: number;    // default 120000 (2 min)
  };
}
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
          token: settings.openclawConfig!.gatewayToken,
          workspace: settings.openclawConfig!.workspace,
        });
      case "claude-code":
        return new ClaudeCodeAdapter({
          executablePath: settings.claudeCodeConfig?.executablePath,
          model: settings.claudeCodeConfig?.model,
          maxBudgetUsd: settings.claudeCodeConfig?.maxBudgetUsd ?? 5.0,
        });
      case "webhook":
        return new WebhookAdapter(settings.webhookConfig!);
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

## 10. Technical Decisions Needed

### Decision 1: Concurrent task limit

Should AnyClaw allow multiple tasks to run simultaneously? The spec implies one task at a time (the "task card" UI is singular), but users may want to queue requests.

**Options:**
- (A) Single task at a time. Queue additional requests. Simplest, lowest cost.
- (B) Allow N concurrent tasks (N=2-3). Agent may interleave work. Higher complexity.
- (C) Single task at a time, but allow the user to submit while one is running -- it queues and starts when the current one finishes.

**Recommendation:** Option C. Single active task, with a queue. The UI stays simple but users are not blocked from typing their next idea.

### Decision 2: Clarification timeout behavior

When the agent asks a question and the user does not respond, what happens after the timeout?

**Options:**
- (A) The task fails with "User did not respond."
- (B) The agent is told "The user is unavailable. Make your best judgment and proceed."
- (C) The task pauses indefinitely. The agent subprocess/session stays alive until the user returns.

**Recommendation:** Option B with a configurable timeout (default: 5 minutes). Failing is frustrating; indefinite pausing wastes resources. Letting the agent proceed with its best guess matches how most humans would want this to work.

### Decision 3: API key storage

The Claude Code adapter needs `ANTHROPIC_API_KEY`. The OpenClaw adapter needs `OPENCLAW_GATEWAY_TOKEN`.

**Options:**
- (A) Store in PocketBase (encrypted at rest via application-level encryption).
- (B) Store in environment variables only (set during Docker compose setup).
- (C) Store in a `.env` file on the server filesystem, outside PocketBase.

**Recommendation:** Option B for self-hosted (env vars in docker-compose), Option A for cloud-hosted (PocketBase with encryption, since we manage the container). The mobile app settings screen should be able to update these, which argues for Option A in both cases, but env vars are more secure for self-hosted users who are comfortable with the terminal.

### Decision 4: Claude Code SDK vs CLI `-p` mode

The design above uses the TypeScript SDK for the Claude Code adapter, because it supports multi-turn interaction via `AsyncIterable<SDKUserMessage>`. However, if we decide that all clarification goes through the `anyclaw_ask_user` MCP tool (which blocks in the MCP server, not in the adapter), then the simpler CLI `-p` mode would work too.

**Options:**
- (A) TypeScript SDK with `query()`. Full lifecycle control, multi-turn via input stream. More code.
- (B) CLI `-p --output-format stream-json`. Simpler. Clarification via MCP tool only. No mid-session follow-up messages. Resume via `--resume`.

**Recommendation:** Start with Option B for MVP. The `anyclaw_ask_user` MCP tool handles clarification regardless of adapter, so the SDK's multi-turn capability is not strictly needed. Upgrade to Option A later if we need richer interaction (e.g., user wants to steer the agent mid-task beyond answering questions).

### Decision 5: Task state persistence across server restarts

If the server restarts while a task is running, what happens?

**Options:**
- (A) Task is lost. User must re-submit. Simple but frustrating.
- (B) Task state is in PocketBase. On restart, attempt to resume the agent session (Claude Code: `--resume`; OpenClaw: reconnect to gateway with the same workspace).
- (C) Task state is in PocketBase. On restart, mark any "working" tasks as "failed" with "Server restarted" error. User can retry.

**Recommendation:** Option C for MVP, with Option B as a future enhancement. Resuming agent sessions reliably is complex (the agent's in-memory context may be lost). Marking as failed and letting the user retry is honest and simple.
