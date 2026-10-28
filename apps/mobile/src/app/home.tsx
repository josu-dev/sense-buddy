import { QUICK_PHRASES } from "@sense-buddy/shared";
import { router } from "expo-router";
import { useRef, useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { Orb } from "../components/Orb";
import { ACCENT, BigButton, BottomNav, ModeSwitch, Screen } from "../components/ui";
import { api } from "../lib/api";
import { useBuddyStore } from "../lib/store";
import { speak, stopSpeaking } from "../lib/voice";

export default function Home() {
  const mode = useBuddyStore((s) => s.mode);
  const prefs = useBuddyStore((s) => s.prefs);
  const user = useBuddyStore((s) => s.user);
  const orbState = useBuddyStore((s) => s.orbState);
  const setOrbState = useBuddyStore((s) => s.setOrbState);
  const lastReply = useBuddyStore((s) => s.lastReply);
  const setLastReply = useBuddyStore((s) => s.setLastReply);

  const [input, setInput] = useState("");
  const history = useRef<{ role: "user" | "assistant"; content: string }[]>([]);
  const accent = ACCENT[mode];

  const deliver = (reply: string) => {
    setLastReply(reply);
    if (mode === "visual") {
      setOrbState("speaking");
      speak(reply, prefs, () => setOrbState("idle"));
    } else {
      setOrbState("idle");
    }
  };

  const send = async (raw?: string) => {
    const message = (raw ?? input).trim();
    if (!message) return;
    setInput("");
    stopSpeaking();
    setOrbState("thinking");
    try {
      const res = await api.chat(mode, message, history.current);
      history.current = [...history.current.slice(-8), { role: "user", content: message }, { role: "assistant", content: res.reply }];
      deliver(res.reply);
    } catch {
      deliver(
        mode === "visual"
          ? "I can't reach my brain right now, but I am still here. Double-tap me to use See For Me, or check your connection."
          : "Connection lost. I can still watch for important sounds in Listen mode.",
      );
    }
  };

  const onOrbTap = () => {
    if (orbState === "speaking") {
      stopSpeaking();
      setOrbState("idle");
      return;
    }
    setOrbState("listening");
    if (mode === "visual") speak("I'm listening. Pick a question below, or type and press Talk.", prefs, () => setOrbState("idle"));
    setTimeout(() => setOrbState("idle"), 1600);
  };

  const onOrbDoubleTap = () => router.push(mode === "visual" ? "/see" : "/listen");

  return (
    <>
      <Screen>
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 16 }}>
          <Text className="text-2xl font-bold text-paper" accessibilityRole="header">
            Hello{prefs.userName ? `, ${prefs.userName}` : ""}
          </Text>
          <Text className="mb-3 mt-0.5 text-base text-muted">{user?.email ?? ""}</Text>
          <ModeSwitch />

          <View className="my-2">
            <Orb state={orbState} mode={mode} onTap={onOrbTap} onDoubleTap={onOrbDoubleTap} />
          </View>

          {lastReply ? (
            <View className="mb-4 rounded-3xl border border-line bg-panel p-4" accessibilityLiveRegion="polite">
              <Text className="mb-1 text-sm font-semibold" style={{ color: accent }}>
                Sense Buddy says
              </Text>
              <Text className={mode === "hearing" ? (prefs.captionSize === "xlarge" ? "text-3xl font-semibold leading-snug text-paper" : "text-2xl leading-snug text-paper") : "text-xl leading-relaxed text-paper"}>
                {lastReply}
              </Text>
              {mode === "visual" && (
                <Pressable onPress={() => speak(lastReply, prefs)} accessibilityRole="button" accessibilityLabel="Hear that again" className="mt-3 min-h-[52px] items-center justify-center rounded-2xl bg-panel2">
                  <Text className="text-lg font-semibold text-paper">🔊 Hear that again</Text>
                </Pressable>
              )}
            </View>
          ) : null}

          <View className="gap-3">
            {mode === "visual" ? (
              <BigButton label="📷 See for me" hint="Point your camera — I describe what's there, in steps" color={accent} onPress={() => router.push("/see")} />
            ) : (
              <BigButton label="♪ Listen for me" hint="I caption speech and feel out important sounds" color={accent} onPress={() => router.push("/listen")} />
            )}

            <View className="flex-row gap-2">
              <TextInput
                value={input}
                onChangeText={setInput}
                placeholder={mode === "visual" ? "Ask Sense Buddy…" : "Type to Sense Buddy…"}
                placeholderTextColor="#5E7A94"
                accessibilityLabel="Message to Sense Buddy"
                returnKeyType="send"
                onSubmitEditing={() => send()}
                className="min-h-[64px] flex-1 rounded-3xl border border-line bg-panel px-4 text-lg text-paper"
              />
              <Pressable
                onPress={() => send()}
                accessibilityRole="button"
                accessibilityLabel="Talk to Sense Buddy"
                className="min-h-[64px] items-center justify-center rounded-3xl px-5"
                style={{ backgroundColor: accent }}
              >
                <Text className="text-lg font-bold text-ink">Talk</Text>
              </Pressable>
            </View>

            <Text className="text-base font-semibold text-muted">Quick questions</Text>
            <View className="flex-row flex-wrap gap-2">
              {QUICK_PHRASES[mode].map((q) => (
                <Pressable
                  key={q}
                  onPress={() => (mode === "visual" && /front|see|door|cross/i.test(q) ? router.push({ pathname: "/see", params: { q } }) : send(q))}
                  accessibilityRole="button"
                  accessibilityLabel={q}
                  className="min-h-[52px] justify-center rounded-full border border-line bg-panel px-4 py-2"
                >
                  <Text className="text-base text-paper">{q}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        </ScrollView>
      </Screen>
      <BottomNav />
    </>
  );
}
