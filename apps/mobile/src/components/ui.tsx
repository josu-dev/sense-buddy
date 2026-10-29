import type { Mode } from "@sense-buddy/shared";
import { router, usePathname } from "expo-router";
import { useEffect, useState, type ReactNode } from "react";
import { Modal, Pressable, Text, View } from "react-native";
import Animated, {
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";
import { useStrings } from "../lib/i18n";
import { useSense } from "../lib/sense";
import { useBuddyStore } from "../lib/store";

export const ACCENT = { visual: "#FFB224", hearing: "#3EE6FF" } as const;

export function Screen({ children }: { children: ReactNode }) {
  return (
    <SafeAreaView className="flex-1 bg-ink">
      <View className="flex-1 px-5 pt-3">{children}</View>
    </SafeAreaView>
  );
}

export function BigButton({
  label,
  hint,
  onPress,
  color = "#FFB224",
  dark = true,
  disabled,
}: {
  label: string;
  hint?: string;
  onPress: () => void;
  color?: string;
  dark?: boolean;
  disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={hint}
      className="min-h-[72px] items-center justify-center rounded-3xl px-5 py-4 active:opacity-80"
      style={{ backgroundColor: disabled ? "#1E3448" : color }}
    >
      <Text className="text-center text-xl font-bold" style={{ color: dark ? "#060D14" : "#F4F9FF" }}>
        {label}
      </Text>
      {hint ? (
        <Text className="mt-0.5 text-center text-sm" style={{ color: dark ? "#3A2A00" : "#9FB4C7" }}>
          {hint}
        </Text>
      ) : null}
    </Pressable>
  );
}

/**
 * Top notch: pill with two tabs — View / Listen.
 * Rendered ONCE by sense/_layout above the Tabs navigator, so it never
 * remounts on tab switches. Navigation only — it never touches global
 * `mode` itself; the layout syncs the preference after the tab commits
 * (the old setMode-before-navigate was the main flash source).
 */
export function ModeNotch() {
  const { tab: activeTab, goSee, goListen } = useSense();
  const S = useStrings();
  const active: Mode = activeTab === "see" ? "visual" : "hearing";

  const pick = (m: Mode) => {
    if (m === "visual") goSee();
    else goListen();
  };

  const tabBtn = (m: Mode, label: string) => {
    const selected = active === m;
    const color = ACCENT[m];
    return (
      <Pressable
        onPress={() => pick(m)}
        accessibilityRole="tab"
        accessibilityState={{ selected }}
        accessibilityLabel={`${label} mode`}
        className="min-h-[52px] flex-1 items-center justify-center rounded-full px-4"
        style={{
          backgroundColor: selected ? color : "transparent",
          shadowColor: selected ? color : "transparent",
          shadowOpacity: selected ? 0.8 : 0,
          shadowRadius: selected ? 18 : 0,
          shadowOffset: { width: 0, height: 2 },
          elevation: selected ? 8 : 0,
        }}
      >
        <Text className="text-[17px] font-semibold" style={{ color: selected ? "#04211C" : "#8FA6B8" }}>
          {label}
        </Text>
      </Pressable>
    );
  };

  return (
    <View className="items-center pb-3 pt-1">
      <View
        className="w-[300px] max-w-full flex-row rounded-full border border-line p-1"
        style={{ backgroundColor: "rgba(10,24,38,0.82)" }}
        accessibilityRole="tablist"
        accessibilityLabel={S.modeGroupLabel}
      >
        {tabBtn("visual", S.tabView)}
        {tabBtn("hearing", S.tabListen)}
      </View>
    </View>
  );
}

/** "⋯" corner button + sheet (Home · Profile · Settings) for the stage screens. */
export function MoreMenu() {
  const [open, setOpen] = useState(false);
  const S = useStrings();
  const go = (path: string) => {
    setOpen(false);
    router.push(path as never);
  };
  const item = (path: string, icon: string, label: string) => (
    <Pressable
      onPress={() => go(path)}
      accessibilityRole="button"
      accessibilityLabel={label}
      className="min-h-[60px] flex-row items-center gap-3 rounded-2xl bg-panel px-4 active:opacity-80"
    >
      <Text className="text-xl text-paper">{icon}</Text>
      <Text className="text-lg font-semibold text-paper">{label}</Text>
    </Pressable>
  );
  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={S.menu}
        className="h-[52px] w-[52px] items-center justify-center rounded-full border border-line"
        style={{ backgroundColor: "rgba(10,24,38,0.82)" }}
      >
        <Text className="text-xl font-bold text-paper">•••</Text>
      </Pressable>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable onPress={() => setOpen(false)} className="flex-1 justify-end bg-black/60 px-5 pb-10" accessibilityLabel={S.menu}>
          <View className="gap-2 rounded-[28px] border border-line bg-ink p-3">
            {item("/home", "⌂", S.navHome)}
            {item("/profile", "●", S.navProfile)}
            {item("/settings", "⚙", S.navSettings)}
          </View>
        </Pressable>
      </Modal>
    </>
  );
}

