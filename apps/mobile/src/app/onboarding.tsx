import type { Mode } from "@sense-buddy/shared";
import { router } from "expo-router";
import { ArrowLeft, Ear, Eye, type LucideIcon } from "lucide-react-native";
import { useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { BigButton, BrandMark, Screen } from "../components/ui";
import { useStrings } from "../lib/i18n";
import { useBuddyStore } from "../lib/store";
import { useThemeColors } from "../lib/theme";
import { speak } from "../lib/voice";

export default function Onboarding() {
  const completeOnboarding = useBuddyStore((s) => s.completeOnboarding);
  const prefs = useBuddyStore((s) => s.prefs);
  const S = useStrings();
  const C = useThemeColors();
  const [step, setStep] = useState(0);
  const [mode, setMode] = useState<Mode>("visual");
  const [name, setName] = useState("");

  const MODE_CARDS: { mode: Mode; Icon: LucideIcon; title: string; body: string; color: string }[] = [
    { mode: "visual", Icon: Eye, title: S.obVisualTitle, body: S.obVisualBody, color: "#FFB224" },
    { mode: "hearing", Icon: Ear, title: S.obHearingTitle, body: S.obHearingBody, color: "#3EE6FF" },
  ];

  const pickMode = (m: Mode) => {
    setMode(m);
    if (m === "visual") {
      speak(S.obSpeakVisual, prefs);
    }
  };

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
            <BigButton label={S.obContinue} color={mode === "visual" ? "#FFB224" : "#3EE6FF"} onPress={() => setStep(2)} />
          </View>
        )}

        {step === 2 && (
          <View className="gap-4 pt-4">
            <Text className="text-3xl font-bold text-paper" accessibilityRole="header">
              {S.obAlmost}
            </Text>
            <Text className="text-lg leading-relaxed text-muted">
              {S.obNameSub}
            </Text>
            <TextInput
              value={name}
              onChangeText={setName}
              placeholder={S.obNamePh}
              placeholderTextColor={C.placeholder}
              accessibilityLabel={S.obNamePh}
              className="min-h-[64px] rounded-3xl border border-line bg-panel px-5 text-xl text-paper"
            />
            <BigButton
              label={S.obCreate}
              color={mode === "visual" ? "#FFB224" : "#3EE6FF"}
              onPress={() => {
                completeOnboarding(mode, name.trim());
                router.replace("/login");
              }}
            />
            <Pressable
              onPress={() => setStep(1)}
              accessibilityRole="button"
              accessibilityLabel={S.obBack}
              className="flex-row items-center justify-center gap-1 py-2 active:opacity-60"
            >
              <ArrowLeft size={20} strokeWidth={2.25} color={C.muted} />
              <Text className="text-center text-lg text-muted">{S.obBack}</Text>
            </Pressable>
          </View>
        )}
      </ScrollView>
    </Screen>
  );
}
