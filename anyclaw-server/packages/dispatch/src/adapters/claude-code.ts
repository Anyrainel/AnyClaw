import { spawn, type ChildProcess } from "child_process";
import { writeFile } from "fs/promises";
import { createInterface } from "readline";
import { AsyncQueue } from "../util/async-queue.js";
import {
  AdapterError,
  type AgentAdapter,
  type SystemContext,
  type TaskHandle,
  type TaskStatus,
} from "./types.js";

export interface ClaudeCodeOptions {
  executablePath: string;
  executableArgs?: string[] | undefined;
  maxBudgetUsd: number;
  persistSessionId?: ((taskId: string, sessionId: string) => void | Promise<void>) | undefined;
  persistTaskStatus?: ((taskId: string, status: TaskStatus) => void | Promise<void>) | undefined;
}

interface TaskRec {
  child: ChildProcess;
  cwd: string;
  queue: AsyncQueue<TaskStatus>;
  finished?: boolean | undefined;
  sessionId?: string | undefined;
  stdinWriter?: NodeJS.WritableStream;
}

/** NDJSON message format for --input-format stream-json */
function buildInputMessage(content: string): string {
  return JSON.stringify({
    type: "user",
    message: {
      role: "user",
      content,
    },
  }) + "\n";
}

export class ClaudeCodeAdapter implements AgentAdapter {
  readonly name = "ClaudeCode";
  private tasks = new Map<string, TaskRec>();

  constructor(private readonly opts: ClaudeCodeOptions) {}

  async healthCheck(): Promise<{ ok: boolean; detail?: string | undefined }> {
    return { ok: true };
  }

  async dispatch(
    taskId: string,
    request: string,
    ctx: SystemContext,
    signal: AbortSignal,
  ): Promise<TaskHandle> {
    // Write MCP config before spawning the child process
    await writeFile(
      ctx.mcpConfigPath,
      JSON.stringify({
        mcpServers: {
          anyclaw: {
            url: ctx.mcpEndpointUrl,
            headers: {
              authorization: `Bearer ${ctx.mcpBearerToken}`,
              "x-anyclaw-task-id": taskId,
            },
          },
        },
      }, null, 2),
      "utf8",
    );

    // Build args for headless mode with streaming I/O
    const args = [
      ...(this.opts.executableArgs ?? []),
      "-p", // headless / print mode
      "--input-format", "stream-json",
      "--output-format", "stream-json",
      "--verbose",
      "--mcp-config", ctx.mcpConfigPath,
      "--allowedTools",
      [...ctx.allowedTools, "anyclaw_done"].join(","),
      "--max-budget-usd", String(this.opts.maxBudgetUsd),
    ];

    const child = spawn(this.opts.executablePath, args, {
      cwd: ctx.cwd,
      env: {
        ...process.env,
        CI: process.env.CI ?? "true",
        FORCE_COLOR: "0",
        NO_COLOR: "1",
      },
      stdio: ["pipe", "pipe", "pipe"],
    });

    const onAbort = () => {
      try {
        child.kill("SIGTERM");
      } catch {
        // ignore
      }
    };
    signal.addEventListener("abort", onAbort, { once: true });

    const queue = new AsyncQueue<TaskStatus>();
    const rec: TaskRec = { child, cwd: ctx.cwd, queue };
    this.tasks.set(taskId, rec);

    // Store stdin writer for later sendMessage calls
    if (child.stdin) {
      rec.stdinWriter = child.stdin;
    }

    // Consume stdout NDJSON stream
    this.consumeOutput(taskId, rec);

    // Send initial prompt
    if (child.stdin) {
      child.stdin.write(buildInputMessage(request), (err) => {
        if (err) {
          this.failTask(taskId, rec, `stdin write failed: ${err.message}`);
        }
      });
    }

    return { taskId, adapterRef: `pid:${child.pid}` };
  }

