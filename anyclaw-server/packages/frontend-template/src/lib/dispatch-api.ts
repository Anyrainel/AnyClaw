/**
 * Thin client for the AnyRaven dispatch REST API.
 * All endpoints return JSON and speak plain fetch.
 */

const API_BASE = import.meta.env.VITE_DISPATCH_URL ?? "http://127.0.0.1:4100";

function getAuth(): string {
  // In a real app this would come from a login flow / PB auth store.
  // For baseline e2e we use a static bearer that matches the auth
  // middleware's "allow test token" path (see dispatch/src/rest/auth.ts).
  return `Bearer ${localStorage.getItem("anyclaw_token") ?? "dev-token"}`;
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const url = `${API_BASE}${path}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      authorization: getAuth(),
      "content-type": "application/json",
      ...init?.headers,
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`HTTP ${res.status}: ${body}`);
  }
  return res.json() as Promise<T>;
}

export interface TaskSummary {
  taskId: string;
  state: string;
  seq: number;
  request?: string;
  progressSummary?: string;
  error?: string;
  updatedAt?: string;
  version?: string;
  commitSha?: string;
  commitUrl?: string;
  deploymentUrl?: string;
  deployedAt?: string;
}

export interface CreateTaskInput {
  taskId: string;
  request: string;
}

export function createTask(input: CreateTaskInput): Promise<TaskSummary> {
  return api<TaskSummary>("/api/tasks", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function listTasks(): Promise<TaskSummary[]> {
  return api<TaskSummary[]>("/api/tasks");
}

export function getTask(taskId: string): Promise<TaskSummary> {
  return api<TaskSummary>(`/api/tasks/${taskId}`);
}

export function cancelTask(taskId: string): Promise<TaskSummary> {
  return api<TaskSummary>(`/api/tasks/${taskId}/cancel`, { method: "POST" });
}
