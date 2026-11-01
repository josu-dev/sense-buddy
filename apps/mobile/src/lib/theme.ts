import { useColorScheme, vars } from "nativewind";
import { useEffect } from "react";
import { useBuddyStore } from "./store";

/**
 * Light/dark theming, the Expo + NativeWind recommended way:
 *
 * - `userInterfaceStyle: "automatic"` (app.json) so the OS drives the system
 *   scheme; NativeWind's `useColorScheme` reads it and `setColorScheme`
 *   applies the user's manual override ("system" restores following).
 * - Semantic Tailwind colors (`bg-ink text-paper …`) are CSS variables
 *   (see tailwind.config.js); the root layout swaps their values via
 *   `themeVars` below, so screens need no `dark:` duplication.
 * - `useThemeColors()` covers everything classNames can't: inline `style`
 *   props, placeholders, shadows, StatusBar, GL clear color, etc.
 */

export type ThemePref = "system" | "light" | "dark";
export type AppTheme = "light" | "dark";

/** Space-separated RGB channels per theme. Dark mirrors the `:root` defaults. */
const DARK_CHANNELS = {
  "--sb-ink": "6 13 20",
  "--sb-panel": "13 27 41",
  "--sb-panel2": "18 37 57",
  "--sb-line": "30 52 72",
  "--sb-paper": "244 249 255",
  "--sb-muted": "159 180 199",
  "--sb-amber": "255 178 36",
  "--sb-cyanx": "62 230 255",
  "--sb-coral": "255 84 104",
  "--sb-mint": "61 219 168",
};

const LIGHT_CHANNELS = {
  "--sb-ink": "239 244 250",
  "--sb-panel": "255 255 255",
  "--sb-panel2": "228 238 246",
  "--sb-line": "195 211 227",
  "--sb-paper": "10 26 43",
  "--sb-muted": "76 106 132",
  "--sb-amber": "154 98 0",
  "--sb-cyanx": "11 126 153",
  "--sb-coral": "216 31 60",
  "--sb-mint": "14 124 91",
};

/** Apply on the root wrapper — variables cascade to every screen. */
export const themeVars = {
  dark: vars(DARK_CHANNELS),
  light: vars(LIGHT_CHANNELS),
};

/** Effective theme: manual preference, or the OS scheme when "system". */
export function useAppTheme(): AppTheme {
  const { colorScheme } = useColorScheme();
  return colorScheme ?? "dark";
}

/** Pushes the stored preference into NativeWind. Mount once at the root. */
export function ThemeSync() {
  const pref = useBuddyStore((s) => s.prefs.theme);
  const { setColorScheme } = useColorScheme();
  useEffect(() => {
    // Covers "system" plus any legacy/undefined value from old stores.
    setColorScheme(pref === "light" || pref === "dark" ? pref : "system");
  }, [pref, setColorScheme]);
  return null;
}

export type ThemeColors = {
  theme: AppTheme;
  isDark: boolean;
  /** Surfaces & text (mirror the CSS vars for inline styles). */
  ink: string;
  panel: string;
  panel2: string;
  line: string;
  paper: string;
  muted: string;
  /** Mode accents readable as *text* on surfaces (fills stay vivid). */
  accentText: { visual: string; hearing: string; speak: string };
  /** Text on vivid accent fills — same in both themes. */
  onAccent: string;
  onAccentSub: string;
  onAmber: string;
  onCyan: string;
  /** BigButton hint next to dark text. */
  onTintMuted: string;
  /** Unselected pill text. */
  tabIdle: string;
  placeholder: string;
  /** Secondary (non-accent) button fill. */
  secondary: string;
  /** Destructive actions (mirrors the coral var for inline styles). */
  danger: string;
  /** Translucent overlay panels (notch, menus, cards, PiP). */
  scrim: string;
  scrimStrong: string;
  /** Apple sign-in button (white in dark, black in light). */
  appleBtn: string;
  appleBtnText: string;
  /** Orb: GL corner-fade color (0..1) + non-GL fallback disc. */
  orbAbyss: [number, number, number];
  orbFallback: string;
};

const DARK_COLORS: ThemeColors = {
  theme: "dark",
  isDark: true,
  ink: "#060D14",
  panel: "#0D1B29",
  panel2: "#122539",
  line: "#1E3448",
  paper: "#F4F9FF",
  muted: "#9FB4C7",
  accentText: { visual: "#FFB224", hearing: "#3EE6FF", speak: "#A78BFA" },
  onAccent: "#060D14",
  onAccentSub: "#243447",
  onAmber: "#2A1A00",
  onCyan: "#04211C",
  onTintMuted: "#3A2A00",
  tabIdle: "#8FA6B8",
  placeholder: "#5E7A94",
  secondary: "#122539",
  danger: "#FF5468",
  scrim: "rgba(10,24,38,0.82)",
  scrimStrong: "rgba(10,24,38,0.88)",
  appleBtn: "#F4F9FF",
  appleBtnText: "#060D14",
  orbAbyss: [0.023, 0.051, 0.078],
  orbFallback: "#0A2530",
};

const LIGHT_COLORS: ThemeColors = {
  theme: "light",
  isDark: false,
  ink: "#EFF4FA",
  panel: "#FFFFFF",
  panel2: "#E4EDF6",
  line: "#C3D3E3",
  paper: "#0A1A2B",
  muted: "#4C6A84",
  accentText: { visual: "#9A6200", hearing: "#0B7E99", speak: "#6D28D9" },
  onAccent: "#060D14",
  onAccentSub: "#243447",
  onAmber: "#2A1A00",
  onCyan: "#04211C",
  onTintMuted: "#4C6A84",
  tabIdle: "#5B7A94",
  placeholder: "#7C93A8",
  secondary: "#E4EDF6",
  danger: "#D81F3C",
  scrim: "rgba(255,255,255,0.88)",
  scrimStrong: "rgba(255,255,255,0.94)",
  appleBtn: "#0A1A2B",
  appleBtnText: "#FFFFFF",
  orbAbyss: [0.937, 0.957, 0.98],
  orbFallback: "#DCE8F3",
};

/** Concrete hex/rgba tokens for inline styles in the effective theme. */
export function useThemeColors(): ThemeColors {
  const theme = useAppTheme();
  return theme === "dark" ? DARK_COLORS : LIGHT_COLORS;
}
