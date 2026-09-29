import { useState } from "react";
import { useAnimatedReaction, useSharedValue, type SharedValue } from "react-native-reanimated";
import type { LandingSignal } from "./useFlightClock";

/**
 * `react` runs on the UI thread, on the frame the flight clock writes a landing. The last seen
 * `seq` is kept outside the reaction, which Reanimated re-registers whenever a captured value
 * changes: a landing written across a re-registration is neither dropped nor replayed.
 */
export function useLandingReaction(signal: SharedValue<LandingSignal>, react: (l: LandingSignal) => void): void {
  // The reaction's first run is a later UI job, and a flight under reduced motion lands on the
  // mount's first frame: the baseline is the mount's, not whatever that first run finds.
  const [mounted] = useState(() => signal.get().seq);
  const seen = useSharedValue(mounted);
  useAnimatedReaction(
    () => signal.value.seq,
    (seq) => {
      const last = seen.value;
      seen.value = seq;
      if (seq !== last) react(signal.value);
    }
  );
}
