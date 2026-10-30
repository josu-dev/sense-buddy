import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import { Ear, Eye, Settings } from "lucide-react-native";
import { Text, View } from "react-native";
import { ACCENT, BigButton, BottomNav, Header, Screen } from "../components/ui";
import { api, setToken } from "../lib/api";
import { formatNumber, useStrings } from "../lib/i18n";
import { useBuddyStore } from "../lib/store";
import { useThemeColors } from "../lib/theme";

export default function Profile() {
  const user = useBuddyStore((s) => s.user);
  const mode = useBuddyStore((s) => s.mode);
  const prefs = useBuddyStore((s) => s.prefs);
  const S = useStrings();
  const C = useThemeColors();
  const signOut = useBuddyStore((s) => s.signOut);
  const usage = useQuery({ queryKey: ["usage"], queryFn: api.usage, enabled: !!user && user.id !== "offline-demo" });

  const pct = usage.data ? Math.min(100, Math.round((usage.data.usedToday / usage.data.dailyBudget) * 100)) : 0;

  return (
    <View className="flex-1 bg-ink">
      <Screen edges={["top", "left", "right"]}>
        <Header title={S.profileTitle} subtitle={S.profileSub} />
        <View className="gap-4">
          <View className="rounded-3xl border border-line bg-panel p-5">
            <Text className="text-3xl font-bold text-paper">{prefs.userName || user?.name || S.profileFriend}</Text>
            <Text className="mt-1 text-lg text-muted">{user?.email}</Text>
            <View className="mt-3 flex-row items-center gap-2">
              <Text className="text-lg text-paper">{S.profileMainMode}:</Text>
              {mode === "visual" ? (
                <Eye size={20} strokeWidth={2.25} color={C.accentText[mode]} />
              ) : (
                <Ear size={20} strokeWidth={2.25} color={C.accentText[mode]} />
              )}
              <Text className="text-lg" style={{ color: C.accentText[mode] }}>
                {mode === "visual" ? S.modeCantSee : S.modeCantHear}
              </Text>
            </View>
          </View>

          <View className="rounded-3xl border border-line bg-panel p-5">
            <Text className="text-xl font-bold text-paper">{S.profileEnergy}</Text>
            {usage.data ? (
              <>
                <View className="mt-3 h-5 overflow-hidden rounded-full bg-panel2">
                  <View style={{ width: `${pct}%`, backgroundColor: ACCENT[mode], height: "100%" }} />
                </View>
                <Text className="mt-2 text-lg text-muted">
                  {formatNumber(usage.data.usedToday)} {S.profileTokens} · {formatNumber(usage.data.remaining)} {S.profileLeft}
                </Text>
                <Text className="mt-1 text-base text-muted">{S.profileNote}</Text>
              </>
            ) : (
              <Text className="mt-2 text-lg text-muted">{user?.id === "offline-demo" ? S.profileOffline : S.profileLoading}</Text>
            )}
          </View>

          <BigButton
            label={S.navSettings}
            color={ACCENT[mode]}
            icon={Settings}
            onPress={() => router.navigate("/settings" as never)}
          />
          <BigButton
            label={S.profileSignOut}
            color={C.secondary}
            dark={!C.isDark}
            onPress={async () => {
              await setToken(null);
              signOut();
              router.replace("/login");
            }}
          />
        </View>
      </Screen>
      <BottomNav />
    </View>
  );
}
