import "../../global.css";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { ThemeSync, themeVars, useAppTheme, useThemeColors } from "../lib/theme";

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 30_000 } },
});

export default function RootLayout() {
  const theme = useAppTheme();
  const C = useThemeColors();
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <QueryClientProvider client={queryClient}>
        <ThemeSync />
        {/* Theme variables cascade to every screen below. */}
        <View style={[{ flex: 1 }, themeVars[theme]]}>
          <StatusBar style={theme === "dark" ? "light" : "dark"} />
          {/* animation:none: the old fade cross-rendered old+new GL orbs for a frame = flash. */}
          <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: C.ink }, animation: "none" }} />
        </View>
      </QueryClientProvider>
    </GestureHandlerRootView>
  );
}
