import { Palette, Settings, SlidersHorizontal, Wifi, X } from "lucide-react";
import type { ShellPreferences } from "../pages/Welcome.js";

const THEME_OPTIONS = ["system", "light", "dark"] as const;
const FONT_SIZE_OPTIONS = ["small", "medium", "large"] as const;
const FONT_FAMILY_OPTIONS = ["sans", "serif"] as const;
const DENSITY_OPTIONS = ["compact", "comfortable", "spacious"] as const;
const ACCENT_OPTIONS = ["blue", "teal", "green", "amber", "rose", "violet"] as const;

interface SettingsSheetProps {
  open: boolean;
  preferences: ShellPreferences;
  onChange: (preferences: ShellPreferences) => void;
  onOpenChange: (open: boolean) => void;
}

function titleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export function SettingsSheet({ open, preferences, onChange, onOpenChange }: SettingsSheetProps) {
  function update<Key extends keyof ShellPreferences>(key: Key, value: ShellPreferences[Key]) {
    onChange({ ...preferences, [key]: value });
  }

  return (
    <>
      {open && <button type="button" className="sheet-backdrop" aria-label="Close settings" onClick={() => onOpenChange(false)} />}
      <aside className="settings-sheet" data-open={open} aria-label="Settings" aria-hidden={!open}>
        <header className="sheet-header">
          <div>
            <p className="eyebrow">Global</p>
            <h2>Settings</h2>
          </div>
          <button type="button" className="icon-button" aria-label="Close" onClick={() => onOpenChange(false)}>
            <X className="size-5" aria-hidden />
          </button>
        </header>

        <div className="settings-content">
          <section className="settings-section" aria-labelledby="connections-title">
            <div className="settings-section-title">
              <Wifi className="size-4" aria-hidden />
              <h3 id="connections-title">Connections</h3>
            </div>
            <p>Future server, agent, API key, and tunnel controls belong here.</p>
            <button type="button" className="secondary-button" disabled>
              Manage connections
            </button>
          </section>

          <section className="settings-section" aria-labelledby="appearance-title">
            <div className="settings-section-title">
              <Palette className="size-4" aria-hidden />
              <h3 id="appearance-title">Appearance</h3>
            </div>

            <label>
              <span>Theme mode</span>
              <select value={preferences.theme} onChange={(event) => update("theme", event.target.value as ShellPreferences["theme"])}>
                {THEME_OPTIONS.map((theme) => (
                  <option key={theme} value={theme}>{titleCase(theme)}</option>
                ))}
              </select>
            </label>

            <label>
              <span>Font size</span>
              <select value={preferences.fontSize} onChange={(event) => update("fontSize", event.target.value as ShellPreferences["fontSize"])}>
                {FONT_SIZE_OPTIONS.map((size) => (
                  <option key={size} value={size}>{titleCase(size)}</option>
                ))}
              </select>
            </label>

            <label>
              <span>Font family</span>
              <select value={preferences.fontFamily} onChange={(event) => update("fontFamily", event.target.value as ShellPreferences["fontFamily"])}>
                {FONT_FAMILY_OPTIONS.map((family) => (
                  <option key={family} value={family}>{titleCase(family)}</option>
                ))}
              </select>
            </label>
          </section>

          <section className="settings-section" aria-labelledby="layout-title">
            <div className="settings-section-title">
              <SlidersHorizontal className="size-4" aria-hidden />
              <h3 id="layout-title">Layout</h3>
            </div>

            <div className="segmented-control" aria-label="Density">
              {DENSITY_OPTIONS.map((density) => (
                <button
                  key={density}
                  type="button"
                  data-active={preferences.density === density}
                  onClick={() => update("density", density)}
                >
                  {titleCase(density)}
                </button>
              ))}
            </div>

            <label>
              <span>Accent color</span>
              <div className="swatch-row" role="radiogroup" aria-label="Accent color">
                {ACCENT_OPTIONS.map((accent) => (
                  <button
                    key={accent}
                    type="button"
                    className={`accent-swatch accent-${accent}`}
                    data-active={preferences.accent === accent}
                    aria-label={titleCase(accent)}
                    aria-checked={preferences.accent === accent}
                    role="radio"
                    onClick={() => update("accent", accent)}
                  />
                ))}
              </div>
            </label>

            <label>
              <span>Language</span>
              <select value={preferences.language} onChange={(event) => update("language", event.target.value)}>
                <option value="en-US">English (US)</option>
                <option value="es-US">Spanish (US)</option>
                <option value="fr-FR">French</option>
                <option value="de-DE">German</option>
                <option value="ja-JP">Japanese</option>
              </select>
            </label>
          </section>

          <section className="settings-section" aria-labelledby="agent-title">
            <div className="settings-section-title">
              <Settings className="size-4" aria-hidden />
              <h3 id="agent-title">Agent defaults</h3>
            </div>
            <p>Settings update this template immediately and can be wired to persisted user preferences later.</p>
          </section>
        </div>
      </aside>
    </>
  );
}
