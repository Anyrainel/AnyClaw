import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  AlertCircle,
  CheckCircle,
  GitCommitHorizontal,
  History,
  ListChecks,
  Loader2,
  MessageSquareText,
  Plus,
  Rocket,
  Send,
  Settings,
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
  onSettingsOpen: () => void;
}

type AnyRavenView = "overview" | "work-history" | "feature-requests";

export function AssistantPanel({ open, onOpenChange, onSettingsOpen }: AssistantPanelProps) {
  const [view, setView] = useState<AnyRavenView>("overview");
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
    void loadTasks();
  }, [loadTasks]);

  useEffect(() => {
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
  }, [loadTasks, tasks]);

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

  const activeTasks = tasks.filter((task) => ACTIVE_STATES.has(task.state));
  const completedTasks = tasks.filter((task) => !ACTIVE_STATES.has(task.state));
  const recentTasks = tasks.slice(0, 4);

  function openNewRequest() {
    onOpenChange(true);
  }

  return (
    <>
      <section className="dispatch-overview" aria-label="AnyRaven work history">
        <div className="dispatch-header">
          <div>
            <p className="eyebrow">AnyRaven</p>
            <h2>{view === "overview" ? "App evolution" : view === "work-history" ? "Work history" : "Feature requests"}</h2>
            <p>{view === "overview" ? "Manage the services, requests, and shipped work that let this app evolve." : "Review the agent work that changed this app."}</p>
          </div>
          <button type="button" className="icon-button" aria-label="Open settings" onClick={onSettingsOpen}>
            <Settings className="size-5" aria-hidden />
          </button>
        </div>

        {view !== "overview" && (
          <button type="button" className="secondary-button view-back-button" onClick={() => setView("overview")}>
            <ArrowLeft className="size-4" aria-hidden />
            Overview
          </button>
        )}

        {view === "overview" && (
          <>
            <div className="overview-metrics" aria-label="Request summary">
              <article>
                <span>{activeTasks.length}</span>
                <p>In progress</p>
              </article>
              <article>
                <span>{completedTasks.length}</span>
                <p>Finished</p>
              </article>
              <article>
                <span>{tasks.length}</span>
                <p>Total requests</p>
              </article>
            </div>

            <button
              type="button"
              className="dispatch-new-button"
              aria-label="Open new AnyRaven request"
              onClick={openNewRequest}
            >
              <Plus className="size-4" aria-hidden />
              New feature request
            </button>

            <div className="overview-actions" aria-label="AnyRaven sections">
              <button type="button" onClick={onSettingsOpen}>
                <Settings className="size-5" aria-hidden />
                <span>
                  <strong>Settings</strong>
                  <small>Connections, services, appearance, and defaults</small>
                </span>
              </button>
              <button type="button" onClick={() => setView("work-history")}>
                <History className="size-5" aria-hidden />
                <span>
                  <strong>Work history</strong>
                  <small>Completed work, failures, commits, and deployments</small>
                </span>
              </button>
              <button type="button" onClick={() => setView("feature-requests")}>
                <ListChecks className="size-5" aria-hidden />
                <span>
                  <strong>Feature requests</strong>
                  <small>Recent sessions and in-flight agent work</small>
                </span>
              </button>
            </div>

            <section className="section-list" aria-label="Recent feature requests">
              <div className="section-list-header">
                <div>
                  <p className="eyebrow">Recent</p>
                  <h3>Feature requests</h3>
                </div>
                {tasks.length > 0 && (
                  <button type="button" className="secondary-button" onClick={() => setView("feature-requests")}>
                    View all
                  </button>
                )}
              </div>
              <TaskList tasks={recentTasks} onCancel={stopTask} />
            </section>
          </>
        )}

        {view === "work-history" && (
          <section className="section-list" aria-label="Work history">
            <TaskList tasks={completedTasks} onCancel={stopTask} />
          </section>
        )}

        {view === "feature-requests" && (
          <section className="section-list" aria-label="Feature request history">
            <div className="section-list-header">
              <div>
                <p className="eyebrow">Sessions</p>
                <h3>Feature request history</h3>
              </div>
              <button type="button" className="dispatch-new-button" onClick={openNewRequest}>
                <Plus className="size-4" aria-hidden />
                New request
              </button>
            </div>
            <TaskList tasks={tasks} onCancel={stopTask} />
          </section>
        )}

        {!loading && view !== "work-history" && tasks.length === 0 && (
          <div className="empty-state">
            <MessageSquareText className="size-5" aria-hidden />
            <p>No requests yet.</p>
            <span>Start with a tracker, dashboard, reminder flow, or any small app improvement.</span>
          </div>
        )}

        {error && (
          <div className="assistant-message assistant-message-error" role="alert">
            <AlertCircle className="size-4" aria-hidden />
            <p>{error}</p>
          </div>
        )}

        {!loading && view === "work-history" && completedTasks.length === 0 && (
          <div className="empty-state">
            <History className="size-5" aria-hidden />
            <p>No completed work yet.</p>
            <span>Completed, failed, and cancelled requests will appear here.</span>
          </div>
        )}

        {loading && tasks.length === 0 && (
          <div className="assistant-message assistant-message-system">
            <Loader2 className="size-4 animate-spin" aria-hidden />
            <p>Loading tasks...</p>
          </div>
        )}
      </section>

      {open && <button type="button" className="sheet-backdrop" aria-label="Close new AnyRaven request" onClick={() => onOpenChange(false)} />}

      {open && (
        <aside className="assistant-panel" data-open={open} aria-label="New AnyRaven request" role="dialog" aria-modal={open}>
          <header className="sheet-header">
            <div>
              <p className="eyebrow">AnyRaven</p>
              <h2>New request</h2>
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

            <TaskList tasks={tasks} onCancel={stopTask} />
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
      )}
    </>
  );
}

function TaskList({ tasks, onCancel }: { tasks: TaskSummary[]; onCancel: (taskId: string) => void }) {
  if (tasks.length === 0) {
    return null;
  }

  return (
    <div className="task-list">
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
              <button type="button" className="cancel-button" onClick={() => onCancel(task.taskId)}>
                <Square className="size-3" aria-hidden />
                Cancel work
              </button>
            )}
          </article>
        );
      })}
    </div>
  );
}
