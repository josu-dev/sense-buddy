import type { OrbState } from "@sense-buddy/shared";
import { useIsFocused } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Check, X } from "lucide-react-native";
import { ActivityIndicator, KeyboardAvoidingView, Modal, Platform, Pressable, Text, TextInput, View } from "react-native";
import Animated, { FadeInUp, FadeOut } from "react-native-reanimated";
import { Orb } from "../../components/Orb";
import { ACCENT } from "../../components/ui";
import { api } from "../../lib/api";
import { APP_LANGS, LANG_LABELS, LANG_TTS, useAppLang, useStrings, type AppLang } from "../../lib/i18n";
import { useBuddyStore } from "../../lib/store";
import { useThemeColors } from "../../lib/theme";
import { getCachedTranslation, setCachedTranslation } from "../../lib/translationCache";
import { speakIn, stopSpeaking } from "../../lib/voice";

/** Max chars per utterance — keeps TTS snappy and the input glanceable. */
const MAX_LEN = 500;

/** Per-message voice: follow the app language, or force one of the four. */
type SayLang = "app" | AppLang;

/** Flag per language (regions match the TTS tags: en-US, es-ES, pt-BR, fr-FR). */
const LANG_FLAG: Record<AppLang, string> = { en: "🇺🇸", es: "🇪🇸", pt: "🇧🇷", fr: "🇫🇷" };

/**
 * Speak for me: type a message, pick a target language, tap the orb — the
 * buddy translates it server-side, shows the translation in an animated
 * preview card above the input (the source text stays in place), and says
 * the translation out loud with a matching voice. Offline/quota/session
 * failures fall back to reading the original text as-is, so the user is
 * never left silent. This is the speak mode's canonical tab (see
 * SenseProvider): visiting it adopts `speak` as the user preference.
 */
