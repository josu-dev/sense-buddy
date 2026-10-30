import AsyncStorage from "@react-native-async-storage/async-storage";
import type { Mode } from "@sense-buddy/shared";
import { useEffect, useState } from "react";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

export type Prefs = {
  userName: string;
  voiceRate: number;
  voicePitch: number;
  hapticsEnabled: boolean;
  captionSize: "large" | "xlarge";
  highContrast: boolean;
  language: "system" | "en" | "es" | "pt" | "fr";
  theme: "system" | "light" | "dark";
  emergencyName: string;
  emergencyPhone: string;
};

export type BuddyUser = { id: string; name: string; email: string };

export type SeeCapture = "live" | "manual";

type State = {
  hasOnboarded: boolean;
  user: BuddyUser | null;
  mode: Mode;
  seeCapture: SeeCapture;
  prefs: Prefs;
  lastReply: string;
  setMode: (mode: Mode) => void;
  setSeeCapture: (c: SeeCapture) => void;
  completeOnboarding: (mode: Mode, userName: string) => void;
  signIn: (user: BuddyUser) => void;
  signOut: () => void;
  updatePrefs: (p: Partial<Prefs>) => void;
  setLastReply: (s: string) => void;
};

export const useBuddyStore = create<State>()(
  persist(
    (set) => ({
      hasOnboarded: false,
      user: null,
      mode: "visual",
      seeCapture: "manual",
      prefs: { userName: "", voiceRate: 1, voicePitch: 1, hapticsEnabled: true, captionSize: "xlarge", highContrast: true, language: "system", theme: "system", emergencyName: "", emergencyPhone: "" },
      lastReply: "",
      setMode: (mode) => set({ mode }),
      setSeeCapture: (seeCapture) => set({ seeCapture }),
      completeOnboarding: (mode, userName) =>
        set((s) => ({ hasOnboarded: true, mode, prefs: { ...s.prefs, userName } })),
      signIn: (user) => set({ user }),
      signOut: () => set({ user: null }),
      updatePrefs: (p) => set((s) => ({ prefs: { ...s.prefs, ...p } })),
      setLastReply: (lastReply) => set({ lastReply }),
    }),
    {
      name: "sense-buddy-store",
      storage: createJSONStorage(() => AsyncStorage),
      // Deep-merge prefs so stores persisted before a key existed (e.g.
      // `theme`) pick up the default instead of reading `undefined`.
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<State>;
        return { ...current, ...p, prefs: { ...current.prefs, ...p.prefs } };
      },
      partialize: (s) => ({ hasOnboarded: s.hasOnboarded, user: s.user, mode: s.mode, seeCapture: s.seeCapture, prefs: s.prefs }) as State,
    },
  ),
);

/** True once the persisted store has been read from AsyncStorage. */
export function useHydrated() {
  const [hydrated, setHydrated] = useState(useBuddyStore.persist.hasHydrated());
  useEffect(() => useBuddyStore.persist.onFinishHydration(() => setHydrated(true)), []);
  return hydrated;
}
