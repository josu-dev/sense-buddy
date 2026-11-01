import type { Mode } from "@sense-buddy/shared";
import { router } from "expo-router";
import { Ear, Eye, Megaphone, type LucideIcon } from "lucide-react-native";
import { useEffect, useState } from "react";
import { BackHandler, Pressable, ScrollView, Text, View } from "react-native";
import { ACCENT, BackButton, BigButton, BrandMark, Screen } from "../components/ui";
import { useStrings } from "../lib/i18n";
import { useBuddyStore } from "../lib/store";
import { useThemeColors } from "../lib/theme";
import { speak } from "../lib/voice";

/**
 * Two steps: welcome → "how can I help you best?" (mode).
 * The name used to be step 3 here, but it now comes AFTER sign-in: guests
 * pick it on the login screen, OAuth users bring it from their profile.
 */
export default function Onboarding() {
  const completeOnboarding = useBuddyStore((s) => s.completeOnboarding);
  const prefs = useBuddyStore((s) => s.prefs);
  const S = useStrings();
  const C = useThemeColors();
  const [step, setStep] = useState(0);
  const [mode, setMode] = useState<Mode>("visual");

  // System back (Android gesture/button) must walk the onboarding steps, not
  // pop the route — onboarding is the root, so popping would exit the app.
  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (step > 0) {
        setStep(step - 1);
        return true;
      }
      return false;
    });
    return () => sub.remove();
  }, [step]);

  const MODE_CARDS: { mode: Mode; Icon: LucideIcon; title: string; body: string; color: string }[] = [
    { mode: "visual", Icon: Eye, title: S.obVisualTitle, body: S.obVisualBody, color: ACCENT.visual },
    { mode: "hearing", Icon: Ear, title: S.obHearingTitle, body: S.obHearingBody, color: ACCENT.hearing },
    { mode: "speak", Icon: Megaphone, title: S.obSpeakTitle, body: S.obSpeakBody, color: ACCENT.speak },
  ];

  const pickMode = (m: Mode) => {
    setMode(m);
    // Demo the buddy's voice for the modes that talk; hearing mode stays
    // silent because its users can't hear it.
    if (m === "visual") {
      speak(S.obSpeakVisual, prefs);
    } else if (m === "speak") {
      speak(S.obSpeakSay, prefs);
    }
  };

  const backTopLeft = (target: number) => (
    <View className="flex-row">
      <BackButton onPress={() => setStep(target)} label={S.obBack} />
    </View>
  );

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ paddingBottom: 32 }} showsVerticalScrollIndicator={false}>
        {step === 0 && (
          <View className="gap-5 pt-8">
            <BrandMark size={60} />
            <Text className="text-center text-4xl font-bold leading-tight text-paper" accessibilityRole="header">
              {S.obHi}
            </Text>
            <Text className="text-center text-xl leading-relaxed text-muted">
              {S.obSub}
            </Text>
            <BigButton label={S.obStart} hint={S.obStartHint} onPress={() => setStep(1)} />
            <Text className="text-center text-base text-muted">{S.obLater}</Text>
          </View>
        )}

        {step === 1 && (
          <View className="gap-4 pt-4">
            {backTopLeft(0)}
            <Text className="text-3xl font-bold text-paper" accessibilityRole="header">
              {S.obQ}
            </Text>
            <Text className="text-lg text-muted">{S.obQSub}</Text>
            {MODE_CARDS.map((card) => {
              const selected = mode === card.mode;
              return (
                <Pressable
                  key={card.mode}
                  onPress={() => pickMode(card.mode)}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                  accessibilityLabel={`${card.title}. ${card.body}`}
                  className="rounded-3xl border-2 p-5"
                  style={{ borderColor: card.color, backgroundColor: selected ? card.color : C.panel }}
                >
                  <View className="flex-row items-center gap-2">
                    <card.Icon size={26} strokeWidth={2.25} color={selected ? C.onAccent : C.accentText[card.mode]} />
                    <Text className="flex-1 text-2xl font-bold" style={{ color: selected ? C.onAccent : C.accentText[card.mode] }}>
                      {card.title}
                    </Text>
                  </View>
                  <Text className="mt-2 text-lg leading-relaxed" style={{ color: selected ? C.onAccentSub : C.muted }}>
                    {card.body}
                  </Text>
                </Pressable>
              );
            })}
            <Text className="text-base text-muted">{S.obBoth}</Text>
            <BigButton
              label={S.obContinue}
              color={ACCENT[mode]}
              onPress={() => {
                completeOnboarding(mode);
                router.replace("/login");
              }}
            />
          </View>
        )}
      </ScrollView>
    </Screen>
  );
}
