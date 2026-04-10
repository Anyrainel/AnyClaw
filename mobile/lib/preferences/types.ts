export type ThemeSetting = "system" | "light" | "dark";
export type FontSizeSetting = "system" | "small" | "medium" | "large";
export type FontFamilySetting = "sans" | "serif";

export interface Preferences {
  theme: ThemeSetting;
  font_size: FontSizeSetting;
  font_family: FontFamilySetting;
  language: string;
  accent_color: string;
  onboarding_completed_at: string | null;
}

export const FONT_SCALE_MAP: Record<Exclude<FontSizeSetting, "system">, number> = {
  small: 0.85,
  medium: 1.0,
  large: 1.2,
};

export const DEFAULT_PREFERENCES: Preferences = {
  theme: "system",
  font_size: "system",
  font_family: "sans",
  language: "en",
  accent_color: "#6366f1",
  onboarding_completed_at: null,
};
