export type TaskState = "queued" | "working" | "clarifying" | "deploying" | "done" | "failed" | "cancelled";
const TERMINAL: ReadonlySet<TaskState> = new Set(["done","failed","cancelled"]);
export const isTerminal = (s: TaskState): boolean => TERMINAL.has(s);

export interface TaskStatus {
  state: TaskState;
  seq: number;
  updatedAt: string;
  progressSummary?: string | undefined;
  question?: string | undefined;
  clarificationId?: string | undefined;
  versionDescription?: string | undefined;
  error?: string | undefined;
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
  healthCheck(): Promise<{ ok: boolean; detail?: string | undefined }>;
  dispatch(taskId: string, request: string, ctx: SystemContext, signal: AbortSignal): Promise<TaskHandle>;
  subscribe(taskId: string, signal: AbortSignal): AsyncIterable<TaskStatus>;
  answerQuestion(taskId: string, clarificationId: string, answer: string): Promise<void>;
  cancel(taskId: string): Promise<void>;
  sendMessage?(taskId: string, message: string): Promise<void>;
  resumeTask?(taskId: string): Promise<void>;
  dispose(): Promise<void>;
}
