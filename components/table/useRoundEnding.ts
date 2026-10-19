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
import { ROUND_IDLE, roundEndingOnsets } from "@/lib/timeline/roundEnding";
import { matchEndingOnsets } from "@/lib/timeline/matchEnding";
import { RoundEnding } from "@/lib/theme";
import type { TableTimeline } from "./tableTimeline";

const { close, settled: roundSettled, glowEnd, pileFade: pileFadeAt } = roundEndingOnsets(0);
const { settled: matchSettled } = matchEndingOnsets(0);

export interface RoundEndingClock {
  /** ms since the landing that ended the round, 0 while that play flies; ROUND_IDLE before any ending. */
  clock: SharedValue<number>;
  pileOpacity: SharedValue<number>;
  /** Jumps a running ending to the settled pill, or a held one to its hold; the next round keeps its own time. */
  skip: () => void;
}

/**
 * Starts the ending once the play that ended the round has landed — `pending()` is read at call
 * time, so this hook must be called after `usePileFlight`, whose effect takes that throw.
 */
export function useRoundEnding({
  ended,
  hold = false,
  match = false,
  timeline,
  pileEmpty,
  onLanded,
}: {
  ended: boolean;
  /** Parks the ending on the open pill, re-ranked, until `ended` goes false. */
  hold?: boolean;
  /** Runs `lib/timeline/matchEnding.ts` instead: it settles on the board, which stays until `ended` goes false. */
  match?: boolean;
  timeline: Pick<TableTimeline, "inFlight" | "landsAt" | "pending">;
  pileEmpty: boolean;
  onLanded?: (landsAt: number) => void;
}): RoundEndingClock {
  const reduceMotion = usePrefersReducedMotion();
  const clock = useSharedValue(ROUND_IDLE);
  const pileOpacity = useSharedValue(1);
  const endedAt = useRef<number | null>(null);
  const started = useRef(false);
  const parked = useRef(false);
  const onLandedRef = useRef(onLanded);
  useEffect(() => {
    onLandedRef.current = onLanded;
  });
  const settled = match ? matchSettled : roundSettled;
  const end = match ? matchSettled : hold ? close : glowEnd;

  const runFrom = useCallback(
    (from: number, to: number) => {
      parked.current = to < glowEnd;
      const at = Math.min(from, to);
      clock.set(at);
      clock.set(withTiming(to, { duration: to - at, easing: Easing.linear, reduceMotion: ReduceMotion.Never }));
    },
    [clock]
  );

  const { inFlight, landsAt, pending } = timeline;
  useEffect(() => {
    if (!ended) {
      if (endedAt.current === null) return;
      endedAt.current = null;
      // The next round comes before the glow has faded: a started ending runs on to its end.
      if (!started.current || match) {
        cancelAnimation(clock);
        clock.set(ROUND_IDLE);
      } else if (parked.current) {
        runFrom(reduceMotion ? Math.max(clock.get(), settled) : clock.get(), glowEnd);
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
    runFrom(reduceMotion ? Math.max(now - t0, Math.min(settled, end)) : now - t0, end);
    if (!match) pileOpacity.set(
      withDelay(
        Math.max(0, t0 + pileFadeAt - now),
        withTiming(0, { duration: RoundEnding.pileFadeFor, reduceMotion: ReduceMotion.Never }),
        ReduceMotion.Never
      )
    );
    onLandedRef.current?.(t0);
  }, [ended, end, settled, match, inFlight, landsAt, pending, reduceMotion, clock, pileOpacity, runFrom]);

  useEffect(() => {
    if (ended || !pileEmpty) return;
    cancelAnimation(pileOpacity);
    pileOpacity.set(1);
  }, [ended, pileEmpty, pileOpacity]);

  const skip = useCallback(() => {
    const to = Math.min(settled, end);
    if (started.current && clock.get() < to) runFrom(to, end);
  }, [clock, end, settled, runFrom]);

  return { clock, pileOpacity, skip };
}