/** Stage header: centered View/Listen notch with the ⋯ menu at the right (reference layout). */
export function StageHeader() {
  return (
    <View className="flex-row items-start">
      <View className="w-[52px]" />
      <View className="flex-1">
        <ModeNotch />
      </View>
      <MoreMenu />
    </View>
  );
}

/** Animated waveform bars for the Live Captions header (decorative, a11y-hidden). */
function WaveBar({ color, active, base, index }: { color: string; active: boolean; base: number; index: number }) {
  const s = useSharedValue(0.32);
  useEffect(() => {
    if (active) {
      s.value = withRepeat(
        withSequence(withTiming(base, { duration: 300 + index * 53 }), withTiming(0.28, { duration: 260 + index * 61 })),
        -1,
        true,
      );
    } else {
      cancelAnimation(s);
      s.value = withTiming(0.32, { duration: 180 });
    }
  }, [active, base, index, s]);
  const style = useAnimatedStyle(() => ({ transform: [{ scaleY: s.value }] }));
  return (
    <Animated.View
      style={[{ width: 3.5, height: 22, borderRadius: 2, backgroundColor: color, opacity: active ? 1 : 0.45 }, style]}
    />
  );
}

export function WaveBars({ color, active }: { color: string; active: boolean }) {
  return (
    <View className="flex-row items-center gap-[3px]" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {[0.55, 0.95, 1.25, 0.7, 1.0].map((base, i) => (
        <WaveBar key={i} color={color} active={active} base={base} index={i} />
      ))}
    </View>
  );
}

/** Top-level, always-visible Visual / Hearing mode switch. */
export function ModeSwitch() {
  const mode = useBuddyStore((s) => s.mode);
  const setMode = useBuddyStore((s) => s.setMode);
  const S = useStrings();
  const item = (m: Mode, icon: string, title: string, sub: string) => {
    const active = mode === m;
    const color = ACCENT[m];
    return (
      <Pressable
        onPress={() => setMode(m)}
        accessibilityRole="radio"
        accessibilityState={{ selected: active }}
        accessibilityLabel={`${title} mode. ${sub}`}
        className="min-h-[68px] flex-1 items-center justify-center rounded-3xl border-2 px-2 py-2"
        style={{ backgroundColor: active ? color : "#0D1B29", borderColor: color }}
      >
        <Text className="text-lg font-bold" style={{ color: active ? "#060D14" : color }}>
          {icon} {title}
        </Text>
        <Text className="text-xs" style={{ color: active ? "#243447" : "#9FB4C7" }}>
          {sub}
        </Text>
      </Pressable>
    );
  };
  return (
    <View className="flex-row gap-3" accessibilityRole="radiogroup" accessibilityLabel={S.modeGroupLabel}>
      {item("visual", "◉", S.modeCantSee, S.modeSeeSub)}
      {item("hearing", "♪", S.modeCantHear, S.modeHearSub)}
    </View>
  );
}

/**
 * Chunky bottom menu for NON-sense pages (home / profile / settings).
 * Only three shortcuts: Home (left) · Sense (center, mode's canonical tab)
 * · Profile (right). Sense screens use StageHeader instead — never this.
 */
export function BottomNav() {
  const pathname = usePathname();
  const mode = useBuddyStore((s) => s.mode);
  const S = useStrings();
  const accent = ACCENT[mode];
  const sensePath = mode === "visual" ? "/sense/see" : "/sense/listen";
  const senseIcon = mode === "visual" ? "◎" : "♪";
  const items = [
    { path: "/home", icon: "⌂", label: S.navHome, active: pathname === "/home" },
    { path: sensePath, icon: senseIcon, label: S.navSense, active: pathname.startsWith("/sense") },
    // Settings is a Profile detail page — keep Profile lit while there.
    { path: "/profile", icon: "●", label: S.navProfile, active: pathname === "/profile" || pathname === "/settings" },
  ] as const;
  return (
    <View className="flex-row gap-2 border-t border-line bg-panel px-3 pb-6 pt-2">
      {items.map((it) => {
        return (
          <Pressable
            key={it.label}
            onPress={() => router.navigate(it.path as never)}
            accessibilityRole="button"
            accessibilityLabel={`${it.label} ${S.navPage}`}
            accessibilityState={{ selected: it.active }}
            className="min-h-[60px] flex-1 items-center justify-center rounded-2xl"
            style={{ backgroundColor: it.active ? accent : "transparent" }}
          >
            <Text className="text-2xl" style={{ color: it.active ? "#060D14" : "#F4F9FF" }}>
              {it.icon}
            </Text>
            <Text className="text-sm font-semibold" style={{ color: it.active ? "#060D14" : "#9FB4C7" }}>
              {it.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function Header({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <View className="mb-4">
      <Text className="text-3xl font-bold text-paper" accessibilityRole="header">
        {title}
      </Text>
      {subtitle ? <Text className="mt-1 text-lg text-muted">{subtitle}</Text> : null}
    </View>
  );
}
