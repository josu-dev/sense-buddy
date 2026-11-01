import { Redirect } from "expo-router";
import { useBuddyStore } from "../../lib/store";

/** Deep-link safety: /sense → mode's canonical tab. */
export default function SenseIndex() {
  const mode = useBuddyStore((s) => s.mode);
  return <Redirect href={mode === "visual" ? "/sense/see" : mode === "hearing" ? "/sense/listen" : "/sense/say"} />;
}
