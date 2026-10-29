import type { SeeResponse } from "@sense-buddy/shared";
import { CameraView, useCameraPermissions, type CameraType } from "expo-camera";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import { router, useLocalSearchParams } from "expo-router";
import { useRef, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { ACCENT, BigButton, BottomNav, Header, Screen } from "../components/ui";
import { api, isUnauthorized } from "../lib/api";
import { useStrings } from "../lib/i18n";
import { useBuddyStore } from "../lib/store";
import { speak } from "../lib/voice";

const ARROWS: Record<string, string> = {
  left: "←", "ahead-left": "↖", ahead: "↑", "ahead-right": "↗", right: "→", behind: "↓", unknown: "·",
};

export default function See() {
  const params = useLocalSearchParams<{ q?: string }>();
  const mode = useBuddyStore((s) => s.mode);
  const prefs = useBuddyStore((s) => s.prefs);
  const setOrbState = useBuddyStore((s) => s.setOrbState);
  const setLastReply = useBuddyStore((s) => s.setLastReply);
  const S = useStrings();
  const QUESTIONS = [S.seeQ1, S.seeQ2, S.seeQ3, S.seeQ4];

  const [permission, requestPermission] = useCameraPermissions();
  const [facing, setFacing] = useState<CameraType>("back");
  const [question, setQuestion] = useState(params.q ?? QUESTIONS[0]);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<SeeResponse | null>(null);
  const [error, setError] = useState("");
  const [noSession, setNoSession] = useState(false);
  const cameraRef = useRef<CameraView>(null);

  const analyze = async (imageBase64: string) => {
    setBusy(true);
    setError("");
    setNoSession(false);
    setOrbState("thinking");
    try {
      const res = await api.see(question, imageBase64, mode);
      setResult(res);
      setLastReply(res.guidance);
      setOrbState("speaking");
      speak(res.guidance, prefs, () => setOrbState("idle"));
    } catch (e) {
      if (isUnauthorized(e)) {
        setNoSession(true);
        setError(S.seeSessionMsg);
      } else {
        setError(e instanceof Error ? e.message : S.seeLookFail);
      }
      if (mode === "visual") speak(S.seeLookFail, prefs);
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
      setError(S.seePhotoFail);
    }
  };

  // Ciego: un solo botón gigante que ocupa la pantalla. Sin previews ni opciones.
  if (mode === "visual") {
    return (
      <>
        <Screen>
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 16, flexGrow: 1 }}>
          {!permission ? (
            <View className="flex-1 items-center justify-center">
              <Text className="text-center text-2xl text-muted">{S.seePreparing}</Text>
            </View>
          ) : !permission.granted ? (
            <View className="flex-1 items-center justify-center gap-5">
              <Text className="text-center text-3xl font-bold leading-snug text-paper">
                {S.seeNeedCam}
              </Text>
              <BigButton label={S.seeAllowCam} onPress={requestPermission} />
            </View>
          ) : (
            <View className="flex-1">
              {/* Cámara montada pero fuera de vista: solo se usa para capturar. */}
              <View style={{ height: 1, opacity: 0, overflow: "hidden" }}>
                <CameraView ref={cameraRef} style={{ flex: 1 }} facing={facing} />
              </View>
              {noSession ? (
                <View className="flex-1 items-center justify-center gap-4">
                  <Text className="text-center text-3xl font-bold leading-snug text-paper">{S.seeSessionTitle}</Text>
                  <BigButton label={S.seeSessionBtn} color={ACCENT.visual} onPress={() => router.push("/login")} />
                </View>
              ) : (
                <Pressable
                  onPress={capture}
                  disabled={busy}
                  accessibilityRole="button"
                  accessibilityLabel={busy ? S.seeLooking : `${S.seeTapTitle}. ${S.seeTapSub}.`}
                  className="flex-1 items-center justify-center rounded-[32px] px-6"
                  style={{ backgroundColor: busy ? "#1E3448" : ACCENT.visual, minHeight: 380 }}
                >
                  <Text className="text-center text-5xl font-bold leading-tight" style={{ color: "#060D14" }}>
                    {busy ? S.seeLooking : S.seeTapTitle}
                  </Text>
                  <Text className="mt-3 text-center text-xl font-semibold" style={{ color: "#3A2A00" }}>
                    {S.seeTapSub}
                  </Text>
                </Pressable>
              )}
              {error && !noSession ? (
                <Text className="mt-4 text-center text-2xl font-semibold leading-snug text-coral" accessibilityLiveRegion="assertive">
                  {error}
                </Text>
              ) : null}
              {result && !noSession ? (
                <Pressable
                  onPress={() => speak(result.guidance, prefs)}
                  accessibilityRole="button"
                  accessibilityLabel={`${result.guidance}. ${S.seeHearAgainA11y}.`}
                  className="mt-4 rounded-[32px] border border-line bg-panel p-5"
                  accessibilityLiveRegion="polite"
                >
                  <Text className="text-center text-3xl font-semibold leading-snug text-paper">{result.guidance}</Text>
                  {result.hazards.length > 0 ? (
                    <Text className="mt-2 text-center text-2xl font-bold text-coral">{S.seeCareful}: {result.hazards[0]}</Text>
                  ) : null}
                </Pressable>
              ) : null}
            </View>
          )}
        </ScrollView>
      </Screen>
      </>
    );
  }

  return (
    <>
      <Screen>
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 16 }}>
          <Header title={S.seeTitle} subtitle={S.seeSubtitle} />
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
            <Text className="text-lg text-muted">{S.seeCheckingCam}</Text>
          ) : !permission.granted ? (
            <View className="gap-3">
              <Text className="text-xl leading-relaxed text-paper">{S.seeNeedCamLong}</Text>
              <BigButton label={S.seeAllowCamShort} onPress={requestPermission} />
            </View>
          ) : (
            <View className="overflow-hidden rounded-3xl border border-line" style={{ height: 380 }}>
              <CameraView ref={cameraRef} style={{ flex: 1 }} facing={facing} />
            </View>
          )}

          <View className="mt-3 gap-3">
            <BigButton label={busy ? S.seeLookingShort : S.seeLookBtn} disabled={busy} onPress={capture} />
            <View className="flex-row gap-3">
              <View className="flex-1">
                <BigButton label={S.seeFlip} color="#122539" dark={false} onPress={() => setFacing((f) => (f === "back" ? "front" : "back"))} />
              </View>
              <View className="flex-1">
                <BigButton label={S.seeDemo} hint={S.seeDemoHint} color="#122539" dark={false} disabled={busy} onPress={() => analyze("demo".repeat(24))} />
              </View>
            </View>
          </View>

          {error ? <Text className="mt-3 text-lg text-coral" accessibilityLiveRegion="polite">{error}</Text> : null}

          {result && (
            <View className="mt-4 gap-3" accessibilityLiveRegion="polite">
              {result.hazards.length > 0 && (
                <View className="rounded-3xl bg-coral p-4">
                  <Text className="text-xl font-bold text-ink">{S.seeCareful}</Text>
                  {result.hazards.map((h) => (
                    <Text key={h} className="text-lg font-semibold text-ink">• {h}</Text>
                  ))}
                </View>
              )}
              <View className="rounded-3xl border border-line bg-panel p-4">
                <Text className="text-sm font-semibold text-amber">Sense Buddy · {result.engine === "mock" ? "demo brain" : result.engine === "sam3+llama" ? "SAM 3 + Llama" : "Llama vision"}</Text>
                <Text className="mt-1 text-2xl font-semibold leading-snug text-paper">{result.guidance}</Text>
                <Pressable onPress={() => speak(result.guidance, prefs)} accessibilityRole="button" accessibilityLabel={S.seeHearAgainA11y} className="mt-3 min-h-[52px] items-center justify-center rounded-2xl bg-panel2">
                  <Text className="text-lg font-semibold text-paper">{S.seeHearAgain}</Text>
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
              <BigButton label={S.seeDone} color="#122539" dark={false} onPress={() => router.push("/home")} />
            </View>
          )}
        </ScrollView>
      </Screen>
      <BottomNav />
    </>
  );
}
