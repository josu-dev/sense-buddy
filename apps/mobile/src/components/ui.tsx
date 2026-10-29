import type { Mode } from "@sense-buddy/shared";
import { router, usePathname } from "expo-router";
import type { ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useStrings } from "../lib/i18n";
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

/** Chunky bottom menu — Profile and Settings are always one tap away. */
export function BottomNav() {
  const pathname = usePathname();
  const mode = useBuddyStore((s) => s.mode);
  const S = useStrings();
  const accent = ACCENT[mode];
  const items = [
    { path: "/home", icon: "⌂", label: S.navHome },
    mode === "visual" ? { path: "/see", icon: "◎", label: S.navSee } : { path: "/listen", icon: "♪", label: S.navListen },
    { path: "/profile", icon: "●", label: S.navProfile },
    { path: "/settings", icon: "⚙", label: S.navSettings },
  ] as const;
  return (
    <View className="flex-row gap-2 border-t border-line bg-panel px-3 pb-6 pt-2">
      {items.map((it) => {
        const active = pathname === it.path;
        return (
          <Pressable
            key={it.path}
            onPress={() => router.push(it.path as never)}
            accessibilityRole="button"
            accessibilityLabel={`${it.label} ${S.navPage}`}
            accessibilityState={{ selected: active }}
            className="min-h-[60px] flex-1 items-center justify-center rounded-2xl"
            style={{ backgroundColor: active ? accent : "transparent" }}
          >
            <Text className="text-2xl" style={{ color: active ? "#060D14" : "#F4F9FF" }}>
              {it.icon}
            </Text>
            <Text className="text-sm font-semibold" style={{ color: active ? "#060D14" : "#9FB4C7" }}>
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
