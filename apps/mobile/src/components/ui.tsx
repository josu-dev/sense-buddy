import type { Mode } from "@sense-buddy/shared";
import { router, usePathname } from "expo-router";
import { ArrowLeft, Ear, Eye, House, Megaphone, Settings, User, type LucideIcon } from "lucide-react-native";
import { useEffect, type ReactNode } from "react";
import { Modal, Pressable, Text, View } from "react-native";
import Svg, { Path } from "react-native-svg";
import Animated, {
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from "react-native-reanimated";
import { SafeAreaView, type Edge } from "react-native-safe-area-context";
import { useStrings } from "../lib/i18n";
import { useSense, type SenseTab } from "../lib/sense";
import { useBuddyStore } from "../lib/store";
import { useThemeColors } from "../lib/theme";

export const ACCENT = { visual: "#FFB224", hearing: "#3EE6FF", speak: "#A78BFA" } as const;

export function Screen({ children, edges }: { children: ReactNode; edges?: Edge[] }) {
  return (
    <SafeAreaView edges={edges ?? ["top", "bottom", "left", "right"]} className="flex-1 bg-ink">
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
  textColor,
  icon: Icon,
  leftNode,
}: {
  label: string;
  hint?: string;
  onPress: () => void;
  color?: string;
  dark?: boolean;
  disabled?: boolean;
  /** Explicit label color (e.g. the Apple button); defaults to the theme tone. */
  textColor?: string;
  /** Leading glyph (Lucide SVG). Decorative — the text label stays the a11y label. */
  icon?: LucideIcon;
  /** Custom leading glyph (e.g. a brand logo). Decorative; wins over `icon`. */
  leftNode?: ReactNode;
}) {
  const C = useThemeColors();
  const labelColor = textColor ?? (dark ? C.onAccent : C.paper);
  const labelEl = (
    <Text className="text-center text-xl font-bold" style={{ color: labelColor }}>
      {label}
    </Text>
  );
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={hint}
      className="min-h-[72px] items-center justify-center rounded-3xl px-5 py-4 active:opacity-80"
      style={{ backgroundColor: disabled ? C.line : color }}
    >
      {leftNode ? (
        <View className="flex-row items-center justify-center gap-2.5">
          {leftNode}
          {labelEl}
        </View>
      ) : Icon ? (
        <View className="flex-row items-center justify-center gap-2">
          <Icon size={24} strokeWidth={2.25} color={labelColor} />
          {labelEl}
        </View>
      ) : (
        labelEl
      )}
      {hint ? (
        <Text className="mt-0.5 text-center text-sm" style={{ color: dark ? C.onTintMuted : C.muted }}>
          {hint}
        </Text>
      ) : null}
    </Pressable>
  );
}

/**
 * Bottom-sheet confirmation dialog with chunky BigButton actions — the same
 * large-touch-target, screen-reader-friendly pattern as the rest of the app
 * (a native Alert would be tiny and easy to mis-tap for our users).
 */
export function ConfirmDialog({
  visible,
  title,
  message,
  confirmLabel,
  cancelLabel,
  busyLabel,
  busy,
  destructive,
  onConfirm,
  onCancel,
}: {
  visible: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  /** Shown on the confirm button while `busy` (falls back to confirmLabel). */
  busyLabel?: string;
  busy?: boolean;
  /** Paint the confirm button in the danger color. */
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const C = useThemeColors();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <Pressable onPress={busy ? undefined : onCancel} className="flex-1 justify-end bg-black/60 px-5 pb-10" accessibilityLabel={title}>
        <Pressable onPress={() => {}} className="gap-4 rounded-[28px] border border-line bg-panel p-5">
          <Text className="text-2xl font-bold text-paper" accessibilityRole="header">
            {title}
          </Text>
          <Text className="text-lg leading-relaxed text-muted">{message}</Text>
          <BigButton
            label={busy && busyLabel ? busyLabel : confirmLabel}
            color={destructive ? C.danger : undefined}
            textColor={destructive ? "#FFFFFF" : undefined}
            disabled={busy}
            onPress={onConfirm}
          />
          <BigButton label={cancelLabel} color={C.secondary} dark={!C.isDark} disabled={busy} onPress={onCancel} />
        </Pressable>
      </Pressable>
    </Modal>
  );
}

