import type { SeeResponse } from "@sense-buddy/shared";
import { CameraView, useCameraPermissions, type CameraType } from "expo-camera";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import { router, useLocalSearchParams } from "expo-router";
import { useRef, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { ACCENT, BigButton, BottomNav, Header, Screen } from "../components/ui";
import { api } from "../lib/api";
import { useBuddyStore } from "../lib/store";
import { speak } from "../lib/voice";

const ARROWS: Record<string, string> = {
  left: "←", "ahead-left": "↖", ahead: "↑", "ahead-right": "↗", right: "→", behind: "↓", unknown: "·",
};
const QUESTIONS = ["What is in front of me?", "Is it safe to cross?", "Where is the door?", "Read any text you can see"];

export default function See() {
  const params = useLocalSearchParams<{ q?: string }>();
  const mode = useBuddyStore((s) => s.mode);
  const prefs = useBuddyStore((s) => s.prefs);
  const setOrbState = useBuddyStore((s) => s.setOrbState);
  const setLastReply = useBuddyStore((s) => s.setLastReply);

  const [permission, requestPermission] = useCameraPermissions();
  const [facing, setFacing] = useState<CameraType>("back");
  const [question, setQuestion] = useState(params.q ?? QUESTIONS[0]);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<SeeResponse | null>(null);
  const [error, setError] = useState("");
  const cameraRef = useRef<CameraView>(null);

  const analyze = async (imageBase64: string) => {
    setBusy(true);
    setError("");
    setOrbState("thinking");
    try {
      const res = await api.see(question, imageBase64, mode);
      setResult(res);
      setLastReply(res.guidance);
      setOrbState("speaking");
      speak(res.guidance, prefs, () => setOrbState("idle"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sense Buddy could not look right now.");
      setOrbState("idle");
    } finally {
      setBusy(false);
    }
  };

  const capture = async () => {
    if (!cameraRef.current || busy) return;
    try {
      const photo = await cameraRef.current.takePictureAsync({ quality: 0.7 });
      if (!photo?.uri) return;
      // Downscale to ≤720px before upload: smaller payload, faster + cheaper inference.
      const rendered = await ImageManipulator.manipulate(photo.uri).resize({ width: 720 }).renderAsync();
      const saved = await rendered.saveAsync({ base64: true, compress: 0.6, format: SaveFormat.JPEG });
      if (saved.base64) await analyze(saved.base64);
    } catch {
      setError("Could not take a photo. Hold the phone steady and try again.");
    }
  };

  return (
    <>
      <Screen>
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 16 }}>
          <Header title="See for me" subtitle="SAM 3 segments the scene · Llama reasons in steps & directions" />
          <View className="mb-3 flex-row flex-wrap gap-2">
            {QUESTIONS.map((q) => (
              <Pressable
                key={q}
                onPress={() => setQuestion(q)}
                accessibilityRole="radio"
                accessibilityState={{ selected: question === q }}
                accessibilityLabel={q}
                className="min-h-[48px] justify-center rounded-full border px-4 py-2"
                style={{ borderColor: ACCENT.visual, backgroundColor: question === q ? ACCENT.visual : "#0D1B29" }}
              >
                <Text className="text-base font-semibold" style={{ color: question === q ? "#060D14" : "#F4F9FF" }}>{q}</Text>
              </Pressable>
            ))}
          </View>

          {!permission ? (
            <Text className="text-lg text-muted">Checking camera permission…</Text>
          ) : !permission.granted ? (
            <View className="gap-3">
              <Text className="text-xl leading-relaxed text-paper">Sense Buddy needs your camera to see for you. Photos are only sent when you press the Look button.</Text>
              <BigButton label="Allow camera" onPress={requestPermission} />
            </View>
          ) : (
            <View className="overflow-hidden rounded-3xl border border-line" style={{ height: 380 }}>
              <CameraView ref={cameraRef} style={{ flex: 1 }} facing={facing} />
            </View>
          )}

          <View className="mt-3 gap-3">
            <BigButton label={busy ? "Looking…" : "📷 Look — tell me what you see"} disabled={busy} onPress={capture} />
            <View className="flex-row gap-3">
              <View className="flex-1">
                <BigButton label="Flip camera" color="#122539" dark={false} onPress={() => setFacing((f) => (f === "back" ? "front" : "back"))} />
              </View>
              <View className="flex-1">
                <BigButton label="Try demo scene" hint="No photo needed" color="#122539" dark={false} disabled={busy} onPress={() => analyze("demo".repeat(24))} />
              </View>
            </View>
          </View>

          {error ? <Text className="mt-3 text-lg text-coral" accessibilityLiveRegion="polite">{error}</Text> : null}

          {result && (
            <View className="mt-4 gap-3" accessibilityLiveRegion="polite">
              {result.hazards.length > 0 && (
                <View className="rounded-3xl bg-coral p-4">
                  <Text className="text-xl font-bold text-ink">⚠ Careful</Text>
                  {result.hazards.map((h) => (
                    <Text key={h} className="text-lg font-semibold text-ink">• {h}</Text>
                  ))}
                </View>
              )}
              <View className="rounded-3xl border border-line bg-panel p-4">
                <Text className="text-sm font-semibold text-amber">Sense Buddy · {result.engine === "mock" ? "demo brain" : result.engine === "sam3+llama" ? "SAM 3 + Llama" : "Llama vision"}</Text>
                <Text className="mt-1 text-2xl font-semibold leading-snug text-paper">{result.guidance}</Text>
                <Pressable onPress={() => speak(result.guidance, prefs)} accessibilityRole="button" accessibilityLabel="Hear guidance again" className="mt-3 min-h-[52px] items-center justify-center rounded-2xl bg-panel2">
                  <Text className="text-lg font-semibold text-paper">🔊 Hear it again</Text>
                </Pressable>
              </View>
              {result.objects.map((o, i) => (
                <View key={`${o.label}-${i}`} className="flex-row items-center gap-3 rounded-3xl border border-line bg-panel px-4 py-3">
                  <Text className="text-3xl" style={{ color: o.isHazard ? "#FF5468" : "#FFB224" }}>{ARROWS[o.direction]}</Text>
                  <View className="flex-1">
                    <Text className="text-xl font-semibold capitalize text-paper">{o.label}</Text>
                    <Text className="text-base text-muted">{o.distanceSteps} steps {o.direction.replace("-", " ")} · {Math.round(o.confidence * 100)}% sure</Text>
                  </View>
                </View>
              ))}
              <BigButton label="Done — back home" color="#122539" dark={false} onPress={() => router.push("/home")} />
            </View>
          )}
        </ScrollView>
      </Screen>
      <BottomNav />
    </>
  );
}
