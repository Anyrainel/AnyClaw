import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  CheckCircle,
  GitCommitHorizontal,
  Loader2,
  MessageSquareText,
  Rocket,
  Send,
  Square,
  X,
  XCircle,
} from "lucide-react";
import {
  cancelTask,
  createTask,
  listTasks,
  type TaskSummary,
} from "../lib/dispatch-api.js";

const ACTIVE_STATES = new Set(["queued", "working", "clarifying", "deploying"]);

function stateLabel(state: string): string {
  return state.charAt(0).toUpperCase() + state.slice(1);
}

function StateIcon({ state }: { state: string }) {
  if (state === "done") return <CheckCircle className="size-4 text-success" aria-hidden />;
  if (state === "failed") return <XCircle className="size-4 text-danger" aria-hidden />;
  if (state === "cancelled") return <XCircle className="size-4 text-muted" aria-hidden />;
  if (ACTIVE_STATES.has(state)) return <Loader2 className="size-4 animate-spin text-primary" aria-hidden />;
  return <MessageSquareText className="size-4 text-muted" aria-hidden />;
}

function versionDetails(task: TaskSummary): string[] {
  return [
    task.version ? `Version ${task.version}` : null,
    task.commitSha ? `Commit ${task.commitSha.slice(0, 7)}` : null,
    task.deploymentUrl ? `Deploy ${task.deploymentUrl}` : null,
    task.deployedAt ? `Deployed ${new Date(task.deployedAt).toLocaleString()}` : null,
  ].filter(Boolean) as string[];
}

interface AssistantPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AssistantPanel({ open, onOpenChange }: AssistantPanelProps) {
  const [request, setRequest] = useState("");
  const [tasks, setTasks] = useState<TaskSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadTasks = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setTasks(await listTasks());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    void loadTasks();
  }, [loadTasks, open]);

  useEffect(() => {
    if (!open) return;
    const hasActive = tasks.some((task) => ACTIVE_STATES.has(task.state));
    if (hasActive && !pollRef.current) {
      pollRef.current = setInterval(() => {
        void loadTasks();
      }, 3000);
    }
    if (!hasActive && pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    return () => {
      if (pollRef.current && !hasActive) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [loadTasks, open, tasks]);

  async function submitRequest() {
    if (!request.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      await createTask({ taskId: crypto.randomUUID(), request: request.trim() });
      setRequest("");
      await loadTasks();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  async function stopTask(taskId: string) {
    setError(null);
    try {
      await cancelTask(taskId);
      await loadTasks();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <>
      <button
        type="button"
        className="assistant-trigger"
        aria-label="Open dispatch assistant"
        onClick={() => onOpenChange(true)}
      >
        <MessageSquareText className="size-5" aria-hidden />
      </button>

      {open && <button type="button" className="sheet-backdrop" aria-label="Close dispatch assistant" onClick={() => onOpenChange(false)} />}

      <aside className="assistant-panel" data-open={open} aria-label="Dispatch assistant" aria-hidden={!open}>
        <header className="sheet-header">
          <div>
            <p className="eyebrow">Dispatch</p>
            <h2>Build request</h2>
          </div>
          <button type="button" className="icon-button" aria-label="Close" onClick={() => onOpenChange(false)}>
            <X className="size-5" aria-hidden />
          </button>
        </header>

        <div className="assistant-thread" aria-live="polite">
          <div className="assistant-message assistant-message-system">
            <p>Describe the next change. The agent will work in tasks and report progress here.</p>
          </div>

          {error && (
            <div className="assistant-message assistant-message-error" role="alert">
              <AlertCircle className="size-4" aria-hidden />
              <p>{error}</p>
            </div>
          )}

          {!loading && tasks.length === 0 && (
            <div className="empty-state">
              <MessageSquareText className="size-5" aria-hidden />
              <p>No requests yet.</p>
              <span>Ask for a tracker, dashboard, reminder flow, or any small app improvement.</span>
            </div>
          )}

          {loading && tasks.length === 0 && (
            <div className="assistant-message assistant-message-system">
              <Loader2 className="size-4 animate-spin" aria-hidden />
              <p>Loading tasks...</p>
            </div>
          )}

          {tasks.map((task) => {
            const details = versionDetails(task);
            const canCancel = ACTIVE_STATES.has(task.state);
            return (
              <article className="task-message" key={task.taskId}>
                <div className="task-message-header">
                  <StateIcon state={task.state} />
                  <span>{stateLabel(task.state)}</span>
                  <time>{task.updatedAt ? new Date(task.updatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : `#${task.seq}`}</time>
                </div>
                <p className="task-request">{task.request || task.taskId}</p>
                {task.progressSummary && <p className="task-progress">{task.progressSummary}</p>}
                {task.error && <p className="task-error">{task.error}</p>}
                {details.length > 0 ? (
                  <div className="version-strip" aria-label="Version details">
                    {task.commitSha && <GitCommitHorizontal className="size-4" aria-hidden />}
                    {!task.commitSha && <Rocket className="size-4" aria-hidden />}
                    <span>{details.join(" · ")}</span>
                  </div>
                ) : (
                  task.state === "done" && <p className="task-meta">No commit or deployment details were reported.</p>
                )}
                {canCancel && (
                  <button type="button" className="cancel-button" onClick={() => stopTask(task.taskId)}>
                    <Square className="size-3" aria-hidden />
                    Cancel work
                  </button>
                )}
              </article>
            );
          })}
        </div>

        <form
          className="assistant-composer"
          onSubmit={(event) => {
            event.preventDefault();
            void submitRequest();
          }}
        >
          <textarea
            value={request}
            onChange={(event) => setRequest(event.target.value)}
            placeholder="Build a simple habit tracker with streaks"
            rows={3}
            disabled={submitting}
          />
          <button type="submit" className="primary-icon-button" disabled={submitting || !request.trim()} aria-label="Submit request">
            {submitting ? <Loader2 className="size-5 animate-spin" aria-hidden /> : <Send className="size-5" aria-hidden />}
          </button>
        </form>
      </aside>
    </>
  );
}