/**
 * Brand mark: the three sense glyphs (Eye = see, Ear = hear, Megaphone =
 * say) in mode accents. Decorative — hidden from screen readers; every
 * usage pairs it with a real header right below.
 */
export function BrandMark({ size = 52 }: { size?: number }) {
  const C = useThemeColors();
  return (
    <View
      className="flex-row items-center justify-center gap-3"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Eye size={size} strokeWidth={2} color={C.accentText.visual} />
      <Ear size={size} strokeWidth={2} color={C.accentText.hearing} />
      <Megaphone size={size} strokeWidth={2} color={C.accentText.speak} />
    </View>
  );
}

/**
 * Official Google "G" in brand colors. Decorative — screen readers get the
 * button's text label instead.
 */
export function GoogleLogo({ size = 24 }: { size?: number }) {
  return (
    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Svg width={size} height={size} viewBox="0 0 24 24">
        <Path
          fill="#4285F4"
          d="M23.49 12.27c0-.79-.07-1.54-.19-2.27H12v4.51h6.47c-.29 1.48-1.14 2.73-2.4 3.58v3h3.86c2.26-2.09 3.56-5.17 3.56-8.82z"
        />
        <Path
          fill="#34A853"
          d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.86-3c-1.08.72-2.45 1.16-4.07 1.16-3.13 0-5.78-2.11-6.73-4.96H1.29v3.09C3.26 21.3 7.31 24 12 24z"
        />
        <Path
          fill="#FBBC05"
          d="M5.27 14.29c-.25-.72-.38-1.49-.38-2.29s.14-1.57.38-2.29V6.62H1.29C.47 8.24 0 10.06 0 12s.47 3.76 1.29 5.38l3.98-3.09z"
        />
        <Path
          fill="#EA4335"
          d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.7 1.29 6.62l3.98 3.09C6.22 6.86 8.87 4.75 12 4.75z"
        />
      </Svg>
    </View>
  );
}

/**
 * Apple glyph (single color, like the sign-in button label). Decorative.
 */
export function AppleLogo({ size = 24, color = "#000000" }: { size?: number; color?: string }) {
  const h = (size * 512) / 384;
  return (
    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Svg width={size} height={h} viewBox="0 0 384 512">
        <Path
          fill={color}
          d="M318.7 268.7c-.2-36.7 16.4-64.4 50-84.8-18.8-26.9-47.2-41.7-84.7-44.6-35.5-2.8-74.3 20.7-88.5 20.7-15 0-49.4-19.7-76.4-19.7C63.3 141.2 4 184.8 4 273.5q0 39.3 14.4 81.2c12.8 36.7 59 126.7 107.2 125.2 25.2-.6 43-17.9 75.8-17.9 31.8 0 48.3 17.9 76.4 17.9 48.6-.7 90.4-82.5 102.6-119.3-65.2-30.7-61.7-90-61.7-91.9zm-56.6-164.2c27.3-32.4 24.8-61.9 24-72.5-24.1 1.4-52 16.4-67.9 34.9-17.5 19.8-27.8 44.3-25.6 71.9 26.1 2 49.9-11.4 69.5-34.3z"
        />
      </Svg>
    </View>
  );
}

/**
 * Top notch: pill with three tabs — View / Listen / Say.
 * Rendered ONCE by sense/_layout above the Tabs navigator, so it never
 * remounts on tab switches. Navigation only — it never touches global
 * `mode` itself; the layout syncs the preference after the tab commits
 * (the old setMode-before-navigate was the main flash source).
 */
