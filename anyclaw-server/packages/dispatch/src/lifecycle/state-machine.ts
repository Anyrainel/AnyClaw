import type { TaskState } from "../adapters/types.js";

export type TaskEvent =
  | "scheduler_pick" | "ask_user" | "answer" | "deploy_called"
  | "validation_pass" | "validation_fail" | "cancel" | "progress";

export class TransitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TransitionError";
  }
}

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
