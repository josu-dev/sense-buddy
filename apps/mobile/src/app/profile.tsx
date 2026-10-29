import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import { Text, View } from "react-native";
import { ACCENT, BigButton, BottomNav, Header, Screen } from "../components/ui";
import { api, setToken } from "../lib/api";
import { useStrings } from "../lib/i18n";
import { useBuddyStore } from "../lib/store";

export default function Profile() {
  const user = useBuddyStore((s) => s.user);
  const mode = useBuddyStore((s) => s.mode);
  const prefs = useBuddyStore((s) => s.prefs);
  const S = useStrings();
  const signOut = useBuddyStore((s) => s.signOut);
  const usage = useQuery({ queryKey: ["usage"], queryFn: api.usage, enabled: !!user && user.id !== "offline-demo" });

  const pct = usage.data ? Math.min(100, Math.round((usage.data.usedToday / usage.data.dailyBudget) * 100)) : 0;

  return (
    <>
      <Screen>
        <Header title={S.profileTitle} subtitle={S.profileSub} />
        <View className="gap-4">
          <View className="rounded-3xl border border-line bg-panel p-5">
            <Text className="text-3xl font-bold text-paper">{prefs.userName || user?.name || S.profileFriend}</Text>
            <Text className="mt-1 text-lg text-muted">{user?.email}</Text>
            <Text className="mt-3 text-lg text-paper">
              {S.profileMainMode}: <Text style={{ color: ACCENT[mode] }}>{mode === "visual" ? `◉ ${S.modeCantSee}` : `♪ ${S.modeCantHear}`}</Text>
            </Text>
          </View>

          <View className="rounded-3xl border border-line bg-panel p-5">
            <Text className="text-xl font-bold text-paper">{S.profileEnergy}</Text>
            {usage.data ? (
              <>
                <View className="mt-3 h-5 overflow-hidden rounded-full bg-panel2">
                  <View style={{ width: `${pct}%`, backgroundColor: ACCENT[mode], height: "100%" }} />
                </View>
                <Text className="mt-2 text-lg text-muted">
                  {usage.data.usedToday.toLocaleString()} {S.profileTokens} · {usage.data.remaining.toLocaleString()} {S.profileLeft}
                </Text>
                <Text className="mt-1 text-base text-muted">{S.profileNote}</Text>
              </>
            ) : (
              <Text className="mt-2 text-lg text-muted">{user?.id === "offline-demo" ? S.profileOffline : S.profileLoading}</Text>
            )}
          </View>

          <BigButton
            label={`⚙ ${S.navSettings}`}
            color={ACCENT[mode]}
            onPress={() => router.navigate("/settings" as never)}
          />
          <BigButton
            label={S.profileSignOut}
            color="#122539"
            dark={false}
            onPress={async () => {
              await setToken(null);
              signOut();
              router.replace("/login");
            }}
          />
        </View>
      </Screen>
      <BottomNav />
    </>
  );
}