export function ModeNotch() {
  const { tab: activeTab, goSee, goListen, goSay } = useSense();
  const S = useStrings();
  const C = useThemeColors();

  const pick = (t: SenseTab) => {
    if (t === "see") goSee();
    else if (t === "listen") goListen();
    else goSay();
  };

  const tabBtn = (t: SenseTab, label: string) => {
    const selected = activeTab === t;
    const color = t === "see" ? ACCENT.visual : t === "listen" ? ACCENT.hearing : ACCENT.speak;
    return (
      <Pressable
        onPress={() => pick(t)}
        accessibilityRole="tab"
        accessibilityState={{ selected }}
        accessibilityLabel={`${label} mode`}
        className="min-h-[52px] min-w-0 flex-1 items-center justify-center rounded-full px-1"
        style={{
          backgroundColor: selected ? color : "transparent",
          shadowColor: selected ? color : "transparent",
          shadowOpacity: selected ? 0.8 : 0,
          shadowRadius: selected ? 18 : 0,
          shadowOffset: { width: 0, height: 2 },
          elevation: selected ? 8 : 0,
          flexShrink: 1,
        }}
      >
        <Text
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.85}
          ellipsizeMode="clip"
          className="text-[14px] font-semibold"
          style={{ color: selected ? C.onCyan : C.tabIdle, textAlign: "center" }}
        >
          {label}
        </Text>
      </Pressable>
    );
  };

  return (
    <View className="items-center py-2">
      <View
        className="w-full max-w-[360px] flex-row self-center rounded-full border border-line p-1"
        style={{ backgroundColor: C.scrim }}
        accessibilityRole="tablist"
        accessibilityLabel={S.modeGroupLabel}
      >
        {tabBtn("see", S.tabView)}
        {tabBtn("listen", S.tabListen)}
        {tabBtn("say", S.tabSay)}
      </View>
    </View>
  );
}

