import { Redirect } from "expo-router";
import { ActivityIndicator, View } from "react-native";
import { useBuddyStore, useHydrated } from "../lib/store";

export default function Index() {
  const hydrated = useHydrated();
  const hasOnboarded = useBuddyStore((s) => s.hasOnboarded);
  const user = useBuddyStore((s) => s.user);

  if (!hydrated) {
    return (
      <View className="flex-1 items-center justify-center bg-ink">
        <ActivityIndicator size="large" color="#FFB224" />
      </View>
    );
  }
  if (!hasOnboarded) return <Redirect href="/onboarding" />;
  if (!user) return <Redirect href="/login" />;
  return <Redirect href="/home" />;
}
