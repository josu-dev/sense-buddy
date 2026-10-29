import { router } from "expo-router";
import { Alert, Linking, ScrollView, Text, View } from "react-native";
import { ACCENT, BigButton, BottomNav, Screen } from "../components/ui";
import { useStrings } from "../lib/i18n";
import { useBuddyStore } from "../lib/store";

/**
 * Welcome page (static). The canonical interactive screens are
 * /sense/see + /sense/listen — all chat/orb/voice logic moved there.
 * This page never subscribes to transient sense state, so arriving here
 * from sense/ never flashes stale orb/chat content.
 */
export default function Home() {
  const mode = useBuddyStore((s) => s.mode);
  const prefs = useBuddyStore((s) => s.prefs);
  const user = useBuddyStore((s) => s.user);
  const lastReply = useBuddyStore((s) => s.lastReply);
  const S = useStrings();
  const accent = ACCENT[mode];

  const sos = () => {
    const phone = prefs.emergencyPhone.trim();
    if (!phone) {
      Alert.alert(S.sosBtn, S.sosNoPhone, [
        { text: S.sosCancel, style: "cancel" },
        { text: S.sosGoSettings, onPress: () => router.navigate("/settings" as never) },
      ]);
      return;
    }
    const who = prefs.emergencyName.trim();
    Alert.alert(S.sosTitle, `${S.sosMsg}${who ? ` ${who} (${phone})` : ` ${phone}`}`, [
      { text: S.sosCancel, style: "cancel" },
      { text: S.sosCall, style: "destructive", onPress: () => void Linking.openURL(`tel:${phone.replace(/\s/g, "")}`) },
    ]);
  };

  return (
    <>
      <Screen>
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 16 }}>
          <Text className="text-center text-5xl">◉♪</Text>
          <Text className="mt-2 text-center text-3xl font-bold text-paper" accessibilityRole="header">
            {S.welcomeTitle}
            {prefs.userName ? `, ${prefs.userName}` : ""}
          </Text>
          {user?.email ? <Text className="mb-3 mt-1 text-center text-base text-muted">{user.email}</Text> : null}
          <Text className="mb-5 text-center text-lg leading-relaxed text-muted">{S.welcomeSub}</Text>

          <View className="gap-3">
            <BigButton
              label={S.homeSeeBtn}
              hint={S.homeSeeHint}
              color={ACCENT.visual}
              onPress={() => router.navigate("/sense/see" as never)}
            />
            <BigButton
              label={S.homeListenBtn}
              hint={S.homeListenHint}
              color={ACCENT.hearing}
              onPress={() => router.navigate("/sense/listen" as never)}
            />

            {lastReply ? (
              <View className="rounded-3xl border border-line bg-panel p-4" accessibilityLiveRegion="polite">
                <Text className="mb-1 text-sm font-semibold" style={{ color: accent }}>
                  {S.homeBuddySays}
                </Text>
                <Text className="text-xl leading-relaxed text-paper" numberOfLines={4}>
                  {lastReply}
                </Text>
              </View>
            ) : null}

            <BigButton label={`🆘 ${S.sosBtn}`} hint={S.sosBtnHint} color="#FF5468" dark={false} onPress={sos} />
          </View>
        </ScrollView>
      </Screen>
      <BottomNav />
    </>
  );
}