/** Stage header: centered View/Listen notch · Settings circle (one-tap nav). */
export function StageHeader() {
  const S = useStrings();
  const C = useThemeColors();
  return (
    <View className="flex-row items-center gap-2">
      <View className="w-[60px]" />
      <View className="flex-1">
        <ModeNotch />
      </View>
      <Pressable
        onPress={() => router.navigate("/settings" as never)}
        accessibilityRole="button"
        accessibilityLabel={S.navSettings}
        className="h-[60px] w-[60px] items-center justify-center rounded-full border border-line active:opacity-80"
        style={{ backgroundColor: C.scrim }}
      >
        <Settings size={26} strokeWidth={2.25} color={C.paper} />
      </Pressable>
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

/** Top-level, always-visible Visual / Hearing / Speak mode switch. */
export function ModeSwitch() {
  const mode = useBuddyStore((s) => s.mode);
  const setMode = useBuddyStore((s) => s.setMode);
  const S = useStrings();
  const C = useThemeColors();
  const item = (m: Mode, Icon: LucideIcon, title: string, sub: string) => {
    const active = mode === m;
    const color = ACCENT[m];
    const titleColor = active ? C.onAccent : C.accentText[m];
    return (
      <Pressable
        onPress={() => setMode(m)}
        accessibilityRole="radio"
        accessibilityState={{ selected: active }}
        accessibilityLabel={`${title} mode. ${sub}`}
        className="min-h-[68px] flex-1 items-center justify-center rounded-3xl border-2 px-2 py-2"
        style={{ backgroundColor: active ? color : C.panel, borderColor: color }}
      >
        <View className="flex-row items-center justify-center gap-2">
          <Icon size={22} strokeWidth={2.25} color={titleColor} />
          <Text className="text-lg font-bold" style={{ color: titleColor }}>
            {title}
          </Text>
        </View>
        <Text className="text-xs" style={{ color: active ? C.onAccentSub : C.muted }}>
          {sub}
        </Text>
      </Pressable>
    );
  };
  return (
    <View className="gap-3" accessibilityRole="radiogroup" accessibilityLabel={S.modeGroupLabel}>
      {item("visual", Eye, S.modeCantSee, S.modeSeeSub)}
      {item("hearing", Ear, S.modeCantHear, S.modeHearSub)}
      {item("speak", Megaphone, S.modeCantSpeak, S.modeSpeakSub)}
    </View>
  );
}

/**
 * Chunky bottom menu for NON-sense pages (home / profile / settings).
 * Only three shortcuts: Home (left) · Sense (center, mode's canonical tab)
 * · Profile (right). Sense screens use StageHeader instead — never this.
 *
 * Ghost tabs: no border/fill — the active tab shows in the mode accent,
 * idle tabs dim. Wrapped in its own bottom SafeAreaView painted
 * panel-colored so the phone's bottom reserved (home-indicator) area
 * blends with the bar instead of showing the gray system background.
 * Pair with `<Screen edges={["top", "left", "right"]}>` to avoid double
 * bottom inset.
 */
export function BottomNav() {
  const pathname = usePathname();
  const mode = useBuddyStore((s) => s.mode);
  const S = useStrings();
  const C = useThemeColors();
  const sensePath = mode === "visual" ? "/sense/see" : mode === "hearing" ? "/sense/listen" : "/sense/say";
  const SenseIcon = mode === "visual" ? Eye : mode === "hearing" ? Ear : Megaphone;
  const items: { path: string; Icon: LucideIcon; label: string; active: boolean }[] = [
    { path: "/home", Icon: House, label: S.navHome, active: pathname === "/home" },
    { path: sensePath, Icon: SenseIcon, label: S.navSense, active: pathname.startsWith("/sense") },
    // Settings is a Profile detail page — keep Profile lit while there.
    { path: "/profile", Icon: User, label: S.navProfile, active: pathname === "/profile" || pathname === "/settings" },
  ];
  return (
    <SafeAreaView edges={["bottom", "left", "right"]} style={{ backgroundColor: C.panel }}>
      <View className="flex-row gap-2 border-t border-line bg-panel px-3 pb-1 pt-2">
        {items.map((it) => {
          return (
            <Pressable
              key={it.path}
              onPress={() => router.navigate(it.path as never)}
              accessibilityRole="button"
              accessibilityLabel={`${it.label} ${S.navPage}`}
              accessibilityState={{ selected: it.active }}
              className="min-h-[64px] flex-1 items-center justify-center active:opacity-60"
            >
              <it.Icon size={28} strokeWidth={2.25} color={it.active ? C.accentText[mode] : C.tabIdle} />
            </Pressable>
          );
        })}
      </View>
    </SafeAreaView>
  );
}

/**
 * Standalone top-left back arrow (52pt touch target). Same affordance as the
 * Header back button, for screens with custom headers (onboarding steps,
 * guest name entry). Pair with the screen's own step-back logic.
 */
export function BackButton({ onPress, label }: { onPress: () => void; label?: string }) {
  const C = useThemeColors();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label ?? "Back"}
      className="h-[52px] w-[52px] items-center justify-center active:opacity-60"
    >
      <ArrowLeft size={28} strokeWidth={2.25} color={C.paper} />
    </Pressable>
  );
}

export function Header({
  title,
  subtitle,
  onBack,
  backLabel,
}: {
  title: string;
  subtitle?: string;
  onBack?: () => void;
  backLabel?: string;
}) {
  const text = (
    <View className={onBack ? "flex-1" : undefined}>
      <Text className="text-3xl font-bold text-paper" accessibilityRole="header">
        {title}
      </Text>
      {subtitle ? <Text className="mt-1 text-lg text-muted">{subtitle}</Text> : null}
    </View>
  );
  if (!onBack) return <View className="mb-4">{text}</View>;
  return (
    <View className="mb-4 flex-row items-center gap-3">
      <BackButton onPress={onBack} label={backLabel} />
      {text}
    </View>
  );
}
