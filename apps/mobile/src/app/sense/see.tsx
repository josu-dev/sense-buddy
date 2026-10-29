import type { OrbState } from "@sense-buddy/shared";
import { CameraView, useCameraPermissions } from "expo-camera";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import { router, useIsFocused } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Animated, Pressable, Text, View, useWindowDimensions, type GestureResponderEvent, type PanResponderGestureState } from "react-native";
import { Orb } from "../../components/Orb";
import { ACCENT } from "../../components/ui";
import { api, isUnauthorized } from "../../lib/api";
import { useStrings } from "../../lib/i18n";
import { useBuddyStore } from "../../lib/store";
import { speak, stopSpeaking } from "../../lib/voice";

/** Live mode re-describes the scene on this cadence (skipped while busy). */
const LIVE_INTERVAL_MS = 10000;

/** Thumbnails this similar (0..1) count as "same scene" — the frame is skipped. */
const SAME_FRAME_THRESHOLD = 0.96;

/** Byte-similarity of two tiny JPEG thumbnails. Same length + ~identical bytes = static scene. */
function framesMatch(a: string, b: string): boolean {
  if (!a || !b) return false;
  const maxLen = Math.max(a.length, b.length);
  if (Math.abs(a.length - b.length) / maxLen > 0.05) return false;
  const n = Math.min(a.length, b.length);
  let same = 0;
  for (let i = 0; i < n; i++) {
    if (a.charCodeAt(i) === b.charCodeAt(i)) same++;
  }
  return same / maxLen >= SAME_FRAME_THRESHOLD;
}

const clamp = (v: number, min: number, max: number) => Math.min(Math.max(v, min), max);

