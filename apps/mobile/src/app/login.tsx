import { router } from "expo-router";
import { useState } from "react";
import { Text, View } from "react-native";
import { BigButton, Screen } from "../components/ui";
import { useStrings } from "../lib/i18n";
import { api, setToken } from "../lib/api";
import { useBuddyStore } from "../lib/store";

export default function Login() {
  const signIn = useBuddyStore((s) => s.signIn);
  const mode = useBuddyStore((s) => s.mode);
  const prefs = useBuddyStore((s) => s.prefs);
  const S = useStrings();
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
      setNotice(S.loginOffline);
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
          {S.loginHi}
        </Text>
        <Text className="text-center text-lg leading-relaxed text-muted">
          {S.loginSub}
        </Text>
        <BigButton label={busy === "google" ? S.loginSigning : S.loginGoogle} disabled={!!busy} onPress={() => login("google")} />
        <BigButton label={busy === "apple" ? S.loginSigning : S.loginApple} color="#F4F9FF" disabled={!!busy} onPress={() => login("apple")} />
        <BigButton
          label={busy === "guest" ? S.loginSigning : S.loginGuest}
          hint={S.loginGuestHint}
          color="#122539"
          dark={false}
          disabled={!!busy}
          onPress={() => login("guest")}
        />
        {notice ? <Text className="text-center text-base text-amber">{notice}</Text> : null}
        <Text className="mt-4 text-center text-sm leading-relaxed text-muted">
          {S.loginNote}
        </Text>
      </View>
    </Screen>
  );
}
