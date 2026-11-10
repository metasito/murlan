import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ViewStyle } from "react-native";
import {
  cancelAnimation,
  cubicBezier,
  type CSSAnimationKeyframes,
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

/** Penner's easeInOutSine as a bezier: within 0.0175 of the move from `Easing.inOut(Easing.sin)`. */
export const SINE_EASE = cubicBezier(0.445, 0.05, 0.55, 0.95);

/** A keyframe set that goes `from` to `to` and back on `SINE_EASE`: one loop is there and back, so it needs no reversed direction. */
export function thereAndBack(from: ViewStyle, to: ViewStyle): CSSAnimationKeyframes {
  return {
    "0%": { ...from, animationTimingFunction: SINE_EASE },
    "50%": { ...to, animationTimingFunction: SINE_EASE },
    "100%": from,
  } as CSSAnimationKeyframes;
}

export interface AmbientSpec {
  /** Opacity or transform keyframes; a module constant, so the engine registers them once. */
  keyframes: CSSAnimationKeyframes;
  /** One pass, in milliseconds. */
  duration: number;
  /** A negative delay starts the loop that far into its pass. */
  delay?: number;
  /** Passes before it rests at its own style; endless when omitted. */
  iterations?: number;
  /** Holds where it stands, and resumes from there. */
  paused?: boolean;
}

/**
 * An endless loop of opacity or transform keyframes, as the style that runs it: a CSS animation on web, Reanimated's
 * C++ engine on native, neither on the JS or UI thread per frame. A style the caller wears on an `Animated.View`.
 */
export function ambient({ keyframes, duration, delay = 0, iterations, paused = false }: AmbientSpec): ViewStyle {
  return {
    animationName: keyframes,
    animationDuration: `${duration}ms`,
    animationIterationCount: iterations ?? "infinite",
    animationTimingFunction: "linear",
    animationDelay: `${delay}ms`,
    animationPlayState: paused ? "paused" : "running",
  } as ViewStyle;
}

/** `ambient` while `spec` is given and the player has not asked for less motion; undefined otherwise, and the view rests at its own style. */
export function useAmbient(spec: AmbientSpec | null): ViewStyle | undefined {
  const reduceMotion = usePrefersReducedMotion();
  const on = spec !== null && !reduceMotion;
  const keyframes = spec?.keyframes;
  const duration = spec?.duration;
  const delay = spec?.delay;
  return useMemo(
    () => (on && keyframes !== undefined && duration !== undefined ? ambient({ keyframes, duration, delay }) : undefined),
    [on, keyframes, duration, delay]
  );
}

/** `cycle` run `times` times, or null under once: `withRepeat` reads a count of 0 as forever. */
export function repeatTimes(cycle: number, times: number, reverse = false): number | null {
  return times >= 1 ? withRepeat(cycle, times, reverse) : null;
}

/**
 * A frame callback that runs only while it has something to move: `step` returns whether it does, and the callback is
 * released the frame it says no. The returned `wake` registers it again and may be called from either thread, after
 * the write that gave `step` something to do. From the JS thread it always registers: its write to `dirty` is queued
 * behind that one, and a frame settling meanwhile must not be left to win. `awake` is whether it runs from mount.
 */
export function useDuring(step: (frame: FrameInfo) => boolean, awake = false): () => void {
  const dirty = useSharedValue(awake);
  const releasing = useSharedValue(false);
  const epoch = useSharedValue(0);
  const span = useSharedValue<number | null>(null);
  const controller = useRef<FrameCallback | null>(null);
  // A wake that lands between a frame saying no and the release reaching here must win, though that frame's own write to `dirty` may land after the wake's: `seen` is the epoch the frame began in.
  const [release] = useState(() => (seen: number) => {
    releasing.value = false;
    if (!dirty.value && epoch.value === seen) controller.current?.setActive(false);
  });
  const [arm] = useState(() => () => controller.current?.setActive(true));
  const [tick] = useState(() => (frame: FrameInfo) => {
    "worklet";
    const seen = epoch.value;
    // A woken callback's first frame has no previous one; an always-on callback would have had a frame's span.
    const gap = frame.timeSincePreviousFrame;
    if (gap !== null) span.value = gap;
    else if (span.value !== null) frame = { ...frame, timeSincePreviousFrame: span.value };
    if (step(frame)) return;
    dirty.value = false;
    if (releasing.value) return;
    releasing.value = true;
    scheduleOnRN(release, seen);
  });
  const [wake] = useState(() => () => {
    "worklet";
    epoch.value += 1;
    if (!isRNRuntime() && dirty.value) return;
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
