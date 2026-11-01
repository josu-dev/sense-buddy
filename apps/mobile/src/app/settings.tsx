import { router } from "expo-router";
import { Moon, Smartphone, Sun, Volume2, type LucideIcon } from "lucide-react-native";
import { Pressable, ScrollView, Switch, Text, TextInput, View } from "react-native";
import { ACCENT, BigButton, BottomNav, Header, ModeSwitch, Screen } from "../components/ui";
import { LANG_LABELS, useStrings, type LangPref } from "../lib/i18n";
import { pushPreferences } from "../lib/prefsSync";
import { useBuddyStore } from "../lib/store";
import { useThemeColors, type ThemePref } from "../lib/theme";
import { speak, vibrateFor } from "../lib/voice";

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View className="gap-2 rounded-3xl border border-line bg-panel p-4">
      <Text className="text-xl font-semibold text-paper">{label}</Text>
      {children}
    </View>
  );
}

function Chips<T extends string | number>({ options, value, onPick, render }: { options: T[]; value: T; onPick: (v: T) => void; render: (v: T) => { label: string; icon?: LucideIcon } }) {
  const mode = useBuddyStore((s) => s.mode);
  const C = useThemeColors();
  return (
    <View className="flex-row flex-wrap gap-2">
      {options.map((o) => {
        const active = o === value;
        const { label, icon: Icon } = render(o);
        const tint = active ? C.onAccent : C.paper;
        return (
          <Pressable key={String(o)} onPress={() => onPick(o)} accessibilityRole="radio" accessibilityState={{ selected: active }} accessibilityLabel={label} className="min-h-[52px] justify-center rounded-full border px-4 active:opacity-80" style={{ borderColor: ACCENT[mode], backgroundColor: active ? ACCENT[mode] : C.ink }}>
            <View className="flex-row items-center justify-center gap-1.5">
              {Icon ? <Icon size={20} strokeWidth={2.25} color={tint} /> : null}
              <Text className="text-lg font-semibold" style={{ color: tint }}>{label}</Text>
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

export default function Settings() {
  const prefs = useBuddyStore((s) => s.prefs);
  const updatePrefs = useBuddyStore((s) => s.updatePrefs);
  const S = useStrings();
  const C = useThemeColors();

  const save = (patch: Partial<typeof prefs>) => {
    updatePrefs(patch); // zustand set is sync, so push reads the merged prefs
    pushPreferences();
  };

  const langLabel = (l: LangPref): { label: string; icon?: LucideIcon } =>
    l === "system" ? { label: S.setLangSystem, icon: Smartphone } : { label: LANG_LABELS[l] };
  const themeLabel = (t: ThemePref): { label: string; icon?: LucideIcon } =>
    t === "system"
      ? { label: S.setThemeSystem, icon: Smartphone }
      : t === "light"
        ? { label: S.setThemeLight, icon: Sun }
        : { label: S.setThemeDark, icon: Moon };

  return (
    <View className="flex-1 bg-ink">
      <Screen edges={["top", "left", "right"]}>
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 20, gap: 14 }}>
          <Header
            title={S.setTitle}
            subtitle={S.setSub}
            onBack={() => router.navigate("/profile" as never)}
            backLabel={S.back}
          />
          <Row label={S.setHelp}>
            <ModeSwitch />
          </Row>
          <Row label={S.setLang}>
            <Chips options={["system", "en", "es", "pt", "fr"] as LangPref[]} value={prefs.language} onPick={(language) => save({ language })} render={langLabel} />
          </Row>
          <Row label={S.setTheme}>
            <Chips options={["system", "light", "dark"] as ThemePref[]} value={prefs.theme} onPick={(theme) => save({ theme })} render={themeLabel} />
          </Row>
          <Row label={S.setName}>
            <TextInput
              value={prefs.userName}
              onChangeText={(userName) => save({ userName })}
              placeholder={S.setNamePh}
              placeholderTextColor={C.placeholder}
              accessibilityLabel={S.setNamePh}
              className="min-h-[60px] rounded-2xl border border-line bg-ink px-4 text-xl text-paper"
            />
          </Row>
          <Row label={S.setSpeed}>
            <Chips options={[0.75, 1, 1.25, 1.5]} value={prefs.voiceRate} onPick={(voiceRate) => save({ voiceRate })} render={(v) => ({ label: `${v}×` })} />
            <BigButton label={S.setHearVoice} color={C.secondary} dark={!C.isDark} icon={Volume2} onPress={() => speak(S.setHearVoiceSample, prefs)} />
          </Row>
          <Row label={S.setStickyAudio}>
            <View className="flex-row items-center justify-between">
              <Text className="flex-1 text-lg text-muted">{S.setStickyAudioSub}</Text>
              <Switch value={prefs.stickySenseAudio} onValueChange={(stickySenseAudio) => save({ stickySenseAudio })} accessibilityLabel={S.setStickyAudioA11y} />
            </View>
          </Row>
          <Row label={S.setCaption}>
            <Chips options={["large", "xlarge"] as const} value={prefs.captionSize} onPick={(captionSize) => save({ captionSize })} render={(v) => ({ label: v === "large" ? S.setLarge : S.setXLarge })} />
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
              placeholderTextColor={C.placeholder}
              accessibilityLabel={S.setSosNamePh}
              className="min-h-[60px] rounded-2xl border border-line bg-ink px-4 text-xl text-paper"
            />
            <TextInput
              value={prefs.emergencyPhone}
              onChangeText={(emergencyPhone) => save({ emergencyPhone })}
              placeholder={S.setSosPhonePh}
              placeholderTextColor={C.placeholder}
              accessibilityLabel={S.setSosPhonePh}
              keyboardType="phone-pad"
              className="min-h-[60px] rounded-2xl border border-line bg-ink px-4 text-xl text-paper"
            />
          </Row>
        </ScrollView>
      </Screen>
      <BottomNav />
    </View>
  );
}
