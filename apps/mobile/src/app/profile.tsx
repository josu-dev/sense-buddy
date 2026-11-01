import { useQuery, useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { Ear, Eye, Settings, Trash2 } from "lucide-react-native";
import { useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { ACCENT, BigButton, BottomNav, ConfirmDialog, Header, Screen } from "../components/ui";
import { api, setToken } from "../lib/api";
import { formatNumber, useStrings } from "../lib/i18n";
import { useBuddyStore } from "../lib/store";
import { useThemeColors } from "../lib/theme";

export default function Profile() {
  const user = useBuddyStore((s) => s.user);
  const mode = useBuddyStore((s) => s.mode);
  const prefs = useBuddyStore((s) => s.prefs);
  const S = useStrings();
  const C = useThemeColors();
  const signOut = useBuddyStore((s) => s.signOut);
  const resetAll = useBuddyStore((s) => s.resetAll);
  const queryClient = useQueryClient();
  const usage = useQuery({ queryKey: ["usage"], queryFn: api.usage, enabled: !!user && user.id !== "offline-demo" });

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const isOfflineDemo = !user || user.id === "offline-demo";

  const pct = usage.data ? Math.min(100, Math.round((usage.data.usedToday / usage.data.dailyBudget) * 100)) : 0;

  const deleteAccount = async () => {
    setDeleting(true);
    setDeleteError("");
    try {
      // Offline demo has no server account — just wipe the device.
      if (!isOfflineDemo) await api.deleteAccount();
    } catch {
      setDeleting(false);
      setDeleteError(S.dangerFailed);
      return;
    }
    await setToken(null);
    queryClient.clear();
    resetAll();
    router.replace("/onboarding");
  };

  return (
    <View className="flex-1 bg-ink">
      <Screen edges={["top", "left", "right"]}>
        <Header title={S.profileTitle} subtitle={S.profileSub} />
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 16 }}>
          <View className="gap-4">
            <View className="rounded-3xl border border-line bg-panel p-5">
              <Text className="text-3xl font-bold text-paper">{prefs.userName || user?.name || S.profileFriend}</Text>
              {user?.email && !user.isAnonymous ? <Text className="mt-1 text-lg text-muted">{user.email}</Text> : null}
              <View className="mt-3 flex-row items-center gap-2">
                <Text className="text-lg text-paper">{S.profileMainMode}:</Text>
                {mode === "visual" ? (
                  <Eye size={20} strokeWidth={2.25} color={C.accentText[mode]} />
                ) : (
                  <Ear size={20} strokeWidth={2.25} color={C.accentText[mode]} />
                )}
                <Text className="text-lg" style={{ color: C.accentText[mode] }}>
                  {mode === "visual" ? S.modeCantSee : S.modeCantHear}
                </Text>
              </View>
            </View>

            <View className="rounded-3xl border border-line bg-panel p-5">
              <Text className="text-xl font-bold text-paper">{S.profileEnergy}</Text>
              {usage.data ? (
                <>
                  <View className="mt-3 h-5 overflow-hidden rounded-full bg-panel2">
                    <View style={{ width: `${pct}%`, backgroundColor: ACCENT[mode], height: "100%" }} />
                  </View>
                  <Text className="mt-2 text-lg text-muted">
                    {formatNumber(usage.data.usedToday)} {S.profileTokens} · {formatNumber(usage.data.remaining)} {S.profileLeft}
                  </Text>
                  <Text className="mt-1 text-base text-muted">{S.profileNote}</Text>
                </>
              ) : (
                <Text className="mt-2 text-lg text-muted">{user?.id === "offline-demo" ? S.profileOffline : S.profileLoading}</Text>
              )}
            </View>

            <BigButton
              label={S.navSettings}
              color={ACCENT[mode]}
              icon={Settings}
              onPress={() => router.navigate("/settings" as never)}
            />
            <BigButton
              label={S.profileSignOut}
              color={C.secondary}
              dark={!C.isDark}
              onPress={async () => {
                // Revoke the server session (skipped for the offline demo,
                // which has none), then clear the device.
                if (user?.id !== "offline-demo") await api.signOutServer().catch(() => null);
                await setToken(null);
                signOut();
                router.replace("/login");
              }}
            />

            <View className="rounded-3xl border-2 bg-panel p-5" style={{ borderColor: C.danger }}>
              <Text className="text-xl font-bold" style={{ color: C.danger }}>
                {S.dangerTitle}
              </Text>
              <Text className="mb-4 mt-1 text-lg leading-relaxed text-muted">{S.dangerSub}</Text>
              <BigButton
                label={S.dangerDelete}
                color={C.danger}
                textColor="#FFFFFF"
                icon={Trash2}
                onPress={() => {
                  setDeleteError("");
                  setConfirmOpen(true);
                }}
              />
              {deleteError ? (
                <Text className="mt-3 text-lg" style={{ color: C.danger }}>
                  {deleteError}
                </Text>
              ) : null}
            </View>
          </View>
        </ScrollView>
      </Screen>
      <ConfirmDialog
        visible={confirmOpen}
        title={S.dangerConfirmTitle}
        message={isOfflineDemo ? S.dangerOfflineMsg : S.dangerConfirmMsg}
        confirmLabel={S.dangerConfirmYes}
        cancelLabel={S.dangerCancel}
        busyLabel={S.dangerDeleting}
        busy={deleting}
        destructive
        onConfirm={deleteAccount}
        onCancel={() => {
          if (!deleting) setConfirmOpen(false);
        }}
      />
      <BottomNav />
    </View>
  );
}
