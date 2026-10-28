import { HAPTIC_PATTERNS } from "@sense-buddy/shared";
import * as Haptics from "expo-haptics";
import * as Speech from "expo-speech";
import { Vibration } from "react-native";
import type { Prefs } from "./store";

/** Buddy speaks (visual mode). On-device TTS: free, offline, private. */
export function speak(text: string, prefs: Prefs, onDone?: () => void) {
  Speech.stop();
  Speech.speak(text, {
    rate: prefs.voiceRate,
    pitch: prefs.voicePitch,
    onDone,
    onStopped: onDone,
    onError: onDone,
  });
}

export function stopSpeaking() {
  Speech.stop();
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
