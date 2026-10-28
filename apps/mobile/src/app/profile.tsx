import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import { Text, View } from "react-native";
import { ACCENT, BigButton, BottomNav, Header, Screen } from "../components/ui";
import { api, setToken } from "../lib/api";
import { useBuddyStore } from "../lib/store";

export default function Profile() {
  const user = useBuddyStore((s) => s.user);
  const mode = useBuddyStore((s) => s.mode);
  const prefs = useBuddyStore((s) => s.prefs);
  const signOut = useBuddyStore((s) => s.signOut);
  const usage = useQuery({ queryKey: ["usage"], queryFn: api.usage, enabled: !!user && user.id !== "offline-demo" });

  const pct = usage.data ? Math.min(100, Math.round((usage.data.usedToday / usage.data.dailyBudget) * 100)) : 0;

  return (
    <>
      <Screen>
        <Header title="Profile" subtitle="Your account and daily AI budget" />
        <View className="gap-4">
          <View className="rounded-3xl border border-line bg-panel p-5">
            <Text className="text-3xl font-bold text-paper">{prefs.userName || user?.name || "Friend"}</Text>
            <Text className="mt-1 text-lg text-muted">{user?.email}</Text>
            <Text className="mt-3 text-lg text-paper">
              Main mode: <Text style={{ color: ACCENT[mode] }}>{mode === "visual" ? "◉ I can't see well" : "♪ I can't hear well"}</Text>
            </Text>
          </View>

          <View className="rounded-3xl border border-line bg-panel p-5">
            <Text className="text-xl font-bold text-paper">Today's buddy energy</Text>
            {usage.data ? (
              <>
                <View className="mt-3 h-5 overflow-hidden rounded-full bg-panel2">
                  <View style={{ width: `${pct}%`, backgroundColor: ACCENT[mode], height: "100%" }} />
                </View>
                <Text className="mt-2 text-lg text-muted">
                  {usage.data.usedToday.toLocaleString()} of {usage.data.dailyBudget.toLocaleString()} tokens used · {usage.data.remaining.toLocaleString()} left
                </Text>
                <Text className="mt-1 text-base text-muted">Every See costs more than a chat — the server keeps count so nobody can drain the budget.</Text>
              </>
            ) : (
              <Text className="mt-2 text-lg text-muted">{user?.id === "offline-demo" ? "Offline demo — sign in with the server running to see live usage." : "Loading…"}</Text>
            )}
          </View>

          <BigButton
            label="Sign out"
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
