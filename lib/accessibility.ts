import { AccessibilityInfo, Platform } from 'react-native';
import { useSyncExternalStore } from 'react';

/**
 * Whether animation is reduced. "system" follows the OS (or browser) setting;
 * the other two override it, because a player who finds the table too busy
 * should not have to change an OS-wide preference to calm one game down.
 */
export type MotionPreference = 'system' | 'on' | 'off';

// Module-level rather than a React context for the same reason
// setSoundsMasterEnabled is: SettingsProvider pushes the value in, and the ~20
// components that already call usePrefersReducedMotion pick it up without any
// of them changing.
let motionPreference: MotionPreference = 'system';
const listeners = new Set<() => void>();

export function setMotionPreference(next: MotionPreference): void {
  if (next === motionPreference) return;
  motionPreference = next;
  listeners.forEach((fn) => fn());
}

export function getMotionPreference(): MotionPreference {
  return motionPreference;
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/**
 * `EXPO_PUBLIC_E2E_REDUCE_MOTION` is set only by `maestro.yml`'s own build step, never by an
 * EAS build or `expo:web:build` — no player build sets it, so this never overrides anyone's
 * own choice. #837: the table's looping decorative animations (the active-turn breathe, the
 * `Gioca` glow) kept a CI emulator painting forever, so Maestro's view-hierarchy fetch on that
 * screen starved for 60-75s against a ~5s baseline everywhere else (#823's measurement).
 * Folding the flag in here, rather than at each animation's own call site, means every looping
 * animation already gated on this hook stops with it — `tests/reducedMotion.test.ts` is what
 * already proves there is no other kind. Read per call, not hoisted to a module constant: a
 * production build never sees this branch at all, since babel-preset-expo inlines the env read
 * to a literal `false` where the variable was never set.
 */
function automationReducedMotion(): boolean {
  return process.env.EXPO_PUBLIC_E2E_REDUCE_MOTION === '1';
}

/**
 * The OS setting, read as a store rather than mirrored into state.
 *
 * Web answers synchronously, so the very first render already has the real
 * value; native's `isReduceMotionEnabled` is a promise, so its answer arrives
 * through the same notification as every change after it, and the snapshot
 * below is what it lands in.
 */
let systemReduceMotion = false;
const systemListeners = new Set<() => void>();

function publishSystemReduceMotion(next: boolean): void {
  if (next === systemReduceMotion) return;
  systemReduceMotion = next;
  systemListeners.forEach((fn) => fn());
}

/** Null where there is no `matchMedia` to ask — server rendering, and old browsers. */
function motionQuery(): MediaQueryList | null {
  if (Platform.OS !== 'web') return null;
  if (typeof window === 'undefined' || !window.matchMedia) return null;
  return window.matchMedia('(prefers-reduced-motion: reduce)');
}

function subscribeSystemReduceMotion(fn: () => void): () => void {
  const mq = motionQuery();
  if (mq) {
    const handler = () => fn();
    try {
      mq.addEventListener('change', handler);
      return () => mq.removeEventListener('change', handler);
    } catch {
      // Fallback for older browsers
      mq.addListener(handler);
      return () => mq.removeListener(handler);
    }
  }

  if (Platform.OS === 'web') return () => {};

  systemListeners.add(fn);
  AccessibilityInfo.isReduceMotionEnabled().then(publishSystemReduceMotion).catch(() => {});
  const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', publishSystemReduceMotion);
  return () => {
    systemListeners.delete(fn);
    sub?.remove();
  };
}

function getSystemReduceMotion(): boolean {
  return motionQuery()?.matches ?? systemReduceMotion;
}

/** Nothing has asked for reduced motion before there is a window to ask. */
function getSystemReduceMotionServer(): boolean {
  return false;
}

/** True when the OS (or browser) has asked for reduced motion. */
function useSystemReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribeSystemReduceMotion,
    getSystemReduceMotion,
    getSystemReduceMotionServer
  );
}

/**
 * True when animation should be reduced — the player's own choice if they made
 * one, otherwise the OS setting. Callers must use this to skip infinite or
 * looping animations.
 */
export function usePrefersReducedMotion(): boolean {
  const system = useSystemReducedMotion();
  const preference = useSyncExternalStore(
    subscribe,
    getMotionPreference,
    getMotionPreference
  );
  if (automationReducedMotion()) return true;
  if (preference === 'on') return true;
  if (preference === 'off') return false;
  return system;
}
