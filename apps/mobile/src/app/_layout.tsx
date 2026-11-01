import "../../global.css";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Stack, router, usePathname, useSegments } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect, useRef } from "react";
import { LogBox, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { api, getToken, onUnauthorized } from "../lib/api";
import { useBuddyStore, useHydrated } from "../lib/store";
import { ThemeSync, themeVars, useAppTheme, useThemeColors } from "../lib/theme";
import { stopSpeaking } from "../lib/voice";

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 30_000 } },
});

// Our code never uses ImageBackground — this warning is fired transitively by
// react-native-css-interop (NativeWind), which touches RN's deprecated
// `ImageBackground` getter at import time to register className remapping.
// No fixed version exists yet (0.2.7 is latest), so the warning is unactionable
// noise on every reload; ignore exactly that message. The
// no-restricted-imports rule in eslint.config.js guards the flip side: nobody
// can add a real ImageBackground usage that this ignore would hide.
LogBox.ignoreLogs(["ImageBackground is deprecated"]);

/**
 * Global session guard: any API call answering 401 (deleted account,
 * expired/revoked session) signs the device out and bounces to /login —
 * even when the failing call swallows its error (preference sync does).
 * Flipping the user to null also trips RootNavigator's Stack.Protected,
 * which purges every protected screen from the nav history. The explicit
 * replace below stays as the landing-target declaration (and covers
 * unprotected routes like +not-found, where the guard doesn't redirect).
 * Also re-validates a restored session once at boot, so a cold start with
 * a dead token doesn't look logged-in until the first tap.
 */
function AuthSessionWatcher() {
  const segments = useSegments();
  const hydrated = useHydrated();
  const lastBounce = useRef(0);
  const segmentsRef = useRef(segments);
  useEffect(() => {
    segmentsRef.current = segments;
  }, [segments]);

  useEffect(
    () =>
      onUnauthorized(() => {
        // Burst guard: several in-flight calls can 401 together.
        const now = Date.now();
        if (now - lastBounce.current < 2000) return;
        lastBounce.current = now;
        if (useBuddyStore.getState().user) useBuddyStore.getState().signOut();
        queryClient.clear();
        const root = segmentsRef.current[0];
        if (root !== "login" && root !== "onboarding") router.replace("/login");
      }),
    [],
  );

  // One-shot boot validation (offline-safe: only a 401 bounces, via the
  // listener above; network errors are ignored and the user stays put).
  const validated = useRef(false);
  useEffect(() => {
    if (!hydrated || validated.current) return;
    validated.current = true;
    const user = useBuddyStore.getState().user;
    if (!user || user.id === "offline-demo") return;
    void getToken().then((token) => {
      if (token) void api.me().catch(() => undefined);
    });
  }, [hydrated]);

  return null;
}

const isSenseRoute = (pathname: string) => pathname === "/sense" || pathname.startsWith("/sense/");

/**
 * Default TTS policy: any route change cuts ongoing speech, so narration
 * never leaks onto an unrelated screen. The only exception is hopping
 * between sense tabs (see/listen/say) with the "keep voice" setting on —
 * leaving the sense group always stops, setting or not.
 */
function SpeechNavGuard() {
  const pathname = usePathname();
  const prev = useRef<string | null>(null);
  useEffect(() => {
    const from = prev.current;
    prev.current = pathname;
    if (from === null || from === pathname) return;
    const stayingInSense = isSenseRoute(from) && isSenseRoute(pathname);
    if (stayingInSense && useBuddyStore.getState().prefs.stickySenseAudio) return;
    stopSpeaking();
  }, [pathname]);
  return null;
}

/**
 * Auth-gated navigator: profile/settings/sense require a signed-in user.
 * When the guard flips true→false (sign-out, account delete, expired
 * session), Expo Router removes ALL of those screens' history entries and
 * bounces to /login — so back/gesture can never return to a stale view the
 * user no longer has permission to see. index/login/onboarding stay public
 * (login must be reachable mid-guest-flow, when a user already exists).
 */
function RootNavigator() {
  const user = useBuddyStore((s) => s.user);
  const C = useThemeColors();
  return (
    /* animation:none: the old fade cross-rendered old+new GL orbs for a frame = flash. */
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: C.ink }, animation: "none" }}>
      <Stack.Protected guard={user !== null} redirectTo="/login">
        <Stack.Screen name="profile" />
        <Stack.Screen name="settings" />
        <Stack.Screen name="sense" />
      </Stack.Protected>
    </Stack>
  );
}

export default function RootLayout() {
  const theme = useAppTheme();
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <QueryClientProvider client={queryClient}>
        <ThemeSync />
        <AuthSessionWatcher />
        <SpeechNavGuard />
        {/* Theme variables cascade to every screen below. */}
        <View style={[{ flex: 1 }, themeVars[theme]]}>
          <StatusBar style={theme === "dark" ? "light" : "dark"} />
          <RootNavigator />
        </View>
      </QueryClientProvider>
    </GestureHandlerRootView>
  );
}
