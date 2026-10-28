import type { ListenEvent } from "@sense-buddy/shared";
import { useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withRepeat, withTiming, cancelAnimation } from "react-native-reanimated";
import { ACCENT, BigButton, BottomNav, Header, Screen } from "../components/ui";
import { api } from "../lib/api";
import { useBuddyStore } from "../lib/store";
import { vibrateFor } from "../lib/voice";

const PRIORITY_STYLE: Record<ListenEvent["priority"], { bg: string; label: string }> = {
  critical: { bg: "#FF5468", label: "URGENT" },
  high: { bg: "#FFB224", label: "IMPORTANT" },
  normal: { bg: "#122539", label: "SOUND" },
  low: { bg: "#122539", label: "CALM" },
};

export default function Listen() {
  const prefs = useBuddyStore((s) => s.prefs);
  const setOrbState = useBuddyStore((s) => s.setOrbState);
  const [listening, setListening] = useState(false);
  const [events, setEvents] = useState<ListenEvent[]>([]);
  const [alert, setAlert] = useState<ListenEvent | null>(null);
  const [busy, setBusy] = useState(false);
  const seen = useRef(new Set<string>());
  const flash = useSharedValue(1);

  useEffect(() => {
    if (alert?.priority === "critical") flash.value = withRepeat(withTiming(0.25, { duration: 380 }), -1, true);
    else {
      cancelAnimation(flash);
      flash.value = 1;
    }
  }, [alert, flash]);
  const flashStyle = useAnimatedStyle(() => ({ opacity: flash.value }));

  const ingest = (incoming: ListenEvent[]) => {
    for (const e of incoming) {
      const key = `${e.kind}:${e.caption}`;
      if (seen.current.has(key)) continue;
      seen.current.add(key);
      setEvents((prev) => [e, ...prev].slice(0, 20));
      if (e.priority === "high" || e.priority === "critical") {
        setAlert(e);
        setOrbState("alert");
        vibrateFor(e.priority, prefs.hapticsEnabled);
        setTimeout(() => setOrbState("idle"), 4000);
      } else if (e.priority === "normal") {
        vibrateFor("normal", prefs.hapticsEnabled);
      }
    }
  };

  useEffect(() => {
    if (!listening) return;
    let alive = true;
    const tick = async () => {
      try {
        const res = await api.listen("scan", prefs.userName || undefined);
        if (alive) ingest(res.events);
      } catch { /* keep listening silently; next tick retries */ }
    };
    void tick();
    const id = setInterval(tick, 5000);
    return () => { alive = false; clearInterval(id); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listening]);

  const captionSpeech = async () => {
    setBusy(true);
    try {
      ingest((await api.listen("speech", prefs.userName || undefined)).events);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Screen>
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 16 }}>
          <Header title="Listen for me" subtitle="Important sounds become big captions + distinct vibrations" />

          {alert && (
            <Animated.View style={[flashStyle, { backgroundColor: PRIORITY_STYLE[alert.priority].bg, borderRadius: 24, padding: 18, marginBottom: 14 }]}>
              <Text className="text-lg font-bold text-ink">{PRIORITY_STYLE[alert.priority].label} — {alert.label}</Text>
              <Text className="mt-1 text-2xl font-bold leading-snug text-ink">{alert.caption}</Text>
              <Pressable onPress={() => setAlert(null)} accessibilityRole="button" accessibilityLabel="Dismiss alert" className="mt-3 min-h-[48px] items-center justify-center rounded-2xl bg-ink">
                <Text className="text-lg font-bold text-paper">Got it</Text>
              </Pressable>
            </Animated.View>
          )}

          <View className="gap-3">
            <BigButton
              label={listening ? "⏸ Stop listening" : "♪ Start listening around me"}
              hint={listening ? "Watching for sirens, doorbells, alarms, your name" : "Captions appear below as sounds happen"}
              color={listening ? "#FF5468" : ACCENT.hearing}
              onPress={() => setListening((v) => !v)}
            />
            <BigButton label={busy ? "Listening to speech…" : "💬 Caption what people are saying"} color="#122539" dark={false} disabled={busy} onPress={captionSpeech} />
          </View>

          <Text className="mb-2 mt-5 text-lg font-semibold text-muted">Feel the difference</Text>
          <View className="mb-4 gap-2">
            {([
              ["critical", "Siren / alarm — long triple buzz"],
              ["high", "Doorbell / your name — double buzz"],
              ["normal", "Speech / knock — single buzz"],
            ] as const).map(([p, label]) => (
              <Pressable key={p} onPress={() => vibrateFor(p, true)} accessibilityRole="button" accessibilityLabel={`Try vibration: ${label}`} className="min-h-[52px] justify-center rounded-2xl border border-line bg-panel px-4">
                <Text className="text-base text-paper">{label} — tap to feel</Text>
              </Pressable>
            ))}
          </View>

          <Text className="mb-2 text-lg font-semibold text-muted">Captions</Text>
          {events.length === 0 ? (
            <Text className="text-xl leading-relaxed text-paper">Nothing yet. Press Start listening and I will write down important sounds here, big and clear.</Text>
          ) : (
            <View className="gap-3">
              {events.map((e, i) => (
                <View key={`${e.kind}-${i}`} className="rounded-3xl border border-line p-4" style={{ backgroundColor: e.priority === "critical" ? "#3A1220" : "#0D1B29" }} accessibilityLiveRegion="polite">
                  <Text className="text-sm font-bold" style={{ color: e.priority === "critical" ? "#FF5468" : "#3EE6FF" }}>
                    {PRIORITY_STYLE[e.priority].label} · {e.label} · {Math.round(e.confidence * 100)}%
                  </Text>
                  <Text className={prefs.captionSize === "xlarge" ? "mt-1 text-3xl font-semibold leading-snug text-paper" : "mt-1 text-2xl leading-snug text-paper"}>{e.caption}</Text>
                </View>
              ))}
            </View>
          )}
        </ScrollView>
      </Screen>
      <BottomNav />
    </>
  );
}
