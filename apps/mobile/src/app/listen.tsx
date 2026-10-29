import type { ListenEvent } from "@sense-buddy/shared";
import { router } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withRepeat, withSequence, withTiming, cancelAnimation } from "react-native-reanimated";
import { ACCENT, BigButton, BottomNav, Header, Screen } from "../components/ui";
import { api, isUnauthorized } from "../lib/api";
import { useAmbientClips } from "../lib/ambient";
import { getAppLang, useStrings } from "../lib/i18n";
import { announce } from "../lib/screenreader";
import { useBuddyStore } from "../lib/store";
import { vibrateFor } from "../lib/voice";

export default function Listen() {
  const prefs = useBuddyStore((s) => s.prefs);
  const setOrbState = useBuddyStore((s) => s.setOrbState);
  const S = useStrings();
  const PRIORITY_STYLE: Record<ListenEvent["priority"], { bg: string; label: string }> = {
    critical: { bg: "#FF5468", label: S.listenUrgent },
    high: { bg: "#FFB224", label: S.listenImportant },
    normal: { bg: "#122539", label: S.listenSound },
    low: { bg: "#122539", label: S.listenCalm },
  };
  const [listening, setListening] = useState(false);
  const [events, setEvents] = useState<(ListenEvent & { at: number })[]>([]);
  const [alert, setAlert] = useState<ListenEvent | null>(null);
  const [busy, setBusy] = useState(false);
  const [sending, setSending] = useState(false);
  const [noSession, setNoSession] = useState(false);
  const seen = useRef(new Set<string>());
  const flash = useSharedValue(1);
  const screenFlash = useSharedValue(0);
  const prefsRef = useRef(prefs);
  useEffect(() => {
    prefsRef.current = prefs;
  }, [prefs]);

  useEffect(() => {
    if (alert?.priority === "critical") {
      // Strobe blanco a pantalla completa: para quien no siente la vibración.
      flash.value = withRepeat(withTiming(0.25, { duration: 380 }), -1, true);
      screenFlash.value = withSequence(
        withTiming(0.85, { duration: 150 }),
        withTiming(0, { duration: 250 }),
        withTiming(0.85, { duration: 150 }),
        withTiming(0, { duration: 250 }),
        withTiming(0.85, { duration: 150 }),
        withTiming(0, { duration: 400 }),
      );
    } else {
      cancelAnimation(flash);
      flash.value = 1;
      screenFlash.value = 0;
    }
  }, [alert, flash, screenFlash]);
  const flashStyle = useAnimatedStyle(() => ({ opacity: flash.value }));
  const screenFlashStyle = useAnimatedStyle(() => ({ opacity: screenFlash.value }));

  const ingest = (incoming: ListenEvent[]) => {
    for (const e of incoming) {
      const key = `${e.kind}:${e.caption}`;
      if (seen.current.has(key)) continue;
      seen.current.add(key);
      setEvents((prev) => [{ ...e, at: Date.now() }, ...prev].slice(0, 20));
      const haptics = prefsRef.current.hapticsEnabled;
      if (e.priority === "high" || e.priority === "critical") {
        setAlert(e);
        setOrbState("alert");
        vibrateFor(e.priority, haptics);
        announce(`${e.label}. ${e.caption}`); // lo lee TalkBack/VoiceOver
        setTimeout(() => setOrbState("idle"), 4000);
      } else if (e.priority === "normal") {
        vibrateFor("normal", haptics);
      }
    }
  };

  const { start, stop, clipCount, micError } = useAmbientClips(async (audioBase64) => {
    setSending(true);
    try {
      const res = await api.listen("scan", prefsRef.current.userName || undefined, audioBase64);
      ingest(res.events);
    } catch (e) {
      if (isUnauthorized(e)) {
        // Sin sesión: cortar el loop (el cleanup del effect llama a stop())
        // en vez de golpear el server cada 3s.
        setListening(false);
        setOrbState("idle");
        setNoSession(true);
      }
      /* resto de errores: keep listening silently; next clip retries */
    } finally {
      setSending(false);
    }
  });

  useEffect(() => {
    if (!listening) return;
    setOrbState("listening");
    void start();
    return () => {
      stop();
      setOrbState("idle");
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listening]);

  const toggle = () => {
    setNoSession(false);
    setListening((v) => !v);
  };

  const captionSpeech = async () => {
    setBusy(true);
    try {
      ingest((await api.listen("speech", prefsRef.current.userName || undefined)).events);
    } catch (e) {
      if (isUnauthorized(e)) setNoSession(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Screen>
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 16 }}>
          <Header title={S.listenTitle} subtitle={S.listenSub} />

          {alert && (
            <Animated.View
              style={[flashStyle, { backgroundColor: PRIORITY_STYLE[alert.priority].bg, borderRadius: 24, padding: 18, marginBottom: 14 }]}
              accessibilityRole="alert"
              accessibilityLiveRegion="assertive"
              accessibilityLabel={`${PRIORITY_STYLE[alert.priority].label}. ${alert.label}. ${alert.caption}`}
            >
              <Text className="text-lg font-bold text-ink">{PRIORITY_STYLE[alert.priority].label} — {alert.label}</Text>
              <Text className="mt-1 text-2xl font-bold leading-snug text-ink">{alert.caption}</Text>
              <Pressable onPress={() => setAlert(null)} accessibilityRole="button" accessibilityLabel={S.listenDismiss} className="mt-3 min-h-[48px] items-center justify-center rounded-2xl bg-ink">
                <Text className="text-lg font-bold text-paper">{S.listenGotIt}</Text>
              </Pressable>
            </Animated.View>
          )}

          <View className="gap-3">
            {noSession ? (
              <View className="gap-2 rounded-3xl border border-line bg-panel p-4">
                <Text className="text-xl font-bold text-paper">{S.listenNoSessionT}</Text>
                <Text className="text-lg text-muted">{S.listenNoSessionB}</Text>
                <BigButton label={S.listenSignInAgain} color={ACCENT.hearing} onPress={() => router.replace("/login")} />
              </View>
            ) : null}
            <BigButton
              label={listening ? S.listenStop : S.listenStart}
              hint={
                listening
                  ? sending
                    ? `${S.listenSending} #${clipCount + 1}… ${S.listenWatching}`
                    : `${S.listenMicOpen}`
                  : S.listenIdle
              }
              color={listening ? "#FF5468" : ACCENT.hearing}
              onPress={toggle}
            />
            {listening && micError ? (
              <Text className="text-base text-amber" accessibilityLiveRegion="polite">
                {micError}
              </Text>
            ) : null}
            <BigButton label={busy ? S.listenCaptionBusy : S.listenCaptionBtn} color="#122539" dark={false} disabled={busy} onPress={captionSpeech} />
          </View>

          <Text className="mb-2 mt-5 text-lg font-semibold text-muted">{S.listenFeel}</Text>
          <View className="mb-4 gap-2">
            {([
              ["critical", S.listenP1],
              ["high", S.listenP2],
              ["normal", S.listenP3],
            ] as const).map(([p, label]) => (
              <Pressable key={p} onPress={() => vibrateFor(p, true)} accessibilityRole="button" accessibilityLabel={`${S.listenTryVib}: ${label}`} className="min-h-[52px] justify-center rounded-2xl border border-line bg-panel px-4">
                <Text className="text-base text-paper">{label} {S.listenTapFeel}</Text>
              </Pressable>
            ))}
          </View>

          <Text className="mb-2 text-lg font-semibold text-muted">{S.listenCaptions}</Text>
          {events.length === 0 ? (
            <Text className="text-xl leading-relaxed text-paper">{S.listenEmpty}</Text>
          ) : (
            <View className="gap-3">
              {events.map((e, i) => {
                const time = new Date(e.at).toLocaleTimeString(getAppLang() === "es" ? "es-AR" : "en-US", {
                  hour: "2-digit",
                  minute: "2-digit",
                  second: "2-digit",
                });
                return (
                  <View key={`${e.kind}-${e.at}-${i}`} className="rounded-3xl border border-line p-4" style={{ backgroundColor: e.priority === "critical" ? "#3A1220" : "#0D1B29" }} accessibilityLiveRegion="polite">
                    <Text className="text-sm font-bold" style={{ color: e.priority === "critical" ? "#FF5468" : "#3EE6FF" }}>
                      {PRIORITY_STYLE[e.priority].label} · {e.label} · {time}
                    </Text>
                    <Text className={prefs.captionSize === "xlarge" ? "mt-1 text-3xl font-semibold leading-snug text-paper" : "mt-1 text-2xl leading-snug text-paper"}>{e.caption}</Text>
                  </View>
                );
              })}
            </View>
          )}
        </ScrollView>
        {alert?.priority === "critical" ? (
          <Animated.View pointerEvents="none" style={[screenFlashStyle, { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "#FFFFFF" }]} />
        ) : null}
      </Screen>
      <BottomNav />
    </>
  );
}
