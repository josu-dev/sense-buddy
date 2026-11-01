import { Tabs } from "expo-router";
import { View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StageHeader } from "../../components/ui";
import { SenseProvider } from "../../lib/sense";
import { useThemeColors } from "../../lib/theme";

/**
 * Canonical sense group: /sense/see + /sense/listen + /sense/say.
 *
 * - Tabs (native, no animation) instead of Stack+replace: switching tabs does
 *   NOT unmount the layout, so StageHeader/ModeNotch never remount (no flash)
 *   and each tab's GL orb / camera / mic state survives after first visit.
 * - Native tab bar is hidden — ModeNotch in the persistent header is the tab bar.
 * - Screens pause resources on blur via useIsFocused (camera preview, mic loop).
 */
export default function SenseLayout() {
  const C = useThemeColors();
  return (
    <SenseProvider>
      <SafeAreaView style={{ flex: 1, backgroundColor: C.ink }}>
        <View style={{ flex: 1, paddingHorizontal: 20, paddingTop: 12 }}>
          <StageHeader />
          <View style={{ flex: 1 }}>
            <Tabs
              screenOptions={{
                headerShown: false,
                tabBarStyle: { display: "none" },
                sceneStyle: { backgroundColor: "transparent" },
                freezeOnBlur: false,
              }}
            >
              <Tabs.Screen name="see" />
              <Tabs.Screen name="listen" />
              <Tabs.Screen name="say" />
              <Tabs.Screen name="index" options={{ href: null }} />
            </Tabs>
          </View>
        </View>
      </SafeAreaView>
    </SenseProvider>
  );
}
