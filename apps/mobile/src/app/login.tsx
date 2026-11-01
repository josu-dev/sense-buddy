import { router } from "expo-router";
import { useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { ACCENT, AppleLogo, BackButton, BigButton, BrandMark, GoogleLogo, Screen } from "../components/ui";
import { useStrings } from "../lib/i18n";
import { api, setToken, type AuthUser } from "../lib/api";
import { isGoogleAuthAvailable, isGoogleCancel, requestGoogleIdToken } from "../lib/googleAuth";
import { hydratePreferences, pushPreferences } from "../lib/prefsSync";
import { useBuddyStore } from "../lib/store";
import { useThemeColors } from "../lib/theme";

type Provider = "google" | "apple" | "guest";

export default function Login() {
  const signIn = useBuddyStore((s) => s.signIn);
  const mode = useBuddyStore((s) => s.mode);
  const prefs = useBuddyStore((s) => s.prefs);
  const updatePrefs = useBuddyStore((s) => s.updatePrefs);
  const S = useStrings();
  const C = useThemeColors();
  const [busy, setBusy] = useState<Provider | null>(null);
  const [notice, setNotice] = useState("");
  // Guest step 2: the name is collected AFTER the anonymous sign-in resolves.
  const [step, setStep] = useState<"providers" | "guestName">("providers");
  const [guestUser, setGuestUser] = useState<AuthUser | null>(null);
  const [guestName, setGuestName] = useState("");
  const [savingName, setSavingName] = useState(false);

  const goSense = () => {
    // Land on the canonical sense tab right after auth.
    const m = useBuddyStore.getState().mode;
    const target = (m === "visual" ? "/sense/see" : m === "hearing" ? "/sense/listen" : "/sense/say") as never;
    router.replace(target);
  };

  const finishSignIn = async (user: AuthUser, isNew: boolean, adoptName: boolean) => {
    signIn({ id: user.id, name: user.name, email: user.email, isAnonymous: user.isAnonymous });
    if (isNew) {
      if (adoptName && !useBuddyStore.getState().prefs.userName && user.name) {
        // New OAuth user, no local name yet (onboarding no longer asks):
        // take the first name from the provider profile for greetings +
        // name-call alerts. Editable later in Settings.
        updatePrefs({ userName: user.name.split(/\s+/)[0] ?? user.name });
      }
      pushPreferences(); // first login: local choices become the profile
    } else {
      await hydratePreferences().catch(() => undefined); // returning: profile wins
    }
    goSense();
  };

  // Offline demo fallback: the hackathon demo must never dead-end.
  const offlineFallback = async (provider: Provider) => {
    await setToken(null);
    const fallback: AuthUser = { id: "offline-demo", name: prefs.userName || "Demo Friend", email: "offline@sensebuddy.app" };
    signIn(fallback);
    setNotice(S.loginOffline);
    if (provider === "guest") {
      setGuestUser(fallback); // offline guests still get the name step (saved locally)
      setStep("guestName");
    } else {
      goSense();
    }
  };

  /** Revoke a pending guest session before switching to another provider (no orphan sessions). */
  const dropGuestSession = async () => {
    setGuestUser(null);
    if (useBuddyStore.getState().user?.isAnonymous) {
      await api.signOutServer().catch(() => null);
      await setToken(null);
      useBuddyStore.getState().signOut();
    }
  };

  const loginGoogle = async () => {
    setBusy("google");
    setNotice("");
    try {
      await dropGuestSession();
      if (isGoogleAuthAvailable()) {
        try {
          // Real OAuth: one browser session → Google ID token → BetterAuth
          // verifies it server-side and returns a Bearer session.
          const { idToken, nonce } = await requestGoogleIdToken();
          const { user } = await api.signInWithGoogle(idToken, nonce);
          const me = await api.me().catch(() => null);
          await finishSignIn(user, !me?.preference, true);
          return;
        } catch (e) {
          if (isGoogleCancel(e)) return; // user backed out of the browser: stay put, no noise
          setNotice(S.loginGoogleDemo);
        }
      } else {
        // Expo Go / unconfigured build: demo Google account instead.
        setNotice(S.loginGoogleDemo);
      }
      const data = await api.mockLogin("google", prefs.userName || "Demo Friend");
      await finishSignIn(data.user, data.isNew, false);
    } catch {
      await offlineFallback("google");
    } finally {
      setBusy(null);
    }
  };

  const loginApple = async () => {
    setBusy("apple");
    setNotice("");
    try {
      await dropGuestSession();
      // No Apple OAuth configured yet — demo account (real BetterAuth user+session).
      const data = await api.mockLogin("apple", prefs.userName || "Demo Friend");
      await finishSignIn(data.user, data.isNew, false);
    } catch {
      await offlineFallback("apple");
    } finally {
      setBusy(null);
    }
  };

  const loginGuest = async () => {
    // Already holding a fresh guest session (came Back from the name step)?
    // Don't mint another anonymous user — go straight back to naming it.
    if (guestUser) {
      setStep("guestName");
      return;
    }
    setBusy("guest");
    setNotice("");
    try {
      // Real anonymous account (BetterAuth anonymous plugin). Name comes next.
      const { user } = await api.signInAnonymous();
      signIn({ id: user.id, name: user.name, email: user.email, isAnonymous: user.isAnonymous });
      const me = await api.me().catch(() => null);
      if (!me?.preference) {
        setGuestUser(user);
        setStep("guestName");
      } else {
        await hydratePreferences().catch(() => undefined);
        goSense();
      }
    } catch {
      await offlineFallback("guest");
    } finally {
      setBusy(null);
    }
  };

  const saveGuestName = async (skip: boolean) => {
    if (!guestUser || savingName) return;
    setSavingName(true);
    try {
      const name = skip ? "" : guestName.trim();
      if (name) {
        await api.updateUserName(name).catch(() => null); // offline-safe: local prefs still save
        updatePrefs({ userName: name });
        signIn({ ...guestUser, name });
      }
      pushPreferences(); // fire-and-forget, offline-safe
      goSense();
    } finally {
      setSavingName(false);
    }
  };

  if (step === "guestName") {
    return (
      <Screen>
        <View className="gap-4 pt-2">
          <View className="flex-row">
            <BackButton onPress={() => !savingName && setStep("providers")} label={S.obBack} />
          </View>
          <BrandMark size={48} />
          <Text className="text-center text-4xl font-bold text-paper" accessibilityRole="header">
            {S.obAlmost}
          </Text>
          <Text className="text-center text-lg leading-relaxed text-muted">
            {S.obNameSub}
          </Text>
          <TextInput
            value={guestName}
            onChangeText={setGuestName}
            placeholder={S.obNamePh}
            placeholderTextColor={C.placeholder}
            accessibilityLabel={S.obNamePh}
            autoFocus
            className="min-h-[64px] rounded-3xl border border-line bg-panel px-5 text-xl text-paper"
          />
          <BigButton
            label={savingName ? S.loginSigning : S.guestNameSave}
            color={ACCENT[mode]}
            disabled={savingName}
            onPress={() => saveGuestName(false)}
          />
          <Pressable
            onPress={() => saveGuestName(true)}
            disabled={savingName}
            accessibilityRole="button"
            accessibilityLabel={S.guestNameSkip}
            className="items-center justify-center py-2 active:opacity-60"
          >
            <Text className="text-center text-lg text-muted">{S.guestNameSkip}</Text>
          </Pressable>
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      <View className="gap-4 pt-10">
        <BrandMark size={48} />
        <Text className="text-center text-4xl font-bold text-paper" accessibilityRole="header">
          {S.loginHi}
        </Text>
        <Text className="text-center text-lg leading-relaxed text-muted">
          {S.loginSub}
        </Text>
        {/* Hairline keeps the white Google button crisp on the light background. */}
        <View className="rounded-3xl border border-line">
          <BigButton
            label={busy === "google" ? S.loginSigning : S.loginGoogle}
            disabled={!!busy}
            onPress={loginGoogle}
            color="#FFFFFF"
            textColor="#1F1F1F"
            leftNode={<GoogleLogo size={24} />}
          />
        </View>
        <BigButton
          label={busy === "apple" ? S.loginSigning : S.loginApple}
          color={C.appleBtn}
          textColor={C.appleBtnText}
          disabled={!!busy}
          onPress={loginApple}
          leftNode={<AppleLogo size={20} color={C.appleBtnText} />}
        />
        <BigButton
          label={busy === "guest" ? S.loginSigning : S.loginGuest}
          hint={S.loginGuestHint}
          color={C.secondary}
          dark={!C.isDark}
          disabled={!!busy}
          onPress={loginGuest}
        />
        {notice ? <Text className="text-center text-base text-amber">{notice}</Text> : null}
        <Text className="mt-4 text-center text-sm leading-relaxed text-muted">
          {S.loginNote}
        </Text>
      </View>
    </Screen>
  );
}
