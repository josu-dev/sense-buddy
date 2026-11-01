import { HAPTIC_PATTERNS } from "@sense-buddy/shared";
import * as Haptics from "expo-haptics";
import * as Speech from "expo-speech";
import { Vibration } from "react-native";
import { getTtsLang } from "./i18n";
import type { Prefs } from "./store";

/**
 * Buddy speaks (visual mode + Say mode). On-device TTS: free, offline, private.
 * `language` overrides the app language for this utterance only (Say-mode
 * per-message picker); when omitted the effective app language is used.
 *
 * Always resolves an explicit installed voice for the language (same as
 * `speakIn`): a bare `language` hint lets the OS silently substitute another
 * language's voice (e.g. Spanish text read with an English accent).
 */
export function speak(text: string, prefs: Prefs, onDone?: () => void, language?: string): Promise<void> {
  return speakIn(text, prefs, language ?? getTtsLang(), onDone);
}

/** Bumps on every speak/stop so a stale async lookup never talks over a newer action. */
let speakSeq = 0;

export function stopSpeaking() {
  speakSeq += 1;
  void Speech.stop();
}

type AvailVoice = Awaited<ReturnType<typeof Speech.getAvailableVoicesAsync>>[number];

/** Installed TTS voices, cached after the first lookup (can be slow on Android). */
let voiceCache: AvailVoice[] | null = null;

/**
 * Best installed voice for a BCP-47 tag: exact match (pt-BR), then same
 * language (pt-*). Passing an explicit `voice` stops the OS from silently
 * substituting another language's voice when the hint alone doesn't match.
 */
async function bestVoiceId(bcp47: string): Promise<string | undefined> {
  try {
    voiceCache ??= await Speech.getAvailableVoicesAsync();
  } catch {
    return undefined;
  }
  const norm = (s: string) => s.toLowerCase().replace(/_/g, "-");
  const want = norm(bcp47);
  const prefix = want.split("-")[0];
  return (
    voiceCache.find((v) => norm(v.language ?? "") === want)?.identifier ??
    voiceCache.find((v) => norm(v.language ?? "").startsWith(prefix))?.identifier
  );
}

/**
 * Speak in an explicit language with a matching installed voice (Say mode,
 * and now every `speak` caller too). Falls back to the language hint alone
 * when no matching voice is installed.
 */
export async function speakIn(text: string, prefs: Prefs, language: string, onDone?: () => void) {
  const seq = (speakSeq += 1);
  // Stop synchronously so the previous utterance cuts immediately instead of
  // playing on during the (potentially slow, first-call) voice lookup.
  void Speech.stop();
  const voice = await bestVoiceId(language);
  // Superseded while resolving (a newer speak/stop won): stay silent.
  if (seq !== speakSeq) return;
  Speech.speak(text, {
    rate: prefs.voiceRate,
    pitch: prefs.voicePitch,
    language,
    ...(voice ? { voice } : {}),
    onDone,
    onStopped: onDone,
    onError: onDone,
  });
}

/**
 * Warm the installed-voice cache at boot, so the very first utterance (e.g.
 * the first See description) already gets an explicit matching voice instead
 * of speaking after a slow lookup — or with the wrong accent.
 */
export function preloadVoices() {
  void bestVoiceId(getTtsLang()).catch(() => undefined);
}

/**
 * Distinct vibration patterns per alert priority, so a deaf user can tell a
 * doorbell (double buzz) from a siren (long triple buzz) without looking.
 */
export function vibrateFor(priority: "low" | "normal" | "high" | "critical", enabled: boolean) {
  if (!enabled) return;
  if (priority === "critical" || priority === "high") {
    void Haptics.notificationAsync(
      priority === "critical" ? Haptics.NotificationFeedbackType.Error : Haptics.NotificationFeedbackType.Warning,
    );
  } else {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  }
  Vibration.vibrate(HAPTIC_PATTERNS[priority] ?? HAPTIC_PATTERNS.normal);
}
