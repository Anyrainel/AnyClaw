import { useState, useEffect, useRef } from "react";
import { Sparkles, History, BookOpen, AlertCircle, Loader2 } from "lucide-react";
import type { UnsubscribeFunc } from "pocketbase";
import pb from "../lib/pocketbase.js";
import { usePreferences } from "../hooks/usePreferences.js";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface Tip {
  id: string;
  title: string;
  body: string;
  icon: string;
  created: string;
}

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const EXAMPLE_PROMPTS = [
  "Build me a daily mood tracker",
  "Set up a news feed for...",
  "Create a simple habit tracker",
] as const;

const ICON_MAP: Record<string, React.ElementType> = {
  Sparkles,
  History,
  BookOpen,
};

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function TipIcon({ name }: { name: string }) {
  const Icon = ICON_MAP[name] ?? Sparkles;
  return <Icon className="size-5 shrink-0 text-primary" aria-hidden />;
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function Welcome() {
  const [tips, setTips] = useState<Tip[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const unsubRef = useRef<UnsubscribeFunc | null>(null);
  const prefs = usePreferences();

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const res = await pb.collection("tips").getList<Tip>(1, 50);
        if (!cancelled) {
          setTips(res.items);
          setLoading(false);
        }
      } catch {
        if (!cancelled) {
          setError("Could not load tips. PocketBase may be starting up.");
          setLoading(false);
        }
      }

      try {
        const unsub = await pb.collection("tips").subscribe<Tip>("*", (e) => {
          if (cancelled) return;
          if (e.action === "create") setTips((t) => [...t, e.record]);
          if (e.action === "update")
            setTips((t) => t.map((r) => (r.id === e.record.id ? e.record : r)));
          if (e.action === "delete")
            setTips((t) => t.filter((r) => r.id !== e.record.id));
        });
        if (cancelled) unsub();
        else unsubRef.current = unsub;
      } catch {
        /* SSE unavailable — initial fetch is enough */
      }
    }

    load();
    return () => {
      cancelled = true;
      unsubRef.current?.();
    };
  }, []);

  return (
    <main className="mx-auto max-w-xl px-4 py-12">
      {/* Header */}
      <header className="mb-10 text-center">
        <h1 className="text-3xl font-bold tracking-tight text-foreground">
          Welcome to AnyClaw
        </h1>
        <p className="mt-3 text-base text-muted">
          Tap <strong>Request</strong> and describe what you want in plain
          words. The agent will build it for you.
        </p>
      </header>

      {/* Example prompts */}
      <section className="mb-10" aria-label="Example prompts">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-muted">
          Try something like...
        </h2>
        <ul className="space-y-2">
          {EXAMPLE_PROMPTS.map((prompt) => (
            <li
              key={prompt}
              className="rounded-lg bg-surface px-4 py-3 text-sm text-foreground shadow-sm"
            >
              &ldquo;{prompt}&rdquo;
            </li>
          ))}
        </ul>
      </section>

      {/* Tips (data-fetching demo) */}
      <section aria-label="Things to know">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-muted">
          Things to know
        </h2>

        {loading && (
          <div className="flex items-center gap-2 text-sm text-muted" role="status">
            <Loader2 className="size-4 animate-spin" aria-hidden />
            Loading tips...
          </div>
        )}

        {error && (
          <div className="flex items-center gap-2 rounded-lg bg-surface px-4 py-3 text-sm text-danger" role="alert">
            <AlertCircle className="size-4 shrink-0" aria-hidden />
            {error}
          </div>
        )}

        {!loading && !error && tips.length === 0 && (
          <p className="text-sm text-muted">
            No tips yet. The agent will populate this section as you use AnyClaw.
          </p>
        )}

        {!loading && !error && tips.length > 0 && (
          <ul className="space-y-3">
            {tips.map((tip) => (
              <li
                key={tip.id}
                className="flex items-start gap-3 rounded-lg bg-surface px-4 py-3 shadow-sm"
              >
                <TipIcon name={tip.icon} />
                <div>
                  <p className="text-sm font-medium text-foreground">
                    {tip.title}
                  </p>
                  <p className="mt-0.5 text-sm text-muted">{tip.body}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Footer */}
      <footer className="mt-12 text-center text-xs text-muted">
        Theme: {prefs.theme} &middot; Accent: {prefs.accent}
      </footer>
    </main>
  );
}

export default Welcome;
