import type { Mode, OrbState } from "@sense-buddy/shared";
import { memo, useEffect, useRef } from "react";
import { Pressable, Text, View } from "react-native";
import Animated, {
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";

const STATE_LABEL: Record<OrbState, string> = {
  idle: "Tap to talk · Double-tap to sense",
  listening: "Listening…",
  thinking: "Thinking…",
  speaking: "Speaking…",
  alert: "Important sound nearby",
};

function Bar({ anim, index, color }: { anim: SharedValue<number>; index: number; color: string }) {
  const style = useAnimatedStyle(() => {
    const phase = (anim.value + index * 0.18) % 1;
    const h = 10 + Math.abs(Math.sin(phase * Math.PI)) * 34;
    return { height: h };
  });
  return <Animated.View style={[{ width: 7, borderRadius: 4, backgroundColor: color }, style]} />;
}

/**
 * The Buddy orb — the single memorable element of the app.
 * Breathes when idle, ripples when listening, dances when speaking,
 * flashes coral only for hazards. All animation runs on the UI thread.
 */
export const Orb = memo(function Orb({
  state,
  mode,
  onTap,
  onDoubleTap,
}: {
  state: OrbState;
  mode: Mode;
  onTap: () => void;
  onDoubleTap: () => void;
}) {
  const pulse = useSharedValue(1);
  const bars = useSharedValue(0);
  const lastTap = useRef(0);

  const accent = state === "alert" ? "#FF5468" : mode === "visual" ? "#FFB224" : "#3EE6FF";

  useEffect(() => {
    cancelAnimation(pulse);
    cancelAnimation(bars);
    const speed = state === "listening" ? 650 : state === "alert" ? 420 : 1700;
    pulse.value = withRepeat(withTiming(1.09, { duration: speed }), -1, true);
    if (state === "speaking") bars.value = withRepeat(withTiming(1, { duration: 900 }), -1, false);
    else bars.value = 0;
  }, [state, pulse, bars]);

  const ring1 = useAnimatedStyle(() => ({ transform: [{ scale: pulse.value }], opacity: 0.35 }));
  const ring2 = useAnimatedStyle(() => ({ transform: [{ scale: 2.18 - pulse.value }], opacity: 0.18 }));
  const core = useAnimatedStyle(() => ({ transform: [{ scale: state === "idle" ? pulse.value : 1 }] }));

  const handlePress = () => {
    const now = Date.now();
    if (now - lastTap.current < 320) {
      lastTap.current = 0;
      onDoubleTap();
    } else {
      lastTap.current = now;
      setTimeout(() => {
        if (lastTap.current !== 0 && Date.now() - lastTap.current >= 320) onTap();
      }, 330);
    }
  };

  return (
    <View className="items-center" accessible accessibilityLabel={`Sense Buddy orb. ${STATE_LABEL[state]}`} accessibilityRole="button">
      <Pressable onPress={handlePress} accessibilityLabel="Buddy orb. Tap to talk, double tap to sense your surroundings." className="items-center justify-center">
        <View className="h-64 w-64 items-center justify-center">
          <Animated.View style={[{ position: "absolute", height: 250, width: 250, borderRadius: 125, borderWidth: 2, borderColor: accent }, ring1]} />
          <Animated.View style={[{ position: "absolute", height: 250, width: 250, borderRadius: 125, borderWidth: 1, borderColor: accent }, ring2]} />
          <Animated.View
            style={[
              { height: 178, width: 178, borderRadius: 89, backgroundColor: "#0D1B29", borderWidth: 3, borderColor: accent, alignItems: "center", justifyContent: "center" },
              core,
            ]}
          >
            {state === "speaking" ? (
              <View className="flex-row items-end gap-1.5" style={{ height: 48 }}>
                {[0, 1, 2, 3, 4].map((i) => (
                  <Bar key={i} anim={bars} index={i} color={accent} />
                ))}
              </View>
            ) : (
              <Text style={{ fontSize: 62 }}>{state === "alert" ? "!" : mode === "visual" ? "◉" : "♪"}</Text>
            )}
            <Text className="mt-1 text-sm font-semibold" style={{ color: accent }}>
              {state === "idle" ? "Sense Buddy" : STATE_LABEL[state].replace("…", "")}
            </Text>
          </Animated.View>
        </View>
      </Pressable>
      <Text className="mt-2 text-center text-base text-muted">{STATE_LABEL[state]}</Text>
    </View>
  );
});
