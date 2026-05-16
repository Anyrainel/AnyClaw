import { useEffect, useMemo, useState, type CSSProperties } from "react";
import {
  Activity,
  Bell,
  ChevronRight,
  ClipboardList,
  Home,
  Layers3,
  Plus,
  Search,
  Settings,
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
  { id: "work", label: "Work", icon: ClipboardList },
  { id: "activity", label: "Activity", icon: Activity },
  { id: "library", label: "Library", icon: Layers3 },
] as const;

const LEVEL_TWO = [
  { id: "overview", label: "Overview" },
  { id: "requests", label: "Requests" },
  { id: "versions", label: "Versions" },
] as const;

const LEVEL_THREE = ["Home", "Workspace", "Today"] as const;

const SAMPLE_SECTIONS = [
  {
    title: "Today",
    body: "A stable landing area for the first real feature the agent builds.",
    meta: "Ready for content",
  },
  {
    title: "Requests",
    body: "Recent software-building tasks, clarifications, and status updates.",
    meta: "Dispatch-aware",
  },
  {
    title: "Versions",
    body: "A future home for deployment notes, commits, and rollback controls.",
    meta: "Version surface",
  },
] as const;

function readStoredPreferences(base: ShellPreferences): ShellPreferences {
  if (typeof localStorage === "undefined") return base;
  try {
    const raw = localStorage.getItem("anyclaw_shell_preferences");
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

export function Welcome() {
  const serverPrefs = usePreferences();
  const [levelOne, setLevelOne] = useState<(typeof LEVEL_ONE)[number]["id"]>("home");
  const [levelTwo, setLevelTwo] = useState<(typeof LEVEL_TWO)[number]["id"]>("overview");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [assistantOpen, setAssistantOpen] = useState(false);
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
    localStorage.setItem("anyclaw_shell_preferences", JSON.stringify(preferences));
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
        <div className="brand-mark" aria-label="AnyClaw">
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
        <button type="button" className="rail-settings" aria-label="Open settings" onClick={() => setSettingsOpen(true)}>
          <Settings className="size-5" aria-hidden />
        </button>
      </aside>

      <div className="shell-main">
        <header className="top-bar">
          <div className="mobile-brand" aria-label="AnyClaw">
            <Sparkles className="size-5" aria-hidden />
          </div>
          <div>
            <p className="eyebrow">AnyClaw</p>
            <h1>{activeSection.label}</h1>
          </div>
          <div className="top-actions">
            <button type="button" className="icon-button" aria-label="Search">
              <Search className="size-5" aria-hidden />
            </button>
            <button type="button" className="icon-button" aria-label="Notifications">
              <Bell className="size-5" aria-hidden />
            </button>
            <button type="button" className="icon-button" aria-label="Open settings" onClick={() => setSettingsOpen(true)}>
              <Settings className="size-5" aria-hidden />
            </button>
          </div>
        </header>

        <main className="workspace" aria-label="Workspace">
          <nav className="level-two-tabs" aria-label="Section">
            {LEVEL_TWO.map((item) => (
              <button key={item.id} type="button" data-active={levelTwo === item.id} onClick={() => setLevelTwo(item.id)}>
                {item.label}
              </button>
            ))}
          </nav>

          <nav className="breadcrumb-nav" aria-label="Current location">
            {LEVEL_THREE.map((item, index) => (
              <span key={item}>
                {index > 0 && <ChevronRight className="size-3" aria-hidden />}
                {item}
              </span>
            ))}
          </nav>

          <section className="section-list" aria-label="Default sections">
            <div className="section-list-header">
              <div>
                <p className="eyebrow">Starter structure</p>
                <h2>{LEVEL_TWO.find((item) => item.id === levelTwo)?.label}</h2>
              </div>
              <button type="button" className="primary-button">
                <Plus className="size-4" aria-hidden />
                Add section
              </button>
            </div>

            <div className="section-items">
              {SAMPLE_SECTIONS.map((section) => (
                <article className="section-item" key={section.title}>
                  <div>
                    <h3>{section.title}</h3>
                    <p>{section.body}</p>
                  </div>
                  <span>{section.meta}</span>
                </article>
              ))}
            </div>
          </section>
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
      <AssistantPanel open={assistantOpen} onOpenChange={setAssistantOpen} />
    </div>
  );
}

export default Welcome;
