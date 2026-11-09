import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  cancelAnimation,
  useFrameCallback,
  useSharedValue,
  withRepeat,
  withSequence,
  type FrameCallback,
  type FrameInfo,
  type ReduceMotion,
  type SharedValue,
} from "react-native-reanimated";
import { isRNRuntime, scheduleOnRN } from "react-native-worklets";
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

/**
 * A frame callback that runs only while it has something to move: `step` returns whether it does, and the callback is
 * released the frame it says no. The returned `wake` registers it again and may be called from either thread, after
 * the write that gave `step` something to do. `awake` is whether it runs from mount.
 */
export function useDuring(step: (frame: FrameInfo) => boolean, awake = false): () => void {
  const dirty = useSharedValue(awake);
  const releasing = useSharedValue(false);
  const span = useSharedValue<number | null>(null);
  const controller = useRef<FrameCallback | null>(null);
  // A wake that lands between a frame saying no and the release reaching here must win.
  const [release] = useState(() => () => {
    releasing.value = false;
    if (!dirty.value) controller.current?.setActive(false);
  });
  const [arm] = useState(() => () => controller.current?.setActive(true));
  const [tick] = useState(() => (frame: FrameInfo) => {
    "worklet";
    // A woken callback's first frame has no previous one; an always-on callback would have had a frame's span.
    const gap = frame.timeSincePreviousFrame;
    if (gap !== null) span.value = gap;
    else if (span.value !== null) frame = { ...frame, timeSincePreviousFrame: span.value };
    if (step(frame)) return;
    dirty.value = false;
    if (releasing.value) return;
    releasing.value = true;
    scheduleOnRN(release);
  });
  const [wake] = useState(() => () => {
    "worklet";
    dirty.value = true;
    if (isRNRuntime()) arm();
    else scheduleOnRN(arm);
  });
  const frames = useFrameCallback(tick, awake);
  useEffect(() => {
    controller.current = frames;
  }, [frames]);
  return wake;
}
