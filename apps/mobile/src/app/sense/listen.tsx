import type { ListenEvent, OrbState } from "@sense-buddy/shared";
import { router, useIsFocused } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Pressable, Text, View, useWindowDimensions } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withSequence, withTiming } from "react-native-reanimated";
import { Orb } from "../../components/Orb";
import { ACCENT, WaveBars } from "../../components/ui";
import { api, isUnauthorized } from "../../lib/api";
import { useAmbientClips, useWavHold } from "../../lib/ambient";
import { useStrings } from "../../lib/i18n";
import { announce } from "../../lib/screenreader";
import { useSense } from "../../lib/sense";
import { useBuddyStore } from "../../lib/store";
import { vibrateFor } from "../../lib/voice";

export default function Listen() {
  const isFocused = useIsFocused();
  const prefs = useBuddyStore((s) => s.prefs);
  // Local orb state (was global → leaked across tabs mid-transition = flash).
  const [orbState, setOrbStateState] = useState<OrbState>("idle");
  const orbRef = useRef<OrbState>("idle");
  const setOrbState = (s: OrbState) => {
    orbRef.current = s;
    setOrbStateState(s);
  };
  const S = useStrings();
  // Capture mode lives in sense/_layout so it survives tab switches.
  const { listenCapture: captureMode, setListenCapture: setCaptureMode } = useSense();
  const [events, setEvents] = useState<(ListenEvent & { at: number })[]>([]);
  const [alert, setAlert] = useState<ListenEvent | null>(null);
  const [manualBusy, setManualBusy] = useState<"idle" | "recording" | "sending">("idle");
  const [noSession, setNoSession] = useState(false);
  const seen = useRef(new Set<string>());
  const screenFlash = useSharedValue(0);
  const prefsRef = useRef(prefs);
  useEffect(() => {
    prefsRef.current = prefs;
  }, [prefs]);
  const captureModeRef = useRef(captureMode);
  useEffect(() => {
    captureModeRef.current = captureMode;
  }, [captureMode]);
  const { width } = useWindowDimensions();
  const orbSize = Math.min(width - 16, 400);

  useEffect(() => {
    if (alert?.priority === "critical") {
      // Strobe blanco a pantalla completa: para quien no siente la vibración.
      screenFlash.value = withSequence(
        withTiming(0.85, { duration: 150 }),
        withTiming(0, { duration: 250 }),
        withTiming(0.85, { duration: 150 }),
        withTiming(0, { duration: 250 }),
        withTiming(0.85, { duration: 150 }),
        withTiming(0, { duration: 400 }),
      );
    } else {
      screenFlash.value = 0;
    }
  }, [alert, screenFlash]);
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
        setTimeout(() => {
          setAlert(null);
          // Back to the ambient state of whichever capture mode is active.
          setOrbState(captureModeRef.current === "live" ? "listening" : "idle");
        }, 4000);
      } else if (e.priority === "normal") {
        vibrateFor("normal", haptics);
      }
    }
  };

  // LIVE: ambient clips loop — auto-detects sounds and captions them.
  const { start, stop, micError, level: liveLevel } = useAmbientClips(async (audioBase64) => {
    try {
      const res = await api.listen("scan", prefsRef.current.userName || undefined, audioBase64);
      ingest(res.events);
    } catch (e) {
      if (isUnauthorized(e)) {
        // Sin sesión: cortar el loop en vez de golpear el server cada 3s.
        setNoSession(true);
        setOrbState("idle");
      }
      /* resto de errores: keep listening silently; next clip retries */
    }
  });

  // Tabs keep this mounted in the background: only run the mic loop while focused.
  // Orb mirrors the mic subsystem (external system sync — not derived render state).
  useEffect(() => {
    if (captureMode !== "live" || noSession || !isFocused) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOrbState("listening");
    void start();
    return () => {
      stop();
      setOrbState("idle");
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [captureMode, noSession, isFocused]);

  // MANUAL: only hears while the orb is held (single WAV clip per hold).
  const { holdStart, holdEnd, level: holdLevel, micError: holdMicError, clearMicError } = useWavHold();

  // Never leave a hold recording running behind the other tab.
  const holdEndRef = useRef(holdEnd);
  useEffect(() => {
    holdEndRef.current = holdEnd;
  }, [holdEnd]);
  useEffect(() => {
    if (!isFocused) {
      void holdEndRef.current();
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setManualBusy("idle");
    }
  }, [isFocused]);

  const manualStart = async () => {
    if (captureMode !== "manual" || manualBusy !== "idle" || noSession) return;
    const ok = await holdStart();
    if (!ok) return;
    setManualBusy("recording");
    setOrbState("listening");
  };

  const manualEnd = async () => {
    if (manualBusy !== "recording") return;
    setManualBusy("sending");
    setOrbState("thinking");
    try {
      const base64 = await holdEnd();
      if (!base64) throw new Error("no recording");
      const res = await api.listen("speech", prefsRef.current.userName || undefined, base64);
      ingest(res.events);
    } catch (e) {
      if (isUnauthorized(e)) {
        setNoSession(true);
        setOrbState("idle");
      }
      /* resto de errores: silent; next hold retries */
    } finally {
      setManualBusy("idle");
      // ingest() may have raised an alert — its own timeout lowers it.
      if (orbRef.current !== "alert") setOrbState("idle");
    }
  };

  const switchCapture = (m: typeof captureMode) => {
    if (m === captureMode) return;
    // Never leave a hold recording running behind the live loop.
    void holdEnd();
    setManualBusy("idle");
    setNoSession(false);
    clearMicError();
    setCaptureMode(m);
    setOrbState("idle");
  };

  const latest = events[0];
  const liveActive = captureMode === "live" && !noSession && isFocused;
  const manualActive = manualBusy !== "idle" && isFocused;
  const wavesActive = liveActive || manualActive;
  const level = captureMode === "live" ? liveLevel : holdLevel;

  // sense/_layout owns SafeArea + StageHeader (persistent, no remount flash).
  return (
    <>
      <View className="flex-1 pb-2">
          <View className="flex-1 items-center justify-center" style={{ overflow: "visible" }}>
            <Orb
              state={orbState}
              mode="hearing"
              level={level}
              size={orbSize}
              showLabel={false}
              onPressIn={captureMode === "manual" ? () => void manualStart() : undefined}
              onPressOut={captureMode === "manual" ? () => void manualEnd() : undefined}
              accessibilityLabel={captureMode === "manual" ? S.listenManualHold : S.listenWatching}
            />
          </View>

          {/* Live Captions card (reference bottom panel) */}
          <View
            className="rounded-[28px] border border-line p-4"
            style={{
              backgroundColor: "rgba(10,24,38,0.88)",
              overflow: "hidden",
              shadowColor: ACCENT.hearing,
              shadowOpacity: 0.18,
              shadowRadius: 18,
              shadowOffset: { width: 0, height: -2 },
            }}
            accessibilityLiveRegion="polite"
          >
            {/* Top-edge light like the reference panel */}
            <View
              pointerEvents="none"
              style={{ position: "absolute", top: 0, left: 28, right: 28, height: 1, backgroundColor: "rgba(62,230,255,0.4)" }}
            />
            <View className="flex-row items-center gap-2.5">
              <WaveBars color={ACCENT.hearing} active={wavesActive} />
              <Text className="flex-1 text-[15px] text-muted">{S.liveCaptions}</Text>
              <View
                className="flex-row rounded-full border border-line bg-panel2 p-1"
                accessibilityRole="radiogroup"
                accessibilityLabel={S.liveCaptions}
              >
                {(["live", "manual"] as const).map((m) => {
                  const selected = captureMode === m;
                  const label = m === "live" ? S.listenLive : S.listenManual;
                  return (
                    <Pressable
                      key={m}
                      onPress={() => switchCapture(m)}
                      accessibilityRole="radio"
                      accessibilityState={{ selected }}
                      accessibilityLabel={label}
                      className="min-h-[36px] items-center justify-center rounded-full px-3"
                      style={{ backgroundColor: selected ? ACCENT.hearing : "transparent" }}
                    >
                      <Text className="text-[13px] font-bold" style={{ color: selected ? "#04211C" : "#8FA6B8" }}>
                        {label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>

            {noSession ? (
              <View className="mt-3 gap-2">
                <Text className="text-lg font-bold text-paper">{S.listenNoSessionT}</Text>
                <Text className="text-base text-muted">{S.listenNoSessionB}</Text>
                <Pressable
                  onPress={() => router.replace("/login")}
                  accessibilityRole="button"
                  accessibilityLabel={S.listenSignInAgain}
                  className="mt-1 min-h-[52px] items-center justify-center rounded-full px-4"
                  style={{ backgroundColor: ACCENT.hearing }}
                >
                  <Text className="text-[16px] font-bold" style={{ color: "#04211C" }}>
                    {S.listenSignInAgain}
                  </Text>
                </Pressable>
              </View>
            ) : latest ? (
              <Text
                numberOfLines={4}
                className={
                  prefs.captionSize === "xlarge"
                    ? "mt-3 text-[24px] font-medium leading-snug text-paper"
                    : "mt-3 text-[20px] leading-snug text-paper"
                }
              >
                {latest.caption}
              </Text>
            ) : (
              <Text className="mt-3 text-xl leading-relaxed text-paper">
                {captureMode === "live" ? S.listenEmpty : S.listenManualEmpty}
              </Text>
            )}

            {liveActive && micError ? (
              <Text className="mt-2 text-sm text-amber" accessibilityLiveRegion="polite">
                {micError}
              </Text>
            ) : null}
            {captureMode === "manual" && holdMicError ? (
              <Text className="mt-2 text-sm text-amber" accessibilityLiveRegion="polite">
                {holdMicError}
              </Text>
            ) : null}
          </View>
        </View>
        {alert?.priority === "critical" ? (
          <Animated.View pointerEvents="none" style={[screenFlashStyle, { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "#FFFFFF" }]} />
        ) : null}
    </>
  );
}
