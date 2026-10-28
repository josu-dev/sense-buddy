import AsyncStorage from "@react-native-async-storage/async-storage";
import type { Mode, OrbState } from "@sense-buddy/shared";
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
};

export type BuddyUser = { id: string; name: string; email: string };

type State = {
  hasOnboarded: boolean;
  user: BuddyUser | null;
  mode: Mode;
  prefs: Prefs;
  orbState: OrbState;
  lastReply: string;
  setMode: (mode: Mode) => void;
  completeOnboarding: (mode: Mode, userName: string) => void;
  signIn: (user: BuddyUser) => void;
  signOut: () => void;
  updatePrefs: (p: Partial<Prefs>) => void;
  setOrbState: (s: OrbState) => void;
  setLastReply: (s: string) => void;
};

export const useBuddyStore = create<State>()(
  persist(
    (set) => ({
      hasOnboarded: false,
      user: null,
      mode: "visual",
      prefs: { userName: "", voiceRate: 1, voicePitch: 1, hapticsEnabled: true, captionSize: "xlarge", highContrast: true },
      orbState: "idle",
      lastReply: "",
      setMode: (mode) => set({ mode }),
      completeOnboarding: (mode, userName) =>
        set((s) => ({ hasOnboarded: true, mode, prefs: { ...s.prefs, userName } })),
      signIn: (user) => set({ user }),
      signOut: () => set({ user: null }),
      updatePrefs: (p) => set((s) => ({ prefs: { ...s.prefs, ...p } })),
      setOrbState: (orbState) => set({ orbState }),
      setLastReply: (lastReply) => set({ lastReply }),
    }),
    {
      name: "sense-buddy-store",
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (s) => ({ hasOnboarded: s.hasOnboarded, user: s.user, mode: s.mode, prefs: s.prefs }) as State,
    },
  ),
);

/** True once the persisted store has been read from AsyncStorage. */
export function useHydrated() {
  const [hydrated, setHydrated] = useState(useBuddyStore.persist.hasHydrated());
  useEffect(() => useBuddyStore.persist.onFinishHydration(() => setHydrated(true)), []);
  return hydrated;
}
