import type { Mode } from "@sense-buddy/shared";
import { router } from "expo-router";
import { useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { BigButton, Screen } from "../components/ui";
import { useBuddyStore } from "../lib/store";
import { speak } from "../lib/voice";

const MODE_CARDS: { mode: Mode; icon: string; title: string; body: string; color: string }[] = [
  {
    mode: "visual",
    icon: "◉",
    title: "I can't see well",
    body: "Buddy talks to you, and sees through your camera — telling you in steps and directions what is around you.",
    color: "#FFB224",
  },
  {
    mode: "hearing",
    icon: "♪",
    title: "I can't hear well",
    body: "Buddy writes everything big on screen, captions speech, and vibrates in different patterns for sirens, doorbells and your name.",
    color: "#3EE6FF",
  },
];

export default function Onboarding() {
  const completeOnboarding = useBuddyStore((s) => s.completeOnboarding);
  const prefs = useBuddyStore((s) => s.prefs);
  const [step, setStep] = useState(0);
  const [mode, setMode] = useState<Mode>("visual");
  const [name, setName] = useState("");

  const pickMode = (m: Mode) => {
    setMode(m);
    if (m === "visual") {
      speak("Visual mode. Sense Buddy will talk to you and see for you. You can switch this any time at the top of the screen.", prefs);
    }
  };

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ paddingBottom: 32 }} showsVerticalScrollIndicator={false}>
        {step === 0 && (
          <View className="gap-5 pt-8">
            <Text className="text-center text-6xl">◉♪</Text>
            <Text className="text-center text-4xl font-bold leading-tight text-paper" accessibilityRole="header">
              Hi, I'm Sense Buddy
            </Text>
            <Text className="text-center text-xl leading-relaxed text-muted">
              I help you sense the world — seeing for you, or hearing for you — in the way that works best for your body.
            </Text>
            <BigButton label="Let's start" hint="One quick question first" onPress={() => setStep(1)} />
            <Text className="text-center text-base text-muted">You can change everything later in Settings.</Text>
          </View>
        )}

        {step === 1 && (
          <View className="gap-4 pt-4">
            <Text className="text-3xl font-bold text-paper" accessibilityRole="header">
              First — how can I help you best?
            </Text>
            <Text className="text-lg text-muted">This is the most important choice. It changes how I talk to you.</Text>
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
                  style={{ borderColor: card.color, backgroundColor: selected ? card.color : "#0D1B29" }}
                >
                  <Text className="text-2xl font-bold" style={{ color: selected ? "#060D14" : card.color }}>
                    {card.icon} {card.title}
                  </Text>
                  <Text className="mt-2 text-lg leading-relaxed" style={{ color: selected ? "#243447" : "#9FB4C7" }}>
                    {card.body}
                  </Text>
                </Pressable>
              );
            })}
            <Text className="text-base text-muted">Need both? Pick your main one — you can switch at the top of the screen any time.</Text>
            <BigButton label="Continue" color={mode === "visual" ? "#FFB224" : "#3EE6FF"} onPress={() => setStep(2)} />
          </View>
        )}

        {step === 2 && (
          <View className="gap-4 pt-4">
            <Text className="text-3xl font-bold text-paper" accessibilityRole="header">
              Almost done
            </Text>
            <Text className="text-lg leading-relaxed text-muted">
              What should I call you? In hearing mode, I listen for this name and alert you when someone calls it.
            </Text>
            <TextInput
              value={name}
              onChangeText={setName}
              placeholder="Your name"
              placeholderTextColor="#5E7A94"
              accessibilityLabel="Your name"
              className="min-h-[64px] rounded-3xl border border-line bg-panel px-5 text-xl text-paper"
            />
            <BigButton
              label="Create my account"
              color={mode === "visual" ? "#FFB224" : "#3EE6FF"}
              onPress={() => {
                completeOnboarding(mode, name.trim());
                router.replace("/login");
              }}
            />
            <Pressable onPress={() => setStep(1)} accessibilityRole="button" accessibilityLabel="Go back">
              <Text className="py-2 text-center text-lg text-muted">← Back</Text>
            </Pressable>
          </View>
        )}
      </ScrollView>
    </Screen>
  );
}
