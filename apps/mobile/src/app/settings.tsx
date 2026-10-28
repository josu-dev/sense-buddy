import { Pressable, ScrollView, Switch, Text, TextInput, View } from "react-native";
import { ACCENT, BigButton, BottomNav, Header, ModeSwitch, Screen } from "../components/ui";
import { api } from "../lib/api";
import { useBuddyStore } from "../lib/store";
import { speak, vibrateFor } from "../lib/voice";

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View className="gap-2 rounded-3xl border border-line bg-panel p-4">
      <Text className="text-xl font-semibold text-paper">{label}</Text>
      {children}
    </View>
  );
}

function Chips<T extends string | number>({ options, value, onPick, render }: { options: T[]; value: T; onPick: (v: T) => void; render: (v: T) => string }) {
  const mode = useBuddyStore((s) => s.mode);
  return (
    <View className="flex-row flex-wrap gap-2">
      {options.map((o) => {
        const active = o === value;
        return (
          <Pressable key={String(o)} onPress={() => onPick(o)} accessibilityRole="radio" accessibilityState={{ selected: active }} accessibilityLabel={render(o)} className="min-h-[52px] justify-center rounded-full border px-4" style={{ borderColor: ACCENT[mode], backgroundColor: active ? ACCENT[mode] : "#060D14" }}>
            <Text className="text-lg font-semibold" style={{ color: active ? "#060D14" : "#F4F9FF" }}>{render(o)}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export default function Settings() {
  const mode = useBuddyStore((s) => s.mode);
  const prefs = useBuddyStore((s) => s.prefs);
  const updatePrefs = useBuddyStore((s) => s.updatePrefs);

  const save = (patch: Partial<typeof prefs>) => {
    updatePrefs(patch);
    void api.syncPreferences({ mode, voiceRate: prefs.voiceRate, hapticsEnabled: prefs.hapticsEnabled, captionSize: prefs.captionSize, highContrast: prefs.highContrast, ...patch });
  };

  return (
    <>
      <Screen>
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 20, gap: 14 }}>
          <Header title="Settings" subtitle="Make Sense Buddy fit you" />
          <Row label="How I help you">
            <ModeSwitch />
          </Row>
          <Row label="Your name (I listen for it)">
            <TextInput
              value={prefs.userName}
              onChangeText={(userName) => save({ userName })}
              placeholder="Your name"
              placeholderTextColor="#5E7A94"
              accessibilityLabel="Your name"
              className="min-h-[60px] rounded-2xl border border-line bg-ink px-4 text-xl text-paper"
            />
          </Row>
          <Row label="Talking speed">
            <Chips options={[0.75, 1, 1.25, 1.5]} value={prefs.voiceRate} onPick={(voiceRate) => save({ voiceRate })} render={(v) => `${v}×`} />
            <BigButton label="🔊 Hear my voice" color="#122539" dark={false} onPress={() => speak("Hello! This is how I will talk to you. We can go slower or faster, whatever you like.", prefs)} />
          </Row>
          <Row label="Caption size">
            <Chips options={["large", "xlarge"] as const} value={prefs.captionSize} onPick={(captionSize) => save({ captionSize })} render={(v) => (v === "large" ? "Large" : "Extra large")} />
          </Row>
          <Row label="Vibration alerts">
            <View className="flex-row items-center justify-between">
              <Text className="flex-1 text-lg text-muted">Buzz for doorbells, sirens, alarms and your name</Text>
              <Switch
                value={prefs.hapticsEnabled}
                onValueChange={(hapticsEnabled) => { save({ hapticsEnabled }); if (hapticsEnabled) vibrateFor("high", true); }}
                accessibilityLabel="Vibration alerts on or off"
              />
            </View>
          </Row>
          <Row label="High contrast">
            <View className="flex-row items-center justify-between">
              <Text className="flex-1 text-lg text-muted">Strong colors and big text everywhere</Text>
              <Switch value={prefs.highContrast} onValueChange={(highContrast) => save({ highContrast })} accessibilityLabel="High contrast on or off" />
            </View>
          </Row>
        </ScrollView>
      </Screen>
      <BottomNav />
    </>
  );
}