export default function Say() {
  const isFocused = useIsFocused();
  const prefs = useBuddyStore((s) => s.prefs);
  // Local orb state (was global → leaked across tabs mid-transition = flash).
  const [orbState, setOrbState] = useState<OrbState>("idle");
  const [text, setText] = useState("");
  const [sayLang, setSayLang] = useState<SayLang>("app");
  const [langOpen, setLangOpen] = useState(false);
  /** Last attempt fell back to the original (translate unreachable/failed). */
  const [translateFailed, setTranslateFailed] = useState(false);
  /** Last translation, shown in the preview card (empty = hide the card). */
  const [translation, setTranslation] = useState("");
  const appLang = useAppLang();
  const S = useStrings();
  const C = useThemeColors();
  const prefsRef = useRef(prefs);
  useEffect(() => {
    prefsRef.current = prefs;
  }, [prefs]);
  // Guards the async translate→speak chain: reset/blur/re-tap bump the
  // sequence so a stale translation never speaks over a newer action.
  const seqRef = useRef(0);
  const focusedRef = useRef(isFocused);
  useEffect(() => {
    focusedRef.current = isFocused;
  }, [isFocused]);

  // Tabs keep this mounted in the background: never speak over see/listen.
  // With sticky audio the root SpeechNavGuard decides instead (sense-tab
  // hops keep playing; a pending translate still dies via focusedRef, and
  // onStopped resets the orb when the guard cuts speech outside sense).
  useEffect(() => {
    if (!isFocused) {
      if (prefs.stickySenseAudio) return;
      seqRef.current += 1;
      stopSpeaking();
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setOrbState("idle");
    }
  }, [isFocused, prefs.stickySenseAudio]);

  // Never leave an utterance playing behind another screen.
  useEffect(() => () => stopSpeaking(), []);

  /** Effective target language: explicit pick, or the app language. */
  const targetLang: AppLang = sayLang === "app" ? appLang : sayLang;
  const targetRef = useRef(targetLang);
  useEffect(() => {
    targetRef.current = targetLang;
  }, [targetLang]);

  const speakNow = () => {
    const msg = text.trim();
    if (!msg || !isFocused) return;
    const seq = (seqRef.current += 1);
    const target = targetRef.current;
    stopSpeaking();
    // Cache hit (same text + same language): skip the server entirely.
    const cached = getCachedTranslation(msg, target);
    if (cached !== undefined) {
      setTranslateFailed(false);
      setTranslation(cached !== msg ? cached : "");
      setOrbState("speaking");
      void speakIn(cached, prefsRef.current, LANG_TTS[target], () => {
        if (seq === seqRef.current) setOrbState("idle");
      });
      return;
    }
    setOrbState("thinking");
    setTranslation("");
    void (async () => {
      let finalText = msg;
      let failed = false;
      try {
        const res = await api.say(msg, target);
        if (res?.text?.trim()) finalText = res.text.trim();
      } catch (e) {
        // Offline / quota / session: read the original as-is, but SAY SO —
        // a silent fallback looks exactly like "translation doesn't work".
        failed = true;
        console.warn("[say] translate failed, reading original:", e instanceof Error ? e.message : e);
      }
      if (seq !== seqRef.current || !focusedRef.current) return;
      setTranslateFailed(failed);
      // Only successful translations are cached — failures always retry.
      if (!failed) setCachedTranslation(msg, target, finalText);
      // Source stays in the input; the translation gets its own preview card
      // (no card when nothing changed — already in target lang or fallback).
      setTranslation(finalText !== msg ? finalText : "");
      setOrbState("speaking");
      await speakIn(finalText, prefsRef.current, LANG_TTS[target], () => {
        if (seq === seqRef.current) setOrbState("idle");
      });
    })();
  };

  /** Orb tap = speak; while busy, tap again = cancel/stop. */
  const orbTap = () => {
    if (orbState === "idle") {
      speakNow();
      return;
    }
    seqRef.current += 1;
    stopSpeaking();
    setOrbState("idle");
  };

  const hasText = text.trim().length > 0;
  const speaking = orbState === "speaking";
  const thinking = orbState === "thinking";
  const busy = orbState !== "idle";
  const sayLangLabel = sayLang === "app" ? `${S.sayLangApp} · ${LANG_LABELS[appLang]}` : LANG_LABELS[sayLang];
  /** Compact button: flag + code, no "App" prefix. */
  const sayLangCode = targetLang.toUpperCase();

  // sense/_layout owns SafeArea + StageHeader (persistent, no remount flash).
  // KeyboardAvoidingView keeps the composer above the keyboard while typing;
  // the fill orb simply shrinks until the keyboard dismisses.
  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      style={{ flex: 1 }}
      keyboardVerticalOffset={8}
    >
      <View className="flex-1 pb-2">
        <View className="flex-1" style={{ overflow: "visible" }}>
          <Orb
            state={orbState}
            mode="speak"
            fill
            showLabel={false}
            onTap={orbTap}
            accessibilityLabel={speaking ? S.saySpeakingOrb : S.sayTapOrb}
          />
        </View>

        {/* Composer card (same bottom-panel pattern as /listen) */}
        <View
          className="rounded-[28px] border border-line p-4"
          style={{
            backgroundColor: C.scrimStrong,
            overflow: "hidden",
            shadowColor: ACCENT.speak,
            shadowOpacity: 0.18,
            shadowRadius: 18,
            shadowOffset: { width: 0, height: -2 },
          }}
        >
          {/* Translation preview: what the orb is about to say / just said. */}
          {translation ? (
            <Animated.View entering={FadeInUp.duration(250)} exiting={FadeOut.duration(150)}>
              <View
                className="mb-3 gap-1 rounded-2xl border border-line bg-panel2 p-3"
                accessibilityLiveRegion="polite"
              >
                <Text className="text-[13px] font-bold text-muted" numberOfLines={1}>
                  {`${LANG_FLAG[targetLang]} ${sayLangCode}`}
                </Text>
                <Text className="text-lg leading-snug text-paper" numberOfLines={4}>
                  {translation}
                </Text>
              </View>
            </Animated.View>
          ) : null}
          <TextInput
            value={text}
            onChangeText={(t) => {
              setText(t.slice(0, MAX_LEN));
              setTranslateFailed(false);
              setTranslation("");
            }}
            placeholder={S.sayPlaceholder}
            placeholderTextColor={C.placeholder}
            accessibilityLabel={S.sayMsgA11y}
            multiline
            numberOfLines={4}
            maxLength={MAX_LEN}
            returnKeyType="done"
            blurOnSubmit
            onSubmitEditing={() => speakNow()}
            className="min-h-[104px] rounded-2xl border border-line bg-ink px-4 py-3 text-xl leading-snug text-paper"
            style={{ textAlignVertical: "top" }}
          />

          {/* Language code + Speak (orb mirror) + reset */}
          <View className="mt-3 flex-row gap-2">
            <Pressable
              onPress={() => setLangOpen(true)}
              accessibilityRole="button"
              accessibilityLabel={`${S.sayLangLabel}: ${sayLangLabel}`}
              className="min-h-[60px] min-w-[92px] flex-row items-center justify-center rounded-full border border-line bg-ink px-3 active:opacity-80"
            >
              <Text className="text-[15px] font-bold text-paper" numberOfLines={1}>
                {`${LANG_FLAG[targetLang]} ${sayLangCode}`}
              </Text>
            </Pressable>
            <Pressable
              onPress={orbTap}
              disabled={(!hasText && !busy) || thinking}
              accessibilityRole="button"
              accessibilityLabel={speaking ? S.saySpeakingOrb : S.saySpeakBtn}
              accessibilityState={{ busy: thinking }}
              className="min-h-[60px] flex-1 items-center justify-center rounded-full px-4 active:opacity-80"
              style={{
                backgroundColor: hasText || busy ? ACCENT.speak : C.line,
                shadowColor: hasText || busy ? ACCENT.speak : "transparent",
                shadowOpacity: hasText || busy ? 0.8 : 0,
                shadowRadius: hasText || busy ? 18 : 0,
                shadowOffset: { width: 0, height: 2 },
                elevation: hasText || busy ? 8 : 0,
                opacity: thinking ? 0.75 : 1,
              }}
            >
              <View className="flex-row items-center gap-2">
                <Text className="text-[18px] font-bold" style={{ color: hasText || busy ? C.onCyan : C.tabIdle }}>
                  {S.saySpeakBtn}
                </Text>
                {thinking ? <ActivityIndicator size="small" color={C.onCyan} /> : null}
              </View>
            </Pressable>
            <Pressable
              onPress={() => {
                seqRef.current += 1;
                stopSpeaking();
                setOrbState("idle");
                setText("");
                setTranslation("");
                setTranslateFailed(false);
              }}
              disabled={!hasText && !busy}
              accessibilityRole="button"
              accessibilityLabel={S.sayClear}
              className="min-h-[60px] w-[60px] items-center justify-center rounded-full border border-line active:opacity-80"
              style={{ opacity: hasText || busy ? 1 : 0.4 }}
            >
              <X size={24} strokeWidth={2.25} color={C.muted} />
            </Pressable>
          </View>

          {/* Only on failure: explains why the original (not a translation) is spoken. */}
          {translateFailed ? (
            <Text className="mt-2 text-center text-[15px] font-semibold text-amber" accessibilityLiveRegion="polite">
              {S.sayNoTranslate}
            </Text>
          ) : null}

          {/* Invisible: announces the speaking state to screen readers. */}
          <Text className="h-[1px] opacity-0" accessibilityLiveRegion="polite">
            {speaking ? S.saySpeakingOrb : ""}
          </Text>
        </View>

        {/* Voice language picker (bottom sheet, same pattern as MoreMenu) */}
        <Modal visible={langOpen} transparent animationType="fade" onRequestClose={() => setLangOpen(false)}>
          <Pressable
            onPress={() => setLangOpen(false)}
            className="flex-1 justify-end bg-black/60 px-5 pb-10"
            accessibilityLabel={S.sayLangLabel}
          >
            <View className="gap-2 rounded-[28px] border border-line bg-ink p-3">
              <Text className="px-2 pb-1 text-xl font-bold text-paper" accessibilityRole="header">
                {S.sayLangLabel}
              </Text>
              {(["app", ...APP_LANGS] as SayLang[]).map((l) => {
                const selected = sayLang === l;
                const label = l === "app" ? `${S.sayLangApp} · ${LANG_LABELS[appLang]}` : LANG_LABELS[l];
                return (
                  <Pressable
                    key={l}
                    onPress={() => {
                      // A pending translation is for the old language: cancel
                      // it (it still lands in the cache, so nothing is lost).
                      if (orbState === "thinking") seqRef.current += 1;
                      setSayLang(l);
                      setTranslation("");
                      setLangOpen(false);
                    }}
                    accessibilityRole="radio"
                    accessibilityState={{ selected }}
                    accessibilityLabel={label}
                    className="min-h-[60px] flex-row items-center gap-3 rounded-2xl px-4 active:opacity-80"
                    style={{ backgroundColor: selected ? ACCENT.speak : C.panel }}
                  >
                    <Text className="flex-1 text-lg font-semibold" style={{ color: selected ? C.onCyan : C.paper }}>
                      {label}
                    </Text>
                    {selected ? <Check size={24} strokeWidth={2.5} color={C.onCyan} /> : null}
                  </Pressable>
                );
              })}
            </View>
          </Pressable>
        </Modal>
      </View>
    </KeyboardAvoidingView>
  );
}
