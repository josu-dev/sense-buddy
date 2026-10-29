import { AccessibilityInfo } from "react-native";

/** Speak a dynamic change through the OS screen reader (no-op if it's off). */
export function announce(message: string) {
  AccessibilityInfo.announceForAccessibility(message);
}
