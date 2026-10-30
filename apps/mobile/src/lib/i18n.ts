import { getLocales, useLocales, type Locale } from "expo-localization";
import { I18n } from "i18n-js";
import { useMemo } from "react";
import { en } from "./locales/en";
import { es } from "./locales/es";
import { fr } from "./locales/fr";
import { pt } from "./locales/pt";
import { useBuddyStore } from "./store";

/**
 * Localization, the Expo-recommended way:
 * `expo-localization` (device language) + `i18n-js` (translations) +
 * per-locale files under `lib/locales/`.
 *
 * - Effective language = manual preference, or the phone's preferred locale
 *   when the preference is "system" (the default).
 * - English is the fallback everywhere: unknown device language, missing key
 *   (`enableFallback`), and server-side `LangSchema` default.
 * - The preference lives in the zustand store (AsyncStorage) and is mirrored
 *   to the server `preference` row, so it follows the user profile.
 */

/** Keep in sync with shared `LangSchema` (en = fallback). */
export type AppLang = "en" | "es" | "pt" | "fr";
export type LangPref = AppLang | "system";

export const APP_LANGS: AppLang[] = ["en", "es", "pt", "fr"];

export const LANG_LABELS: Record<AppLang, string> = {
  en: "English",
  es: "Español",
  pt: "Português",
  fr: "Français",
};

/** expo-speech / Intl BCP-47 tags per app language. */
export const LANG_TTS: Record<AppLang, string> = {
  en: "en-US",
  es: "es-ES",
  pt: "pt-BR",
  fr: "fr-FR",
};

export type StringKey = keyof typeof en;
const EN_KEYS = Object.keys(en) as StringKey[];

export const i18n = new I18n({ en, es, pt, fr });
i18n.enableFallback = true;
i18n.defaultLocale = "en";

function langFromCode(code: string | null | undefined): AppLang | null {
  if (!code) return null;
  const c = code.toLowerCase();
  if (c.startsWith("pt")) return "pt";
  if (c.startsWith("fr")) return "fr";
  if (c.startsWith("es")) return "es";
  if (c.startsWith("en")) return "en";
  return null;
}

/**
 * Device language: walk the phone's preferred locales in order and pick the
 * first one we support (en/es/pt/fr), falling back to English.
 */
export function getDeviceLang(locales: readonly Locale[] = getLocales()): AppLang {
  try {
    for (const locale of locales) {
      const hit = langFromCode(locale.languageCode) ?? langFromCode(locale.languageTag);
      if (hit) return hit;
    }
    return "en";
  } catch {
    return "en";
  }
}

/** Manual preference, or phone language when "system"/unset/legacy. */
export function resolveLang(pref: unknown, locales?: readonly Locale[]): AppLang {
  if (pref === "en" || pref === "es" || pref === "pt" || pref === "fr") return pref;
  return getDeviceLang(locales);
}

/** Effective app language (imperative, for api/voice/storage layers). */
export function getAppLang(): AppLang {
  return resolveLang(useBuddyStore.getState().prefs.language);
}

/** TTS voice tag for the effective app language. */
export function getTtsLang(): string {
  return LANG_TTS[getAppLang()];
}

/** Keep the global i18n-js locale in sync with the stored preference. */
function syncI18nLocale() {
  i18n.locale = getAppLang();
}
syncI18nLocale();
useBuddyStore.subscribe((s) => {
  i18n.locale = resolveLang(s.prefs.language);
});

/** Imperative translate with the effective locale (supports interpolation). */
export function t(key: StringKey, vars?: Record<string, string | number>): string {
  return i18n.t(key, { locale: getAppLang(), ...vars });
}

/**
 * Effective language as a hook. Re-renders when the stored preference changes
 * or when the OS locale list changes (expo-localization `useLocales`).
 */
export function useAppLang(): AppLang {
  const pref = useBuddyStore((s) => s.prefs.language);
  const deviceLocales = useLocales();
  return resolveLang(pref, deviceLocales);
}

/**
 * Current dictionary; re-renders the component when the effective language
 * changes. Resolved through i18n-js so missing keys fall back to English.
 */
export function useStrings(): Record<StringKey, string> {
  const lang = useAppLang();
  return useMemo(() => {
    const out = {} as Record<StringKey, string>;
    for (const k of EN_KEYS) out[k] = i18n.t(k, { locale: lang });
    return out;
  }, [lang]);
}

/** Locale-aware number formatting (Intl API) in the effective language. */
export function formatNumber(n: number): string {
  try {
    return new Intl.NumberFormat(LANG_TTS[getAppLang()]).format(n);
  } catch {
    return String(n);
  }
}
