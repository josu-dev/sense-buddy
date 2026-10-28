import { router } from "expo-router";
import { useState } from "react";
import { Text, View } from "react-native";
import { BigButton, Screen } from "../components/ui";
import { api, setToken } from "../lib/api";
import { useBuddyStore } from "../lib/store";

export default function Login() {
  const signIn = useBuddyStore((s) => s.signIn);
  const mode = useBuddyStore((s) => s.mode);
  const prefs = useBuddyStore((s) => s.prefs);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState("");

  const login = async (provider: "google" | "apple" | "guest") => {
    setBusy(provider);
    setNotice("");
    try {
      const data = await api.mockLogin(provider, prefs.userName || "Demo Friend");
      signIn(data.user);
      void api.syncPreferences({ mode, voiceRate: prefs.voiceRate, hapticsEnabled: prefs.hapticsEnabled });
      router.replace("/home");
    } catch {
      // Offline demo fallback: the hackathon demo must never dead-end.
      await setToken(null);
      signIn({ id: "offline-demo", name: prefs.userName || "Demo Friend", email: "offline@sensebuddy.app" });
      setNotice("Could not reach the Sense Buddy server, so you are in offline demo mode.");
      router.replace("/home");
    } finally {
      setBusy(null);
    }
  };

  return (
    <Screen>
      <View className="gap-4 pt-10">
        <Text className="text-center text-5xl">◉♪</Text>
        <Text className="text-center text-4xl font-bold text-paper" accessibilityRole="header">
          Welcome to Sense Buddy
        </Text>
        <Text className="text-center text-lg leading-relaxed text-muted">
          Sign in so your preferences, daily AI budget and buddy history stay yours.
        </Text>
        <BigButton label={busy === "google" ? "Signing in…" : "Continue with Google"} disabled={!!busy} onPress={() => login("google")} />
        <BigButton label={busy === "apple" ? "Signing in…" : "Continue with Apple"} color="#F4F9FF" disabled={!!busy} onPress={() => login("apple")} />
        <BigButton
          label={busy === "guest" ? "Signing in…" : "Continue as guest"}
          hint="Fastest way to try the demo"
          color="#122539"
          dark={false}
          disabled={!!busy}
          onPress={() => login("guest")}
        />
        {notice ? <Text className="text-center text-base text-amber">{notice}</Text> : null}
        <Text className="mt-4 text-center text-sm leading-relaxed text-muted">
          Demo build: sign-in is mocked on the device, but creates a real account and session on our server (BetterAuth).
          Real Google/Apple OAuth plugs into the same backend — no app rewrite.
        </Text>
      </View>
    </Screen>
  );
}
