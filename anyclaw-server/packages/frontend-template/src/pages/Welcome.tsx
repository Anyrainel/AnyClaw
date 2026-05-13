import { useState, useEffect, useRef, useCallback } from "react";
import { Sparkles, Send, Loader2, AlertCircle, CheckCircle, XCircle, RefreshCw } from "lucide-react";
import { createTask, listTasks, getTask, cancelTask, type TaskSummary } from "../lib/dispatch-api.js";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface TaskView extends TaskSummary {
  isLoading?: boolean;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function stateIcon(state: string) {
  switch (state) {
    case "done": return <CheckCircle className="size-4 text-success" aria-hidden />;
    case "failed": return <XCircle className="size-4 text-danger" aria-hidden />;
    case "cancelled": return <XCircle className="size-4 text-muted" aria-hidden />;
    case "working": return <Loader2 className="size-4 animate-spin text-primary" aria-hidden />;
    case "clarifying": return <AlertCircle className="size-4 text-warning" aria-hidden />;
    case "deploying": return <Loader2 className="size-4 animate-spin text-primary" aria-hidden />;
    default: return <Sparkles className="size-4 text-muted" aria-hidden />;
  }
}

function stateLabel(state: string): string {
  return state.charAt(0).toUpperCase() + state.slice(1);
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function Welcome() {
  const [prompt, setPrompt] = useState("");
  const [tasks, setTasks] = useState<TaskView[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Load tasks on mount
  useEffect(() => {
    loadTasks();
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  // Poll active tasks every 3s
  useEffect(() => {
    const active = tasks.filter(t => t.state === "queued" || t.state === "working" || t.state === "clarifying" || t.state === "deploying");
    if (active.length > 0 && !pollRef.current) {
      pollRef.current = setInterval(() => {
        refreshActiveTasks();
      }, 3000);
    } else if (active.length === 0 && pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    return () => {
      if (pollRef.current && active.length === 0) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [tasks]);

  const loadTasks = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await listTasks();
      setTasks(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const refreshActiveTasks = async () => {
    setTasks(prev =>
      prev.map(t =>
        t.state === "queued" || t.state === "working" || t.state === "clarifying" || t.state === "deploying"
          ? { ...t, isLoading: true }
          : t
      )
    );
    try {
      const data = await listTasks();
      setTasks(data);
    } catch {
      // silently fail on poll
    }
  };

  const handleSubmit = useCallback(async () => {
    if (!prompt.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const taskId = crypto.randomUUID();
      await createTask({ taskId, request: prompt.trim() });
      setPrompt("");
      await loadTasks();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  }, [prompt]);

  const handleCancel = async (taskId: string) => {
    try {
      await cancelTask(taskId);
      await loadTasks();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <main className="mx-auto max-w-2xl px-4 py-8">
      {/* Header */}
      <header className="mb-8 text-center">
        <h1 className="text-3xl font-bold tracking-tight text-foreground">
          AnyClaw
        </h1>
        <p className="mt-2 text-base text-muted">
          Describe what you want and the agent will build it.
        </p>
      </header>

      {/* Task input */}
      <section className="mb-8" aria-label="New task">
        <div className="flex gap-2">
          <input
            type="text"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
            placeholder="e.g. Build me a daily mood tracker"
            className="flex-1 rounded-lg border border-border bg-white px-4 py-3 text-sm text-foreground shadow-sm outline-none focus:ring-2 focus:ring-primary"
            disabled={submitting}
          />
          <button
            onClick={handleSubmit}
            disabled={submitting || !prompt.trim()}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-3 text-sm font-medium text-white shadow-sm hover:bg-primary-hover disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {submitting ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : (
              <Send className="size-4" aria-hidden />
            )}
            {submitting ? "Sending..." : "Request"}
          </button>
        </div>
      </section>

      {/* Error */}
      {error && (
        <div className="mb-6 flex items-center gap-2 rounded-lg bg-surface px-4 py-3 text-sm text-danger" role="alert">
          <AlertCircle className="size-4 shrink-0" aria-hidden />
          {error}
        </div>
      )}

      {/* Task list */}
      <section aria-label="Tasks">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">
            Tasks
          </h2>
          <button
            onClick={loadTasks}
            disabled={loading}
            className="inline-flex items-center gap-1 text-xs text-muted hover:text-foreground disabled:opacity-50"
          >
            <RefreshCw className={`size-3 ${loading ? "animate-spin" : ""}`} aria-hidden />
            Refresh
          </button>
        </div>

        {tasks.length === 0 && !loading && (
          <p className="text-sm text-muted">
            No tasks yet. Type something above and hit Request.
          </p>
        )}

        <ul className="space-y-3">
          {tasks.map((task) => (
            <li
              key={task.taskId}
              className="rounded-lg border border-border bg-surface px-4 py-3 shadow-sm"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    {stateIcon(task.state)}
                    <span className="text-xs font-medium uppercase tracking-wide text-muted">
                      {stateLabel(task.state)}
                    </span>
                    {task.isLoading && (
                      <Loader2 className="size-3 animate-spin text-muted" aria-hidden />
                    )}
                  </div>
                  <p className="mt-1 truncate text-sm text-foreground">
                    {task.request || task.taskId}
                  </p>
                  {task.progressSummary && (
                    <p className="mt-1 text-xs text-muted line-clamp-2">
                      {task.progressSummary}
                    </p>
                  )}
                  {task.error && (
                    <p className="mt-1 text-xs text-danger line-clamp-2">
                      {task.error}
                    </p>
                  )}
                </div>
                {(task.state === "queued" || task.state === "working" || task.state === "clarifying") && (
                  <button
                    onClick={() => handleCancel(task.taskId)}
                    className="shrink-0 rounded-md px-2 py-1 text-xs text-danger hover:bg-surface"
                  >
                    Cancel
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}

export default Welcome;
