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
  getApiKey: () => Promise<string>;
  persistSessionId?: ((taskId: string, sessionId: string) => void | Promise<void>) | undefined;
  persistTaskStatus?: ((taskId: string, status: TaskStatus) => void | Promise<void>) | undefined;
}

interface TaskRec {
  child: ChildProcess;
  queue: AsyncQueue<TaskStatus>;
  sessionId?: string | undefined;
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
    // Write MCP config for the claude subprocess
    await writeFile(
      ctx.mcpConfigPath,
      JSON.stringify(
        {
          mcpServers: {
            anyclaw: {
              type: "streamable-http",
              url: ctx.mcpEndpointUrl,
              headers: {
                authorization: `Bearer ${ctx.mcpBearerToken}`,
                "x-anyclaw-task-id": taskId,
              },
            },
          },
        },
        null,
        2,
      ),
    );

    const apiKey = await this.opts.getApiKey();
    const args = [
      ...(this.opts.executableArgs ?? []),
      "--print",
      request,
      "--output-format",
      "stream-json",
      "--mcp-config",
      ctx.mcpConfigPath,
      "--allowedTools",
      ctx.allowedTools.join(","),
    ];

    const child = spawn(this.opts.executablePath, args, {
      cwd: ctx.cwd,
      env: { ...process.env, ANTHROPIC_API_KEY: apiKey },
      stdio: ["pipe", "pipe", "pipe"],
    });

    // Handle abort signal
    const onAbort = () => {
      try {
        child.kill("SIGTERM");
      } catch {
        // ignore
      }
    };
    signal.addEventListener("abort", onAbort, { once: true });

    const queue = new AsyncQueue<TaskStatus>();
    const rec: TaskRec = { child, queue };
    this.tasks.set(taskId, rec);
    this.consumeOutput(taskId, rec);

    return { taskId, adapterRef: `pid:${child.pid}` };
  }

  private consumeOutput(taskId: string, rec: TaskRec): void {
    if (!rec.child.stdout) return;
    const rl = createInterface({ input: rec.child.stdout });
    rl.on("line", async (line) => {
      if (!line.trim()) return;
      let evt: any;
      try {
        evt = JSON.parse(line);
      } catch {
        return;
      }
      if (evt.type === "system" && evt.session_id && !rec.sessionId) {
        rec.sessionId = evt.session_id;
        await this.opts.persistSessionId?.(taskId, evt.session_id);
      }
      const status = this.mapEventToStatus(evt, rec.queue);
      if (status) {
        rec.queue.push(status);
        await this.opts.persistTaskStatus?.(taskId, status);
        if (status.state === "done" || status.state === "failed") {
          rec.queue.close();
        }
      }
    });
    rec.child.on("exit", (code) => {
      if (code !== 0 && code !== null) {
        const seq = rec.queue.lastSeq + 1;
        rec.queue.push({
          state: "failed",
          seq,
          updatedAt: new Date().toISOString(),
          error: `exit ${code}`,
        });
      }
      rec.queue.close();
    });
  }

  private mapEventToStatus(
    evt: any,
    queue: AsyncQueue<TaskStatus>,
  ): TaskStatus | null {
    const now = new Date().toISOString();
    const seq = queue.lastSeq + 1;
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
        };
      }
      return { state: "working", seq, updatedAt: now };
    }
    if (evt.type === "result") {
      return {
        state: "done",
        seq,
        updatedAt: now,
        versionDescription: evt.result,
      };
    }
    return null;
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
    // Handled via MCP tool return — no direct stdin needed
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