  private consumeOutput(taskId: string, rec: TaskRec): void {
    rec.child.once("error", (err) => {
      this.failTask(
        taskId,
        rec,
        `failed to start ${this.opts.executablePath}: ${err.message}`,
      );
    });
    rec.child.stdin?.on("error", (err: Error) => {
      this.failTask(taskId, rec, `stdin error: ${err.message}`);
    });

    if (!rec.child.stdout) return;
    const rl = createInterface({ input: rec.child.stdout });
    rl.on("line", async (line) => {
      if (!line.trim()) return;
      let evt: any;
      try {
        evt = JSON.parse(line);
      } catch {
        // Not JSON — ignore
        return;
      }

      // Capture session ID from init event
      if (evt.type === "system" && evt.subtype === "init" && evt.session_id) {
        rec.sessionId = evt.session_id;
        await this.opts.persistSessionId?.(taskId, evt.session_id);
      }

      const status = this.mapEventToStatus(evt, rec.queue);
      if (status) {
        rec.queue.push(status);
        await this.opts.persistTaskStatus?.(taskId, status);
        if (status.state === "done" || status.state === "failed") {
          rec.finished = true;
          rec.queue.close();
        }
      }
    });

    rec.child.on("exit", (code) => {
      if (code !== 0 && code !== null) {
        this.failTask(taskId, rec, `exit ${code}`);
        return;
      }
      rec.finished = true;
      rec.queue.close();
    });
  }

  private failTask(taskId: string, rec: TaskRec, error: string): void {
    if (rec.finished) return;
    rec.finished = true;
    const seq = rec.queue.lastSeq + 1;
    rec.queue.push({
      state: "failed",
      seq,
      updatedAt: new Date().toISOString(),
      error,
    });
    void this.opts.persistTaskStatus?.(taskId, {
      state: "failed",
      seq,
      updatedAt: new Date().toISOString(),
      error,
    });
    rec.queue.close();
  }

  private mapEventToStatus(
    evt: any,
    queue: AsyncQueue<TaskStatus>,
  ): TaskStatus | null {
    const now = new Date().toISOString();
    const seq = queue.lastSeq + 1;

    // Progress events
    if (evt.type === "stream_event") {
      const delta = evt.event?.delta;
      if (delta?.type === "text_delta") {
        return {
          state: "working",
          seq,
          updatedAt: now,
          progressSummary: delta.text?.substring(0, 200),
        };
      }
      // Tool use events
      if (evt.event?.type === "tool_use") {
        return {
          state: "working",
          seq,
          updatedAt: now,
          progressSummary: `Using ${evt.event.name}...`,
        };
      }
    }

    // Assistant message — check for clarification request
    if (evt.type === "assistant") {
      const tool = evt.message?.content?.find?.(
        (c: any) => c.type === "tool_use" && c.name === "anyclaw_ask_user",
      );
      if (tool) {
        return {
          state: "clarifying",
          seq,
          updatedAt: now,
          question: tool.input?.question,
          clarificationId: tool.id,
        };
      }
      return { state: "working", seq, updatedAt: now };
    }

    // Result / completion
    if (evt.type === "result") {
      return {
        state: evt.is_error ? "failed" : "done",
        seq,
        updatedAt: now,
        versionDescription: evt.result,
        error: evt.is_error ? evt.result : undefined,
      };
    }

    // Permission prompt
    if (evt.type === "permission_prompt") {
      return {
        state: "clarifying",
        seq,
        updatedAt: now,
        question: `Permission required: ${evt.tool} (${evt.command || evt.path || "unknown"})`,
      };
    }

    return null;
  }

