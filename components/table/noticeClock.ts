import { defineAnimation, type AnimationObject } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";

type Clocked = AnimationObject & { from: number };

/**
 * `inner`, reporting each run's length in UI frame time: the frame it finished on less the time it
 * started. A repeat hands its reversed target and reduce-motion setting to this wrapper, so both
 * are passed on to `inner` at each start.
 */
export function clocked<T>(inner: T, report: (ms: number) => void): T {
  "worklet";
  return defineAnimation<Clocked, AnimationObject>(inner as unknown as AnimationObject, () => {
    "worklet";
    const next: AnimationObject = typeof inner === "function" ? inner() : inner;
    return {
      isHigherOrder: true,
      from: 0,
      current: next.current,
      callback: next.callback,
      onStart(animation: Clocked, value: unknown, now: number, previous: unknown) {
        animation.from = now;
        if (animation.toValue !== undefined) next.toValue = animation.toValue;
        if (next.reduceMotion === undefined) next.reduceMotion = animation.reduceMotion;
        next.onStart(next, value, now, previous);
        animation.current = next.current;
      },
      onFrame(animation: Clocked, now: number) {
        const done = next.onFrame(next, now);
        animation.current = next.current;
        if (done) scheduleOnRN(report, now - animation.from);
        return done;
      },
    };
  }) as unknown as T;
}
