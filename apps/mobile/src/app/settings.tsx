import { Pressable, ScrollView, Switch, Text, TextInput, View } from "react-native";
import { ACCENT, BigButton, BottomNav, Header, ModeSwitch, Screen } from "../components/ui";
import { api } from "../lib/api";
import { useStrings, type LangPref } from "../lib/i18n";
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
  const S = useStrings();

  const save = (patch: Partial<typeof prefs>) => {
    updatePrefs(patch);
    void api.syncPreferences({ mode, voiceRate: prefs.voiceRate, hapticsEnabled: prefs.hapticsEnabled, captionSize: prefs.captionSize, highContrast: prefs.highContrast, ...patch });
  };

  const langLabel = (l: LangPref): string => (l === "system" ? `📱 ${S.setLangSystem}` : l === "es" ? "Español" : "English");

  return (
    <>
      <Screen>
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 20, gap: 14 }}>
          <Header title={S.setTitle} subtitle={S.setSub} />
          <Row label={S.setHelp}>
            <ModeSwitch />
          </Row>
          <Row label={S.setLang}>
            <Chips options={["system", "es", "en"] as const} value={prefs.language} onPick={(language) => save({ language })} render={langLabel} />
          </Row>
          <Row label={S.setName}>
            <TextInput
              value={prefs.userName}
              onChangeText={(userName) => save({ userName })}
              placeholder={S.setNamePh}
              placeholderTextColor="#5E7A94"
              accessibilityLabel={S.setNamePh}
              className="min-h-[60px] rounded-2xl border border-line bg-ink px-4 text-xl text-paper"
            />
          </Row>
          <Row label={S.setSpeed}>
            <Chips options={[0.75, 1, 1.25, 1.5]} value={prefs.voiceRate} onPick={(voiceRate) => save({ voiceRate })} render={(v) => `${v}×`} />
            <BigButton label={S.setHearVoice} color="#122539" dark={false} onPress={() => speak(S.setHearVoiceSample, prefs)} />
          </Row>
          <Row label={S.setCaption}>
            <Chips options={["large", "xlarge"] as const} value={prefs.captionSize} onPick={(captionSize) => save({ captionSize })} render={(v) => (v === "large" ? S.setLarge : S.setXLarge)} />
          </Row>
          <Row label={S.setVib}>
            <View className="flex-row items-center justify-between">
              <Text className="flex-1 text-lg text-muted">{S.setVibSub}</Text>
              <Switch
                value={prefs.hapticsEnabled}
                onValueChange={(hapticsEnabled) => { save({ hapticsEnabled }); if (hapticsEnabled) vibrateFor("high", true); }}
                accessibilityLabel={S.setVibA11y}
              />
            </View>
          </Row>
          <Row label={S.setContrast}>
            <View className="flex-row items-center justify-between">
              <Text className="flex-1 text-lg text-muted">{S.setContrastSub}</Text>
              <Switch value={prefs.highContrast} onValueChange={(highContrast) => save({ highContrast })} accessibilityLabel={S.setContrastA11y} />
            </View>
          </Row>
          <Row label={S.setSos}>
            <TextInput
              value={prefs.emergencyName}
              onChangeText={(emergencyName) => save({ emergencyName })}
              placeholder={S.setSosNamePh}
              placeholderTextColor="#5E7A94"
              accessibilityLabel={S.setSosNamePh}
              className="min-h-[60px] rounded-2xl border border-line bg-ink px-4 text-xl text-paper"
            />
            <TextInput
              value={prefs.emergencyPhone}
              onChangeText={(emergencyPhone) => save({ emergencyPhone })}
              placeholder={S.setSosPhonePh}
              placeholderTextColor="#5E7A94"
              accessibilityLabel={S.setSosPhonePh}
              keyboardType="phone-pad"
              className="min-h-[60px] rounded-2xl border border-line bg-ink px-4 text-xl text-paper"
            />
          </Row>
        </ScrollView>
      </Screen>
      <BottomNav />
    </>
  );
}
