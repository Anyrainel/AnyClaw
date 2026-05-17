import WebSocket from "ws";
import { AsyncQueue } from "../util/async-queue.js";
import {
  AdapterError,
  type AgentAdapter,
  type SystemContext,
  type TaskHandle,
  type TaskStatus,
} from "./types.js";

export interface OpenClawOptions {
  gatewayUrl: string;
  token: string;
  workspace: string;
}

interface Pending {
  resolve: (v: any) => void;
  reject: (e: Error) => void;
}

export class OpenClawAdapter implements AgentAdapter {
  readonly name = "OpenClaw";
  private ws?: WebSocket;
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private queues = new Map<string, AsyncQueue<TaskStatus>>();
  private adapterRefs = new Map<string, string>();
  private handshook = false;

  constructor(private readonly opts: OpenClawOptions) {}

  async healthCheck(): Promise<{ ok: boolean; detail?: string | undefined }> {
    // Quick check: try to open a WebSocket with short timeout
    return new Promise((resolve) => {
      const ws = new WebSocket(this.opts.gatewayUrl, {
        headers: { authorization: `Bearer ${this.opts.token}` },
        handshakeTimeout: 3000,
      });
      const timer = setTimeout(() => {
        ws.terminate();
        resolve({ ok: false, detail: "Gateway connection timeout" });
      }, 3000);
      ws.on("open", () => {
        clearTimeout(timer);
        ws.close();
        resolve({ ok: true });
      });
      ws.on("error", (err) => {
        clearTimeout(timer);
        resolve({ ok: false, detail: err.message });
      });
    });
  }

  private async ensureConnected(): Promise<void> {
    if (this.handshook) return;
    this.ws = new WebSocket(this.opts.gatewayUrl, {
      headers: { authorization: `Bearer ${this.opts.token}` },
    });
    // Set up challenge listener BEFORE open resolves to avoid race
    const challengeReady = new Promise<void>((res) => {
      const onMsg = (raw: WebSocket.RawData) => {
        const frame = JSON.parse(raw.toString());
        if (
          frame.type === "event" &&
          frame.event === "connect.challenge"
        ) {
          this.ws!.off("message", onMsg);
          res();
        }
      };
      this.ws!.on("message", onMsg);
    });
    await new Promise<void>((res, rej) => {
      this.ws!.once("open", () => res());
      this.ws!.once("error", (e) => rej(e));
    });
    await challengeReady;
    // Now install the persistent message handler
    this.ws!.on("message", (raw) =>
      this.onFrame(JSON.parse(raw.toString())),
    );
    // Send connect RPC
    await this.rpc("connect", { workspace: this.opts.workspace });
    this.handshook = true;
  }

  private rpc(method: string, params: Record<string, unknown>): Promise<any> {
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
      if (frame.ok) {
        p.resolve(frame.payload);
      } else {
        p.reject(
          new AdapterError(
            frame.error ?? "rpc failed",
            "INTERNAL",
            true,
          ),
        );
      }
      return;
    }
    if (frame.type === "event") this.routeEvent(frame);
  }

  private routeEvent(frame: any): void {
    const taskId: string | undefined =
      frame.payload?.metadata?.anyClawTaskId ??
      this.findTaskByRunId(frame.payload?.runId);
    if (!taskId) return;
    const q = this.queues.get(taskId);
    if (!q) return;
    const status = this.mapEventToStatus(frame, q);
    if (status) {
      q.push(status);
      if (status.state === "done" || status.state === "failed") q.close();
    }
  }

  private findTaskByRunId(runId?: string): string | undefined {
    if (!runId) return undefined;
    for (const [tid, ref] of this.adapterRefs) {
      if (ref === runId) return tid;
    }
    return undefined;
  }

  private mapEventToStatus(
    frame: any,
    q: AsyncQueue<TaskStatus>,
  ): TaskStatus | null {
    const now = new Date().toISOString();
    const seq = q.lastSeq + 1;
    if (
      frame.event === "session.tool" &&
      frame.payload?.tool === "anyraven_ask_user"
    ) {
      return {
        state: "clarifying",
        seq,
        updatedAt: now,
        question: frame.payload.args.question,
      };
    }
    if (
      frame.event === "session.message" &&
      frame.payload?.type === "run_complete"
    ) {
      return frame.payload.status === "success"
        ? {
            state: "done",
            seq,
            updatedAt: now,
            versionDescription: frame.payload.summary,
          }
        : {
            state: "failed",
            seq,
            updatedAt: now,
            error: frame.payload.summary,
          };
    }
    return {
      state: "working",
      seq,
      updatedAt: now,
      progressSummary: frame.payload?.delta,
    };
  }

  async dispatch(
    taskId: string,
    request: string,
    _ctx: SystemContext,
    _signal: AbortSignal,
  ): Promise<TaskHandle> {
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

  async *subscribe(
    taskId: string,
    signal: AbortSignal,
  ): AsyncIterable<TaskStatus> {
    const q = this.queues.get(taskId);
    if (!q)
      throw new AdapterError(
        `no queue for ${taskId}`,
        "BAD_REQUEST",
        false,
      );
    signal.addEventListener("abort", () => q.close());
    for await (const s of q) yield s;
  }

  async answerQuestion(
    taskId: string,
    _clarificationId: string,
    answer: string,
  ): Promise<void> {
    await this.rpc("chat.send", {
      idempotencyKey: `${taskId}:answer:${Date.now()}`,
      message: answer,
      metadata: { anyClawTaskId: taskId },
    });
  }

  async cancel(taskId: string): Promise<void> {
    const ref = this.adapterRefs.get(taskId);
    if (!ref) return;
    await this.rpc("sessions.abort", { runId: ref });
    this.queues.get(taskId)?.close();
  }

  async dispose(): Promise<void> {
    this.ws?.close();
    this.handshook = false;
  }
}
