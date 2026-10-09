import { useEffect } from "react";
import { useSharedValue, type SharedValue } from "react-native-reanimated";
import { BombFx } from "@/lib/theme";
import { useLandingReaction } from "@/components/table/useLandingReaction";
import type { LandingSignal } from "@/components/table/useFlightClock";

/**
 * Runs `react` `BombFx.delayMs` after a bomb's contact, the mockup's `later(90, bombFx)`, never for one
 * caught up. `reduced` is read when it fires and withholds it; a later bomb or an unmount cancels a pending one.
 */
export function useBombBeat(landing: SharedValue<LandingSignal>, reduced: boolean, react: (l: LandingSignal) => void): void {
  const still = useSharedValue(reduced);
  const generation = useSharedValue(0);
  useEffect(() => {
    still.set(reduced);
  }, [reduced, still]);
  useEffect(() => () => generation.set((g) => g + 1), [generation]);
  useLandingReaction(landing, (l) => {
    "worklet";
    if (l.tier !== "bomb" || l.catchUp) return;
    const mine = generation.get() + 1;
    generation.set(mine);
    setTimeout(() => {
      if (generation.get() === mine && !still.get()) react(l);
    }, BombFx.delayMs);
  });
}
