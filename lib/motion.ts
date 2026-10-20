import { useEffect, useLayoutEffect, useRef } from "react";
import {
  cancelAnimation,
  useSharedValue,
  withRepeat,
  withSequence,
  type ReduceMotion,
  type SharedValue,
} from "react-native-reanimated";
import { usePrefersReducedMotion } from "@/lib/accessibility";

/** A shared value whose animation stops with the component: Reanimated keeps driving one past unmount. */
export function useOwnedValue<T>(initial: T): SharedValue<T> {
  const value = useSharedValue(initial);
  useEffect(() => () => cancelAnimation(value), [value]);
  return value;
}

export interface Loop {
  /** One pass, run again each time it ends. */
  cycle: number;
  /** Plays every other pass backwards instead of jumping back to the start. */
  reverse?: boolean;
  /** Runs once, before the first pass. */
  lead?: number;
  reduceMotion?: ReduceMotion;
}

/**
 * Runs `value` on an endless loop while `loop` is given and the player has not asked for less
 * motion, and cancels it the moment either stops holding, or on unmount. The loop is built when it
 * starts; a new `loop` while one runs restarts it only when `key` changes. Where the value rests
 * when no loop runs is the caller's to set.
 */
export function useLoop(value: SharedValue<number>, loop: (() => Loop) | null, key?: string | number): void {
  const reduceMotion = usePrefersReducedMotion();
  const running = loop !== null && !reduceMotion;
  const latest = useRef(loop);
  useLayoutEffect(() => {
    latest.current = loop;
  });
  useEffect(() => {
    const build = latest.current;
    if (!running || !build) return;
    const { cycle, reverse = false, lead, reduceMotion: mode } = build();
    const repeated = withRepeat(cycle, -1, reverse, undefined, mode);
    value.set(lead === undefined ? repeated : withSequence(lead, repeated));
    return () => cancelAnimation(value);
  }, [running, value, key]);
}

/** `cycle` run `times` times, or null under once: `withRepeat` reads a count of 0 as forever. */
export function repeatTimes(cycle: number, times: number, reverse = false): number | null {
  return times >= 1 ? withRepeat(cycle, times, reverse) : null;
}
