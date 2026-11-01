import type { PreferencePatch } from "@sense-buddy/shared";
import { api } from "./api";
import { useBuddyStore, type Prefs } from "./store";

/**
 * Two-way sync between the local zustand store (AsyncStorage) and the server
 * `preference` row — the persisted user profile.
 *
 * - New users push their onboarding choices up right after login.
 * - Returning users hydrate the saved profile down (language included), so a
 *   reinstall or a second device keeps speaking their language.
 * - Every Settings change pushes immediately (fire-and-forget, offline-safe).
 */

/** Push the full local profile (mode + prefs) to the server. */
export function pushPreferences() {
  const { mode, prefs } = useBuddyStore.getState();
  const body: PreferencePatch = {
    mode,
    language: prefs.language,
    theme: prefs.theme,
    voiceRate: prefs.voiceRate,
    voicePitch: prefs.voicePitch,
    hapticsEnabled: prefs.hapticsEnabled,
    stickySenseAudio: prefs.stickySenseAudio,
    captionSize: prefs.captionSize,
    highContrast: prefs.highContrast,
    userName: prefs.userName,
    emergencyName: prefs.emergencyName,
    emergencyPhone: prefs.emergencyPhone,
  };
  void api.syncPreferences(body);
}

/** Pull the saved server profile into the local store. Throws when offline. */
export async function hydratePreferences(): Promise<void> {
  const me = await api.me();
  const p = me.preference;
  if (!p) return;
  const { setMode, updatePrefs } = useBuddyStore.getState();
  if (p.mode === "visual" || p.mode === "hearing" || p.mode === "speak") setMode(p.mode);
  const patch: Partial<Prefs> = {};
  if (p.language === "system" || p.language === "en" || p.language === "es" || p.language === "pt" || p.language === "fr") {
    patch.language = p.language;
  }
  if (p.theme === "system" || p.theme === "light" || p.theme === "dark") {
    patch.theme = p.theme;
  }
  if (typeof p.voiceRate === "number") patch.voiceRate = p.voiceRate;
  if (typeof p.voicePitch === "number") patch.voicePitch = p.voicePitch;
  if (typeof p.hapticsEnabled === "boolean") patch.hapticsEnabled = p.hapticsEnabled;
  if (typeof p.stickySenseAudio === "boolean") patch.stickySenseAudio = p.stickySenseAudio;
  if (p.captionSize === "large" || p.captionSize === "xlarge") patch.captionSize = p.captionSize;
  if (typeof p.highContrast === "boolean") patch.highContrast = p.highContrast;
  if (typeof p.userName === "string") patch.userName = p.userName;
  if (typeof p.emergencyName === "string") patch.emergencyName = p.emergencyName;
  if (typeof p.emergencyPhone === "string") patch.emergencyPhone = p.emergencyPhone;
  updatePrefs(patch);
}
