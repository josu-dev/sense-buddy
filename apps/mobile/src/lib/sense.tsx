import { router, usePathname } from "expo-router";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useBuddyStore } from "./store";

export type SenseTab = "see" | "listen";
export type SenseCapture = "live" | "manual";

type SenseValue = {
  /** Active canonical tab, derived from the route — never from global mode (no flash). */
  tab: SenseTab;
  goSee: () => void;
  goListen: () => void;
  /** Listen capture mode lives in the layout so it survives tab switches. */
  listenCapture: SenseCapture;
  setListenCapture: (c: SenseCapture) => void;
};

const SenseCtx = createContext<SenseValue | null>(null);

export function useSense(): SenseValue {
  const v = useContext(SenseCtx);
  if (!v) throw new Error("useSense must be used inside <SenseProvider> (sense/_layout)");
  return v;
}

/**
 * Shared state for sense/see + sense/listen. Mounted once in sense/_layout,
 * persists across tab switches (Tabs keeps the layout mounted).
 *
 * - `tab` comes from the route, so screens never re-render mid-transition
 *   because a global flipped before navigation committed (the old flash).
 * - Global `mode` (user preference / default tab) is synced AFTER the tab
 *   commits, and no sense screen subscribes to it for layout — so the sync
 *   causes zero repaint inside sense/.
 */
export function SenseProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const tab: SenseTab = pathname.endsWith("/listen") ? "listen" : "see";
  const mode = useBuddyStore((s) => s.mode);
  const setMode = useBuddyStore((s) => s.setMode);
  const [listenCapture, setListenCapture] = useState<SenseCapture>("live");

  useEffect(() => {
    const want = tab === "see" ? "visual" : "hearing";
    if (mode !== want) setMode(want);
  }, [tab, mode, setMode]);

  const goSee = useCallback(() => {
    if (!pathname.endsWith("/sense/see")) router.navigate("/sense/see" as never);
  }, [pathname]);
  const goListen = useCallback(() => {
    if (!pathname.endsWith("/sense/listen")) router.navigate("/sense/listen" as never);
  }, [pathname]);

  const value = useMemo(
    () => ({ tab, goSee, goListen, listenCapture, setListenCapture }),
    [tab, goSee, goListen, listenCapture],
  );
  return <SenseCtx.Provider value={value}>{children}</SenseCtx.Provider>
}