  /**
   * Send a follow-up message into a running Claude Code session.
   * Since `claude -p` is one-shot per invocation, we spawn a new
   * process with --continue to preserve session context.
   */
  async sendMessage(taskId: string, message: string): Promise<void> {
    const rec = this.tasks.get(taskId);
    if (!rec) {
      throw new AdapterError(
        `no active task ${taskId}`,
        "BAD_REQUEST",
        false,
      );
    }

    // Spawn a continuation of the same session
    const args = [
      ...(this.opts.executableArgs ?? []),
      "-p",
      "--continue", // Continue the most recent conversation
      "--input-format", "stream-json",
      "--output-format", "stream-json",
      "--verbose",
      "--max-budget-usd", String(this.opts.maxBudgetUsd),
    ];

    const child = spawn(this.opts.executablePath, args, {
      cwd: rec.cwd,
      env: {
        ...process.env,
        CI: process.env.CI ?? "true",
        FORCE_COLOR: "0",
        NO_COLOR: "1",
      },
      stdio: ["pipe", "pipe", "pipe"],
    });
    child.once("error", (err) => {
      this.failTask(
        taskId,
        rec,
        `failed to continue ${this.opts.executablePath}: ${err.message}`,
      );
    });
    child.stdin?.on("error", (err: Error) => {
      this.failTask(taskId, rec, `stdin error: ${err.message}`);
    });

    // Send the follow-up message
    if (child.stdin) {
      child.stdin.write(buildInputMessage(message), (err) => {
        if (err) {
          this.failTask(taskId, rec, `stdin write failed: ${err.message}`);
        }
      });
      child.stdin.end();
    }

    // Consume the output and forward to the task queue
    if (child.stdout) {
      const rl = createInterface({ input: child.stdout });
      rl.on("line", async (line) => {
        if (!line.trim()) return;
        try {
          const evt = JSON.parse(line);
          const status = this.mapEventToStatus(evt, rec.queue);
          if (status) {
            rec.queue.push(status);
            await this.opts.persistTaskStatus?.(taskId, status);
          }
        } catch {
          // ignore non-JSON
        }
      });
    }

    child.on("exit", () => {
      // Don't close the queue — the main task is still running
    });
  }

  async *subscribe(
    taskId: string,
    signal: AbortSignal,
  ): AsyncIterable<TaskStatus> {
    const rec = this.tasks.get(taskId);
    if (!rec)
      throw new AdapterError(
        `no task ${taskId}`,
        "BAD_REQUEST",
        false,
      );
    signal.addEventListener("abort", () => rec.queue.close());
    for await (const s of rec.queue) yield s;
  }

  async answerQuestion(
    _taskId: string,
    _cid: string,
    _answer: string,
  ): Promise<void> {
    // Handled via MCP tool return — no direct stdin needed.
  }

  async cancel(taskId: string): Promise<void> {
    const rec = this.tasks.get(taskId);
    if (!rec) return;
    rec.child.kill("SIGTERM");
    const killTimer = setTimeout(() => {
      try {
        rec.child.kill("SIGKILL");
      } catch {
        // ignore
      }
    }, 5000);
    if (typeof killTimer === "object" && "unref" in killTimer) {
      killTimer.unref();
    }
    rec.queue.close();
  }

  async resumeTask(taskId: string): Promise<void> {
    const rec = this.tasks.get(taskId);
    if (!rec?.sessionId) {
      throw new AdapterError(
        "Cannot resume Claude Code task — no session ID available",
        "BAD_REQUEST",
        false,
      );
    }
    // Spawn `claude --resume ${rec.sessionId}` and re-attach to the queue
    const args = [
      ...(this.opts.executableArgs ?? []),
      "-p", // headless / print mode
      "--resume", rec.sessionId,
      "--input-format", "stream-json",
      "--output-format", "stream-json",
      "--verbose",
    ];

    const child = spawn(this.opts.executablePath, args, {
      cwd: rec.cwd,
      env: {
        ...process.env,
        CI: process.env.CI ?? "true",
        FORCE_COLOR: "0",
        NO_COLOR: "1",
      },
      stdio: ["pipe", "pipe", "pipe"],
    });

    // Replace the old child process
    rec.child.kill("SIGTERM");
    rec.child = child;

    // Re-attach stdin
    if (child.stdin) {
      rec.stdinWriter = child.stdin;
    }

    // Re-start output consumption
    this.consumeOutput(taskId, rec);
  }

  async dispose(): Promise<void> {
    for (const [, rec] of this.tasks) {
      try {
        rec.child.kill("SIGTERM");
      } catch {
        // ignore
      }
      rec.queue.close();
    }
    this.tasks.clear();
  }
}
