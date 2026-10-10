import { useCallback, useEffect, useState } from "react";
import { useSharedValue, withDelay, withTiming, type SharedValue } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { usePrefersReducedMotion } from "@/lib/accessibility";
import { Handoff } from "@/lib/tokens";

/**
 * A turn clock across a hand-off: `shown` is `clock` while there is one, then the last one, held
 * while it fades out; a clock arriving waits out the leaving one's fade, so the table never draws
 * two. `key` says when a clock still on has changed.
 */
export function useClockFade<T>(clock: T | null, key: (c: T) => string): { shown: T | null; opacity: SharedValue<number> } {
  const reduced = usePrefersReducedMotion();
  const on = clock !== null;
  const [held, setHeld] = useState({ on, last: clock, leaving: false });
  if (on !== held.on || (clock !== null && (held.last === null || key(clock) !== key(held.last)))) {
    setHeld({ on, last: clock ?? held.last, leaving: !on && !reduced });
  }
  // Unmounting hides a clock under reduced motion, so its opacity stays at 1 for the next to mount at.
  const opacity = useSharedValue(on || reduced ? 1 : 0);
  const gone = useCallback(() => setHeld((h) => (h.on ? h : { ...h, leaving: false })), []);
  useEffect(() => {
    if (reduced) opacity.value = 1;
    else if (on) opacity.value = withDelay(Handoff.clockOutMs, withTiming(1, { duration: Handoff.clockInMs }));
    else {
      opacity.value = withTiming(0, { duration: Handoff.clockOutMs }, (finished) => {
        if (finished) scheduleOnRN(gone);
      });
    }
  }, [on, reduced, opacity, gone]);
  return { shown: on ? clock : held.leaving ? held.last : null, opacity };
}
