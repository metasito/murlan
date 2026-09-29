import { useAnimatedReaction, useSharedValue, type SharedValue } from "react-native-reanimated";
import type { LandingSignal } from "./useFlightClock";

/**
 * `react` runs on the UI thread, on the frame the flight clock writes a landing. The last seen
 * `seq` is kept outside the reaction, which Reanimated re-registers whenever a captured value
 * changes: a landing written across a re-registration is neither dropped nor replayed.
 */
export function useLandingReaction(signal: SharedValue<LandingSignal>, react: (l: LandingSignal) => void): void {
  const seen = useSharedValue<number | null>(null);
  useAnimatedReaction(
    () => signal.value.seq,
    (seq) => {
      const last = seen.value;
      seen.value = seq;
      if (last !== null && seq !== last) react(signal.value);
    }
  );
}
