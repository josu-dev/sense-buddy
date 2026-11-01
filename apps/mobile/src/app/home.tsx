import { router } from "expo-router";
import { Camera, Ear, Megaphone, Siren } from "lucide-react-native";
import { Alert, Linking, ScrollView, Text, View } from "react-native";
import { ACCENT, BigButton, BottomNav, BrandMark, Screen } from "../components/ui";
import { useStrings } from "../lib/i18n";
import { useBuddyStore } from "../lib/store";
import { useThemeColors } from "../lib/theme";

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
  const C = useThemeColors();
  const accent = C.accentText[mode];

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
    <View className="flex-1 bg-ink">
      <Screen edges={["top", "left", "right"]}>
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 16 }}>
          <BrandMark size={48} />
          <Text className="mt-2 text-center text-3xl font-bold text-paper" accessibilityRole="header">
            {S.welcomeTitle}
            {prefs.userName ? `, ${prefs.userName}` : ""}
          </Text>
          {user?.email && !user.isAnonymous ? <Text className="mb-3 mt-1 text-center text-base text-muted">{user.email}</Text> : null}
          <Text className="mb-5 text-center text-lg leading-relaxed text-muted">{S.welcomeSub}</Text>

          <View className="gap-3">
            <BigButton
              label={S.homeSeeBtn}
              hint={S.homeSeeHint}
              color={ACCENT.visual}
              icon={Camera}
              onPress={() => router.navigate("/sense/see" as never)}
            />
            <BigButton
              label={S.homeListenBtn}
              hint={S.homeListenHint}
              color={ACCENT.hearing}
              icon={Ear}
              onPress={() => router.navigate("/sense/listen" as never)}
            />
            <BigButton
              label={S.homeSpeakBtn}
              hint={S.homeSpeakHint}
              color={ACCENT.speak}
              icon={Megaphone}
              onPress={() => router.navigate("/sense/say" as never)}
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

            <BigButton label={S.sosBtn} hint={S.sosBtnHint} color="#FF5468" dark={false} icon={Siren} onPress={sos} />
          </View>
        </ScrollView>
      </Screen>
      <BottomNav />
    </View>
  );
}
