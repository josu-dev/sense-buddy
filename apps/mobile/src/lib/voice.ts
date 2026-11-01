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
 */
export function speak(text: string, prefs: Prefs, onDone?: () => void, language?: string) {
  Speech.stop();
  Speech.speak(text, {
    rate: prefs.voiceRate,
    pitch: prefs.voicePitch,
    language: language ?? getTtsLang(),
    onDone,
    onStopped: onDone,
    onError: onDone,
  });
}

export function stopSpeaking() {
  Speech.stop();
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
  const norm = (s: string) => s.toLowerCase().replace("_", "-");
  const want = norm(bcp47);
  const prefix = want.split("-")[0];
  return (
    voiceCache.find((v) => norm(v.language ?? "") === want)?.identifier ??
    voiceCache.find((v) => norm(v.language ?? "").startsWith(prefix))?.identifier
  );
}

/**
 * Speak in an explicit language with a matching installed voice (Say mode).
 * Falls back to the language hint alone when no matching voice is installed.
 */
export async function speakIn(text: string, prefs: Prefs, language: string, onDone?: () => void) {
  const voice = await bestVoiceId(language);
  Speech.stop();
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
