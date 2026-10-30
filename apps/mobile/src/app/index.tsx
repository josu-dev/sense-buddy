import { Redirect } from "expo-router";
import { ActivityIndicator, Image, Text, View } from "react-native";
import { useStrings } from "../lib/i18n";
import { useBuddyStore, useHydrated } from "../lib/store";

export default function Index() {
  const hydrated = useHydrated();
  const hasOnboarded = useBuddyStore((s) => s.hasOnboarded);
  const user = useBuddyStore((s) => s.user);
  const mode = useBuddyStore((s) => s.mode);
  const S = useStrings();

  if (!hydrated) {
    // Branded boot: same ink bg + mark as the native splash, so the handoff
    // from static splash to live UI is seamless in production builds.
    // (Also the whole boot in Expo Go, which ignores the native splash.)
    return (
      <View
        style={{ flex: 1, backgroundColor: "#060D14", alignItems: "center", justifyContent: "center", gap: 16, paddingHorizontal: 32 }}
      >
        <Image source={require("../../assets/splash-icon.png")} style={{ width: 168, height: 168 }} accessibilityIgnoresInvertColors />
        <Text style={{ color: "#F4F9FF", fontSize: 34, fontWeight: "800" }} accessibilityRole="header">
          Sense Buddy
        </Text>
        <Text style={{ color: "#9FB4C7", fontSize: 17, textAlign: "center" }}>{S.splashTag}</Text>
        <ActivityIndicator size="large" color="#FFB224" style={{ marginTop: 12 }} />
      </View>
    );
  }
  if (!hasOnboarded) return <Redirect href="/onboarding" />;
  if (!user) return <Redirect href="/login" />;
  // Default entry is the canonical sense tab, not the welcome page.
  return <Redirect href={mode === "visual" ? "/sense/see" : "/sense/listen"} />;
}
