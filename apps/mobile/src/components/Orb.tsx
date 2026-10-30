import type { Mode, OrbState } from "@sense-buddy/shared";
import { GLView, type ExpoWebGLRenderingContext } from "expo-gl";
import { useIsFocused } from "expo-router";
import { Ear, Eye, TriangleAlert } from "lucide-react-native";
import { memo, useEffect, useRef, useState } from "react";
import { AppState, Pressable, Text, View } from "react-native";
import { useThemeColors } from "../lib/theme";

const STATE_LABEL: Record<OrbState, string> = {
  idle: "Tap to talk · Double-tap to sense",
  listening: "Listening…",
  thinking: "Thinking…",
  speaking: "Speaking…",
  alert: "Important sound nearby",
};

/** Render the GL surface at 75% and scale it up: fewer fragment invocations, same glow. */
const GL_SCALE = 0.75;

const VERT = `
attribute vec2 a_pos;
varying vec2 v_uv;
void main() {
  v_uv = a_pos * 0.5 + 0.5;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}
`;

/**
 * Analytic 3D sphere, no textures / geometry / post passes — one draw call.
 * A transparent glass body with fast internal currents and a wobbling,
 * deforming edge — deliberately NO rings, waves or lines emanating out.
 * The corners fade exactly to the theme background (u_abyss uniform) so the
 * square surface edge never shows, in light or dark mode.
 */
const FRAG = `
precision mediump float;
varying vec2 v_uv;
uniform float u_time;
uniform float u_level;
uniform float u_energy;
uniform float u_alert;
uniform vec3 u_colDeep;
uniform vec3 u_colMain;
uniform vec3 u_colHi;
uniform vec3 u_abyss;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

void main() {
  vec2 p = v_uv * 2.0 - 1.0;
  float r = length(p);
  float ang = atan(p.y, p.x);
  float t = u_time;
  vec3 abyss = u_abyss;

  // Abyss + one soft breathing bloom. Nothing emanates from the orb.
  vec3 col = abyss;
  float breathe = 0.5 + 0.5 * sin(t * 1.3);
  col += u_colMain * 0.22 * exp(-r * 1.9) * (0.55 + 0.65 * u_energy + 0.10 * breathe);
  col += u_colHi * 0.06 * exp(-r * 3.4) * (0.5 + u_energy);

  // Deforming edge: layered angular waves, wilder with the voice level.
  float wobAmp = 0.010 + 0.030 * u_level + 0.006 * u_energy;
  float wob = sin(ang * 3.0 + t * 2.1) * 0.45
            + sin(ang * 5.0 - t * 3.2) * 0.30
            + sin(ang * 8.0 + t * 4.6) * 0.18
            + sin(ang * 13.0 - t * 6.1) * 0.07;
  float sphereR = 0.60 + wob * wobAmp + u_level * 0.012;
  float fieldR = sphereR + 0.05;

  // Glass body — transparent, lit from within by fast internal waves.
  if (r < fieldR) {
    float rc = min(r, sphereR);
    float z = sqrt(max(sphereR * sphereR - rc * rc, 0.0)) / sphereR;
    vec3 n = normalize(vec3(p / max(sphereR, 0.0001), z));
    vec3 lightDir = normalize(vec3(-0.45, 0.62, 0.78));
    float diff = clamp(dot(n, lightDir), 0.0, 1.0);
    float fres = pow(1.0 - z, 2.0);

    // Internal currents — tempo follows the voice.
    float flow = t * (1.1 + 2.2 * u_level + 0.6 * u_energy);
    vec2 q = p * 3.6;
    float swirl = sin(q.x * 1.9 + sin(q.y * 2.4 + flow * 0.9) * 1.7 + flow * 0.6)
                + sin(q.y * 2.2 + sin(q.x * 2.0 - flow * 0.7) * 1.5 - flow * 0.45);
    swirl = swirl * 0.25 + 0.5;
    float band = smoothstep(0.15, 0.95, sin((p.x + p.y) * 4.6 + swirl * 5.4 + flow) * 0.5 + 0.5);
    float veil = smoothstep(0.3, 0.9, sin((p.x * 0.8 - p.y * 1.2) * 3.4 + swirl * 3.6 - flow * 0.8) * 0.5 + 0.5);

    vec3 body = mix(u_colDeep * 0.6, u_colMain, diff * 0.7 + swirl * 0.45);
    body = mix(body, u_colHi, band * (0.30 + 0.45 * u_level) + veil * 0.20 + fres * 0.55);
    body += u_colHi * pow(diff, 5.0) * 0.7; // glass specular, top-left
    body += u_colMain * u_level * 0.4 * (0.5 + 0.5 * sin(t * 10.0 + p.y * 9.0));

    // Glassy: sheer in the center, denser toward the rim.
    float alpha = mix(0.42, 0.92, fres) + u_level * 0.10;
    alpha *= 1.0 - smoothstep(sphereR - 0.01, fieldR, r);
    col = mix(col, body, clamp(alpha, 0.0, 0.96));
  }

  // Rim light tracing the deformed edge + sparse drifting motes.
  float rimD = abs(r - sphereR);
  col += u_colMain * exp(-22.0 * rimD) * (0.7 + 1.0 * u_energy);
  col += u_colHi * exp(-40.0 * rimD) * (0.25 + 0.45 * u_energy);
  vec2 cell = floor(p * 30.0);
  float mote = step(0.986, hash(cell)) * smoothstep(0.55, 0.8, r) * (0.35 + 0.65 * fract(t * 0.2 + hash(cell + 7.0)));
  col += u_colHi * mote * 0.45;

  // Fade the corners to the abyss so the square surface edge never shows.
  col = mix(abyss, col, 1.0 - smoothstep(0.90, 1.04, r));

  col = mix(col, vec3(1.0, 0.25, 0.32), u_alert * 0.22 * (0.4 + exp(-r * 2.0)));
  gl_FragColor = vec4(col, 1.0);
}
`;

function hexRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

const PALETTE: Record<Mode, { deep: string; main: string; hi: string }> = {
  visual: { deep: "#3A2404", main: "#FFB224", hi: "#FFE3A3" },
  hearing: { deep: "#043A3F", main: "#2EE6C8", hi: "#B8FFF1" },
};
const ALERT_MAIN = "#FF5468";

/**
 * The Buddy orb — a real GLSL sphere (expo-gl, included in Expo Go),
 * reactive to what the buddy hears and says:
 *  - `state` sets energy/tempo (idle breathes, speaking dances, alert flares)
 *  - `level` is the live voice amplitude 0..1 (mic metering when available;
 *    a procedural voice wave is synthesised while speaking, since TTS has
 *    no metering callback)
 *
 * Energy budget: 75%-resolution surface, `msaaSamples={0}`, one draw call,
 * ~22 fps idle / ~30 fps active, loop fully paused when the screen is
 * unfocused or the app is backgrounded. If GL is unavailable the fallback
 * below renders instead.
 */
export const Orb = memo(function Orb({
  state,
  mode,
  onTap,
  onDoubleTap,
  onPressIn,
  onPressOut,
  size = 288,
  level = 0,
  showLabel = true,
  accessibilityLabel,
}: {
  state: OrbState;
  mode: Mode;
  onTap?: () => void;
  onDoubleTap?: () => void;
  onPressIn?: () => void;
  onPressOut?: () => void;
  size?: number;
  level?: number;
  showLabel?: boolean;
  accessibilityLabel?: string;
}) {
  const isFocused = useIsFocused();
  const [glFailed, setGlFailed] = useState(false);
  const lastTap = useRef(0);
  const C = useThemeColors();

  // Latest inputs for the GL loop — refs so frames never re-render React.
  const live = useRef({ state, mode, level, focused: true, appActive: true, abyss: C.orbAbyss });
  live.current.state = state;
  live.current.mode = mode;
  live.current.level = level;
  live.current.focused = isFocused;
  live.current.abyss = C.orbAbyss;

  useEffect(() => {
    const sub = AppState.addEventListener("change", (s) => {
      live.current.appActive = s === "active";
    });
    return () => sub.remove();
  }, []);

  const timeRef = useRef(0);
  const levelRef = useRef(0);
  const glStopRef = useRef<(() => void) | null>(null);
  useEffect(() => () => glStopRef.current?.(), []);

  const onContextCreate = (gl: ExpoWebGLRenderingContext) => {
    try {
      const compile = (type: number, src: string) => {
        const sh = gl.createShader(type);
        if (!sh) throw new Error("no shader");
        gl.shaderSource(sh, src);
        gl.compileShader(sh);
        if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error("shader compile failed");
        return sh;
      };
      const program = gl.createProgram();
      if (!program) throw new Error("no program");
      gl.attachShader(program, compile(gl.VERTEX_SHADER, VERT));
      gl.attachShader(program, compile(gl.FRAGMENT_SHADER, FRAG));
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error("link failed");
      gl.useProgram(program);

      const buffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
      const loc = gl.getAttribLocation(program, "a_pos");
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

      const u = (name: string) => gl.getUniformLocation(program, name);
      const uTime = u("u_time");
      const uLevel = u("u_level");
      const uEnergy = u("u_energy");
      const uAlert = u("u_alert");
      const uDeep = u("u_colDeep");
      const uMain = u("u_colMain");
      const uHi = u("u_colHi");
      const uAbyss = u("u_abyss");
      gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);

      let raf = 0;
      let last = performance.now();
      let lastDraw = 0;
      const draw = (now: number) => {
        raf = requestAnimationFrame(draw);
        const cur = live.current;
        if (!cur.focused || !cur.appActive) {
          last = now;
          return; // paused: zero GL work while off-screen / backgrounded
        }
        const st = cur.state;
        const interval = st === "idle" ? 45 : 33; // ~22fps idle, ~30fps active
        if (now - lastDraw < interval) return;
        const dt = Math.min((now - last) / 1000, 0.1);
        last = now;
        lastDraw = now;

        const tempo = st === "speaking" ? 1.7 : st === "listening" ? 1.4 : st === "alert" ? 2.0 : st === "thinking" ? 1.1 : 0.8;
        timeRef.current += dt * tempo;
        const t = timeRef.current;

        // Voice amplitude: real metering wins; speaking synthesises a voice.
        let target = 0.14 + 0.06 * Math.sin(t * 1.6);
        if (st === "speaking") {
          target = 0.52 + 0.28 * Math.abs(Math.sin(t * 6.3) * Math.sin(t * 2.7 + 1.3)) + 0.14 * Math.sin(t * 13.7);
        } else if (st === "listening") {
          target = Math.max(cur.level, 0.22 + 0.1 * Math.sin(t * 3.4));
        } else if (st === "thinking") {
          target = 0.3 + 0.12 * Math.sin(t * 4.2);
        } else if (st === "alert") {
          target = 0.75 + 0.25 * Math.sin(t * 10.0);
        }
        levelRef.current += (Math.max(0, Math.min(1, target)) - levelRef.current) * 0.35;

        const pal = PALETTE[cur.mode];
        const main = hexRgb(st === "alert" ? ALERT_MAIN : pal.main);
        const hi = hexRgb(pal.hi);
        const deep = hexRgb(pal.deep);

        gl.uniform1f(uTime, t);
        gl.uniform1f(uLevel, levelRef.current);
        gl.uniform1f(uEnergy, st === "idle" ? 0.45 : st === "thinking" ? 0.7 : 1);
        gl.uniform1f(uAlert, st === "alert" ? 1 : 0);
        gl.uniform3f(uDeep, deep[0], deep[1], deep[2]);
        gl.uniform3f(uMain, main[0], main[1], main[2]);
        gl.uniform3f(uHi, hi[0], hi[1], hi[2]);
        const ab = cur.abyss;
        gl.uniform3f(uAbyss, ab[0], ab[1], ab[2]);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        gl.flush();
        gl.endFrameEXP();
      };
      raf = requestAnimationFrame(draw);
      glStopRef.current = () => cancelAnimationFrame(raf);
    } catch {
      setGlFailed(true);
    }
  };

  const accent = state === "alert" ? ALERT_MAIN : PALETTE[mode].main;
  const glSize = Math.round(size * GL_SCALE);

  const handlePressIn = () => {
    onPressIn?.();
  };
  const handlePress = () => {
    if (!onDoubleTap) {
      onTap?.();
      return;
    }
    const now = Date.now();
    if (now - lastTap.current < 320) {
      lastTap.current = 0;
      onDoubleTap();
    } else {
      lastTap.current = now;
      setTimeout(() => {
        if (lastTap.current !== 0 && Date.now() - lastTap.current >= 320) onTap?.();
      }, 330);
    }
  };

  return (
    <View className="items-center" accessible accessibilityLabel={accessibilityLabel ?? `Sense Buddy orb. ${STATE_LABEL[state]}`} accessibilityRole="button">
      <Pressable
        onPressIn={handlePressIn}
        onPressOut={onPressOut}
        onPress={handlePress}
        accessibilityLabel={accessibilityLabel ?? "Buddy orb. Tap to talk, double tap to sense your surroundings."}
        className="items-center justify-center"
      >
        <View style={{ width: size, height: size, overflow: "visible" }} className="items-center justify-center">
          {glFailed ? (
            // Fallback (no GL): layered translucent currents on the UI thread.
            <View style={{ width: size * 0.78, height: size * 0.78, borderRadius: size / 2, backgroundColor: C.orbFallback, borderWidth: 2, borderColor: accent, alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
              <View style={{ position: "absolute", width: size * 0.6, height: size * 0.4, borderRadius: size / 2, backgroundColor: accent, opacity: 0.28, transform: [{ rotate: "-18deg" }, { translateY: -size * 0.14 }] }} />
              <View style={{ position: "absolute", width: size * 0.65, height: size * 0.36, borderRadius: size / 2, backgroundColor: accent, opacity: 0.18, transform: [{ rotate: "14deg" }, { translateY: size * 0.16 }] }} />
              {state === "alert" ? (
                <TriangleAlert size={size * 0.18} strokeWidth={2.25} color={accent} />
              ) : mode === "visual" ? (
                <Eye size={size * 0.18} strokeWidth={2} color={accent} />
              ) : (
                <Ear size={size * 0.18} strokeWidth={2} color={accent} />
              )}
            </View>
          ) : (
            <GLView
              style={{ width: glSize, height: glSize, transform: [{ scale: 1 / GL_SCALE }], backgroundColor: C.ink }}
              msaaSamples={0}
              onContextCreate={onContextCreate}
            />
          )}
        </View>
      </Pressable>
      {showLabel ? <Text className="mt-1 text-center text-base text-muted">{STATE_LABEL[state]}</Text> : null}
    </View>
  );
});
