import { useEffect, useMemo, useState, type CSSProperties } from "react";
import {
  Bell,
  BookOpen,
  Bot,
  Home,
  Search,
  Sparkles,
} from "lucide-react";
import { AssistantPanel } from "../components/AssistantPanel.js";
import { SettingsSheet } from "../components/SettingsSheet.js";
import { usePreferences } from "../hooks/usePreferences.js";

export interface ShellPreferences {
  theme: "system" | "light" | "dark";
  fontSize: "small" | "medium" | "large";
  fontFamily: "sans" | "serif";
  density: "compact" | "comfortable" | "spacious";
  accent: "blue" | "teal" | "green" | "amber" | "rose" | "violet";
  language: string;
}

const LEVEL_ONE = [
  { id: "home", label: "Home", icon: Home },
  { id: "tutorial", label: "Tutorial", icon: BookOpen },
  { id: "anyraven", label: "AnyRaven", icon: Bot },
] as const;

const TUTORIAL_SECTIONS = [
  {
    title: "Ask for a small tool",
    body: "Example: Build a daily habit tracker with streaks and a weekly summary.",
    meta: "Starter prompt",
  },
  {
    title: "Answer only product questions",
    body: "The agent should make normal engineering decisions and ask only when requirements change the result.",
    meta: "Workflow",
  },
  {
    title: "Review what shipped",
    body: "Use AnyRaven to see previous requests, progress, failures, commits, and deployments.",
    meta: "History",
  },
] as const;

function readStoredPreferences(base: ShellPreferences): ShellPreferences {
  if (typeof localStorage === "undefined") return base;
  try {
    const raw = localStorage.getItem("anyraven_shell_preferences");
    return raw ? { ...base, ...JSON.parse(raw) } : base;
  } catch {
    return base;
  }
}

function toCssVars(preferences: ShellPreferences) {
  return {
    "--shell-accent": `var(--accent-${preferences.accent})`,
    "--shell-font-scale": preferences.fontSize === "small" ? "0.94" : preferences.fontSize === "large" ? "1.08" : "1",
    "--shell-density": preferences.density === "compact" ? "0.82" : preferences.density === "spacious" ? "1.18" : "1",
    "--shell-font-family": preferences.fontFamily === "serif" ? "Georgia, Cambria, serif" : "Inter, ui-sans-serif, system-ui, sans-serif",
  } as CSSProperties;
}

function HomePanel() {
  return (
    <section className="hero-panel" aria-label="Welcome">
      <div className="hero-icon" aria-hidden>
        <Sparkles className="size-6" />
      </div>
      <div>
        <p className="eyebrow">Welcome</p>
        <h2>Your app starts here.</h2>
        <p>
          This home tab is part of the free canvas. Ask AnyRaven to build
          real features, and the agent can replace this content with the tools
          you actually use.
        </p>
      </div>
    </section>
  );
}

function TutorialPanel() {
  return (
    <section className="section-list" aria-label="Tutorial examples">
      <div className="section-list-header">
        <div>
          <p className="eyebrow">Tutorial</p>
          <h2>Examples for you and the agent</h2>
        </div>
      </div>
      <div className="section-items">
        {TUTORIAL_SECTIONS.map((section) => (
          <article className="section-item" key={section.title}>
            <div>
              <h3>{section.title}</h3>
              <p>{section.body}</p>
            </div>
            <span>{section.meta}</span>
          </article>
        ))}
      </div>
      <p className="canvas-note">
        This tutorial is starter material for the free canvas. The agent can
        replace it once the app has a more useful onboarding flow.
      </p>
    </section>
  );
}

export function Welcome() {
  const serverPrefs = usePreferences();
  const [levelOne, setLevelOne] = useState<(typeof LEVEL_ONE)[number]["id"]>("home");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [dispatchOpen, setDispatchOpen] = useState(false);
  const [preferences, setPreferences] = useState<ShellPreferences>(() =>
    readStoredPreferences({
      theme: serverPrefs.theme,
      fontSize: serverPrefs.fontSize,
      fontFamily: serverPrefs.fontFamily,
      density: "comfortable",
      accent: serverPrefs.accent,
      language: serverPrefs.language,
    }),
  );

  useEffect(() => {
    setPreferences((current) =>
      readStoredPreferences({
        ...current,
        theme: serverPrefs.theme,
        fontSize: serverPrefs.fontSize,
        fontFamily: serverPrefs.fontFamily,
        accent: serverPrefs.accent,
        language: serverPrefs.language,
      }),
    );
  }, [serverPrefs.accent, serverPrefs.fontFamily, serverPrefs.fontSize, serverPrefs.language, serverPrefs.theme]);

  useEffect(() => {
    localStorage.setItem("anyraven_shell_preferences", JSON.stringify(preferences));
  }, [preferences]);

  const activeSection = LEVEL_ONE.find((item) => item.id === levelOne) ?? LEVEL_ONE[0];
  const cssVars = useMemo(() => toCssVars(preferences), [preferences]);

  return (
    <div
      className="app-shell"
      data-theme={preferences.theme}
      data-density={preferences.density}
      style={cssVars}
    >
      <aside className="desktop-rail" aria-label="Primary">
        <div className="brand-mark" aria-label="AnyRaven">
          <Sparkles className="size-5" aria-hidden />
        </div>
        <nav>
          {LEVEL_ONE.map((item) => {
            const Icon = item.icon;
            return (
              <button key={item.id} type="button" data-active={levelOne === item.id} onClick={() => setLevelOne(item.id)}>
                <Icon className="size-5" aria-hidden />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>
      </aside>

      <div className="shell-main">
        <header className="top-bar">
          <div className="mobile-brand" aria-label="AnyRaven">
            <Sparkles className="size-5" aria-hidden />
          </div>
          <div>
            <p className="eyebrow">AnyRaven</p>
            <h1>{activeSection.label}</h1>
          </div>
          <div className="top-actions">
            <button type="button" className="icon-button" aria-label="Search">
              <Search className="size-5" aria-hidden />
            </button>
            <button type="button" className="icon-button" aria-label="Notifications">
              <Bell className="size-5" aria-hidden />
            </button>
          </div>
        </header>

        <main className="workspace" aria-label="Workspace">
          {levelOne === "home" && <HomePanel />}
          {levelOne === "tutorial" && <TutorialPanel />}
          {levelOne === "anyraven" && (
            <AssistantPanel
              open={dispatchOpen}
              onOpenChange={setDispatchOpen}
              onSettingsOpen={() => setSettingsOpen(true)}
            />
          )}
        </main>
      </div>

      <nav className="bottom-tabs" aria-label="Primary">
        {LEVEL_ONE.map((item) => {
          const Icon = item.icon;
          return (
            <button key={item.id} type="button" data-active={levelOne === item.id} onClick={() => setLevelOne(item.id)}>
              <Icon className="size-5" aria-hidden />
              <span>{item.label}</span>
            </button>
          );
        })}
      </nav>

      <SettingsSheet open={settingsOpen} preferences={preferences} onChange={setPreferences} onOpenChange={setSettingsOpen} />
    </div>
  );
}

export default Welcome;