export default function See() {
  const captureMode = useBuddyStore((s) => s.seeCapture);
  const setCaptureMode = useBuddyStore((s) => s.setSeeCapture);
  const isFocused = useIsFocused();
  const prefs = useBuddyStore((s) => s.prefs);
  // Local orb state: the old global orbState leaked across tabs during the
  // fade transition (both orbs visible, one shared state) — a flash source.
  const [orbState, setOrbState] = useState<OrbState>("idle");
  const setLastReply = useBuddyStore((s) => s.setLastReply);
  const S = useStrings();
  const question = S.seeQ1;

  // Tabs keep this mounted in the background: never narrate over /listen.
  useEffect(() => {
    if (!isFocused) stopSpeaking();
  }, [isFocused]);

  const [permission, requestPermission] = useCameraPermissions();
  const [busy, setBusy] = useState(false);
  const [noSession, setNoSession] = useState(false);
  /** Latest guidance — spoken aloud; mirrored to screen readers via the live region below. */
  const [guidance, setGuidance] = useState("");
  /** Thumbnail of the last sent frame — live mode skips re-sending an unchanged scene. */
  const lastThumb = useRef<string | null>(null);
  const cameraRef = useRef<CameraView>(null);

  const { width } = useWindowDimensions();
  const orbSize = Math.min(width - 16, 400);
  const pipWidth = Math.round((width - 40) * 0.47);
  const pipHeight = Math.round((pipWidth * 3) / 4);

  // Draggable preview position. Plain responder props below claim touches
  // starting on the preview; a release without movement counts as a tap.
  const [dragPos] = useState(() => new Animated.ValueXY({ x: 0, y: 0 }));
  const dragNums = useRef({
    offset: { x: 0, y: 0 },
    start: { x: 0, y: 0 },
    stage: { w: 0, h: 0 },
    size: { w: 0, h: 0 },
    moved: false,
  });
  // Re-clamp after rotation / resize so the preview can't end up off-stage.
  useEffect(() => {
    const d = dragNums.current;
    d.size = { w: pipWidth, h: pipHeight };
    const cx = clamp(d.offset.x, 0, Math.max(0, d.stage.w - pipWidth));
    const cy = clamp(d.offset.y, 0, Math.max(0, d.stage.h - pipHeight));
    d.offset = { x: cx, y: cy };
    dragPos.setValue({ x: cx, y: cy });
  }, [pipWidth, pipHeight, dragPos]);

  const analyze = async (imageBase64: string) => {
    setBusy(true);
    setNoSession(false);
    setOrbState("thinking");
    try {
      const res = await api.see(question, imageBase64, "visual");
      setGuidance(res.guidance);
      setLastReply(res.guidance);
      setOrbState("speaking");
      speak(res.guidance, prefs, () => setOrbState("idle"));
    } catch (e) {
      if (isUnauthorized(e)) {
        setNoSession(true);
      }
      speak(S.seeLookFail, prefs);
      setOrbState("idle");
    } finally {
      setBusy(false);
    }
  };

  /** Capture a frame and describe it (orb tap and preview tap). */
  const capture = async () => {
    if (!cameraRef.current || busy || !isFocused) return;
    try {
      const photo = await cameraRef.current.takePictureAsync({ quality: 0.7 });
      if (!photo?.uri) return;
      // Live: skip unchanged scenes — don't burn API + speech on the same frame.
      if (captureMode === "live") {
        const thumbRendered = await ImageManipulator.manipulate(photo.uri).resize({ width: 32 }).renderAsync();
        const thumb = await thumbRendered.saveAsync({ base64: true, compress: 0.5, format: SaveFormat.JPEG });
        if (thumb.base64) {
          if (lastThumb.current && framesMatch(lastThumb.current, thumb.base64)) return;
          lastThumb.current = thumb.base64;
        }
      }
      // Downscale to ≤720px before upload: smaller payload, faster + cheaper inference.
      const rendered = await ImageManipulator.manipulate(photo.uri).resize({ width: 720 }).renderAsync();
      const saved = await rendered.saveAsync({ base64: true, compress: 0.6, format: SaveFormat.JPEG });
      if (saved.base64) await analyze(saved.base64);
    } catch {
      speak(S.seePhotoFail, prefs);
      setOrbState("idle");
    }
  };

  // LIVE: re-describe the scene on a cadence while this screen is focused.
  const captureRef = useRef(capture);
  useEffect(() => {
    captureRef.current = capture;
  });
  const liveState = useRef({ granted: false, focused: false, noSession: false, busy: false });
  useEffect(() => {
    liveState.current = {
      granted: permission?.granted ?? false,
      focused: isFocused,
      noSession,
      busy,
    };
  });
  useEffect(() => {
    if (captureMode !== "live") return;
    const tick = () => {
      const s = liveState.current;
      if (s.focused && s.granted && !s.noSession && !s.busy) void captureRef.current();
    };
    const initial = setTimeout(tick, 1500);
    const id = setInterval(tick, LIVE_INTERVAL_MS);
    return () => {
      clearTimeout(initial);
      clearInterval(id);
    };
  }, [captureMode]);

  const switchCapture = (m: typeof captureMode) => {
    if (m === captureMode) return;
    stopSpeaking();
    setNoSession(false);
    lastThumb.current = null;
    setCaptureMode(m);
    setOrbState("idle");
  };

  const orbTap = () => {
    if (!permission?.granted) {
      void requestPermission();
      return;
    }
    void capture();
  };

  const tapPreview = () => {
    if (!permission?.granted) {
      void requestPermission();
      return;
    }
    void capture();
  };
  const pipA11y = !permission?.granted ? S.seeAllowCamShort : busy ? S.viewLookingOrb : S.viewTapOrb;

  // sense/_layout owns SafeArea + StageHeader (persistent, no remount flash).
  return (
      <View className="flex-1 pb-2">
        {/* Stage: orb dead-center, draggable preview floating above it. */}
        <View
          className="flex-1"
          onLayout={(e) => {
            dragNums.current.stage = { w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height };
          }}
        >
          <View
            pointerEvents="box-none"
            style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, alignItems: "center", justifyContent: "center", overflow: "visible", zIndex: 1 }}
          >
            <Orb
              state={busy ? "thinking" : orbState}
              mode="visual"
              size={orbSize}
              showLabel={false}
              onTap={orbTap}
              accessibilityLabel={busy ? S.viewLookingOrb : S.viewTapOrb}
            />
          </View>

          <Animated.View
            accessible
            accessibilityRole="button"
            accessibilityLabel={pipA11y}
            accessibilityActions={[{ name: "activate", label: pipA11y }]}
            onAccessibilityAction={tapPreview}
            onAccessibilityTap={tapPreview}
            onStartShouldSetResponder={() => true}
            onResponderGrant={() => {
              const d = dragNums.current;
              d.start = { ...d.offset };
              d.moved = false;
            }}
            onResponderMove={(_e: GestureResponderEvent, g?: PanResponderGestureState) => {
              const dx = g?.dx ?? 0;
              const dy = g?.dy ?? 0;
              if (Math.hypot(dx, dy) < 6 && !dragNums.current.moved) return;
              const d = dragNums.current;
              d.moved = true;
              const nx = clamp(d.start.x + dx, 0, Math.max(0, d.stage.w - d.size.w));
              const ny = clamp(d.start.y + dy, 0, Math.max(0, d.stage.h - d.size.h));
              d.offset = { x: nx, y: ny };
              dragPos.setValue({ x: nx, y: ny });
            }}
            onResponderRelease={() => {
              if (!dragNums.current.moved) tapPreview();
            }}
            onResponderTerminate={() => {
              dragNums.current.moved = false;
            }}
            style={{ position: "absolute", top: 0, left: 0, transform: dragPos.getTranslateTransform(), zIndex: 2 }}
          >
            {permission?.granted && isFocused ? (
              <View
                style={{
                  width: pipWidth,
                  aspectRatio: 4 / 3,
                  borderRadius: 24,
                  overflow: "hidden",
                  borderWidth: 1,
                  borderColor: "rgba(255,178,36,0.45)",
                  backgroundColor: "rgba(10,24,38,0.88)",
                  shadowColor: ACCENT.visual,
                  shadowOpacity: 0.3,
                  shadowRadius: 12,
                  shadowOffset: { width: 0, height: 2 },
                }}
              >
                <CameraView
                  ref={cameraRef}
                  style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }}
                  facing="back"
                  flash="off"
                  animateShutter={false}
                  active={isFocused}
                />
                <View
                  pointerEvents="none"
                  style={{ position: "absolute", top: 10, left: 10, width: 8, height: 8, borderRadius: 4, backgroundColor: ACCENT.visual }}
                />
              </View>
            ) : (
              <View
                className="items-center justify-center gap-1"
                style={{
                  width: pipWidth,
                  aspectRatio: 4 / 3,
                  borderRadius: 24,
                  borderWidth: 1,
                  borderColor: "rgba(255,178,36,0.45)",
                  backgroundColor: "rgba(10,24,38,0.88)",
                }}
              >
                {permission ? (
                  <>
                    <Text className="text-2xl text-paper">📷</Text>
                    <Text className="text-[13px] font-semibold text-paper">{S.seeAllowCamShort}</Text>
                  </>
                ) : null}
              </View>
            )}
            </Animated.View>
        </View>

        {/* Manual / Live capture toggle (reference bottom pill). */}
        <View className="items-center">
          {noSession ? (
            <Pressable
              onPress={() => router.push("/login")}
              accessibilityRole="button"
              accessibilityLabel={S.seeSessionBtn}
              className="min-h-[60px] w-[300px] max-w-full items-center justify-center rounded-full px-4"
              style={{
                backgroundColor: ACCENT.visual,
                shadowColor: ACCENT.visual,
                shadowOpacity: 0.8,
                shadowRadius: 18,
                shadowOffset: { width: 0, height: 2 },
                elevation: 8,
              }}
            >
              <Text className="text-[18px] font-semibold" style={{ color: "#2A1A00" }}>
                {S.seeSessionBtn}
              </Text>
            </Pressable>
          ) : (
            <View
              className="w-[300px] max-w-full flex-row rounded-full border border-line p-1"
              style={{ backgroundColor: "rgba(10,24,38,0.82)" }}
              accessibilityRole="radiogroup"
              accessibilityLabel={S.seeCaptureMode}
            >
              {(["manual", "live"] as const).map((m) => {
                const selected = captureMode === m;
                const label = m === "live" ? S.listenLive : S.listenManual;
                return (
                  <Pressable
                    key={m}
                    onPress={() => switchCapture(m)}
                    accessibilityRole="radio"
                    accessibilityState={{ selected }}
                    accessibilityLabel={label}
                    className="min-h-[60px] flex-1 items-center justify-center rounded-full px-4"
                    style={{
                      backgroundColor: selected ? ACCENT.visual : "transparent",
                      shadowColor: selected ? ACCENT.visual : "transparent",
                      shadowOpacity: selected ? 0.8 : 0,
                      shadowRadius: selected ? 18 : 0,
                      shadowOffset: { width: 0, height: 2 },
                      elevation: selected ? 8 : 0,
                    }}
                  >
                    <Text className="text-[18px] font-semibold" style={{ color: selected ? "#2A1A00" : "#8FA6B8" }}>
                      {label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          )}
        </View>

        {/* Invisible: keeps the spoken guidance reachable for screen readers. */}
        <Text className="h-[1px] opacity-0" accessibilityLiveRegion="polite">
          {guidance}
        </Text>
      </View>
  );
}
