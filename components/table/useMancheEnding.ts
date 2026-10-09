import { useCallback, useEffect, useRef } from "react";
import {
  cancelAnimation,
  Easing,
  ReduceMotion,
  useSharedValue,
  withDelay,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";
import { usePrefersReducedMotion } from "@/lib/accessibility";
import { MANCHE_IDLE, mancheEndingOnsets } from "@/lib/game/mancheEnding";
import { MancheEnding } from "@/lib/theme";
import type { TableTimeline } from "./tableTimeline";

const { settled, glowEnd, pileFade: pileFadeAt } = mancheEndingOnsets(0);

export interface MancheEndingClock {
  /** ms since the landing that ended the manche, 0 while that play flies; MANCHE_IDLE before any ending. */
  clock: SharedValue<number>;
  pileOpacity: SharedValue<number>;
  /** Jumps a running ending to the settled pill; the deal keeps its own time. */
  skip: () => void;
}

/**
 * Starts the ending once the play that ended the manche has landed — `pending()` is read at call
 * time, so this hook must be called after `usePileFlight`, whose effect takes that throw.
 */
export function useMancheEnding({
  ended,
  timeline,
  pileEmpty,
  onLanded,
}: {
  ended: boolean;
  timeline: Pick<TableTimeline, "inFlight" | "landsAt" | "pending">;
  pileEmpty: boolean;
  onLanded?: (landsAt: number) => void;
}): MancheEndingClock {
  const reduceMotion = usePrefersReducedMotion();
  const clock = useSharedValue(MANCHE_IDLE);
  const pileOpacity = useSharedValue(1);
  const endedAt = useRef<number | null>(null);
  const started = useRef(false);
  const onLandedRef = useRef(onLanded);
  useEffect(() => {
    onLandedRef.current = onLanded;
  });

  const runFrom = useCallback(
    (from: number) => {
      clock.set(from);
      clock.set(
        withTiming(glowEnd, { duration: Math.max(0, glowEnd - from), easing: Easing.linear, reduceMotion: ReduceMotion.Never })
      );
    },
    [clock]
  );

  const { inFlight, landsAt, pending } = timeline;
  useEffect(() => {
    if (!ended) {
      if (endedAt.current === null) return;
      endedAt.current = null;
      // The deal comes before the glow has faded: a started ending runs on to its end.
      if (!started.current) {
        cancelAnimation(clock);
        clock.set(MANCHE_IDLE);
      }
      started.current = false;
      return;
    }
    if (endedAt.current === null) {
      endedAt.current = performance.now();
      cancelAnimation(clock);
      clock.set(0);
    }
    if (started.current || inFlight || pending()) return;
    started.current = true;
    // A landing older than the ending is an earlier play's: nothing flew for this one.
    const t0 = Math.max(landsAt ?? 0, endedAt.current);
    const now = performance.now();
    runFrom(reduceMotion ? Math.max(now - t0, settled) : now - t0);
    pileOpacity.set(
      withDelay(
        Math.max(0, t0 + pileFadeAt - now),
        withTiming(0, { duration: MancheEnding.pileFadeFor, reduceMotion: ReduceMotion.Never }),
        ReduceMotion.Never
      )
    );
    onLandedRef.current?.(t0);
  }, [ended, inFlight, landsAt, pending, reduceMotion, clock, pileOpacity, runFrom]);

  useEffect(() => {
    if (ended || !pileEmpty) return;
    cancelAnimation(pileOpacity);
    pileOpacity.set(1);
  }, [ended, pileEmpty, pileOpacity]);

  const skip = useCallback(() => {
    const e = clock.get();
    if (started.current && e < settled) runFrom(settled);
  }, [clock, runFrom]);

  return { clock, pileOpacity, skip };
}
