import { AccessibilityInfo, Platform } from 'react-native';
import { useSyncExternalStore } from 'react';
import { readStoredSettings } from '@/lib/storedSettings';

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
// Reduced until the stored choice is read: a cold start has nothing to go on yet, and a player
// who asked for less motion must not see a burst of it first. Any push wins over the preload.
let motionPreference: MotionPreference = 'on';
let pushed = false;
const listeners = new Set<() => void>();

export function isMotionPreference(v: unknown): v is MotionPreference {
  return v === 'system' || v === 'on' || v === 'off';
}

function publishMotionPreference(next: MotionPreference): void {
  if (next === motionPreference) return;
  motionPreference = next;
  listeners.forEach((fn) => fn());
}

export function setMotionPreference(next: MotionPreference): void {
  pushed = true;
  publishMotionPreference(next);
}

void readStoredSettings().then((stored) => {
  if (pushed) return;
  publishMotionPreference(isMotionPreference(stored?.motion) ? stored.motion : 'system');
});

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
 * animation already gated on this hook stops with it — `tests/ui-rules/reducedMotion.test.ts` is what
 * already proves there is no other kind. Read per call, not hoisted to a module constant: a
 * production build never sees this branch at all, since babel-preset-expo inlines the env read
 * to a literal `false` where the variable was never set.
 */
function automationReducedMotion(): boolean {
  return process.env.EXPO_PUBLIC_E2E_REDUCE_MOTION === '1';
}

/**
 * The OS setting, as a store.
 *
 * Web answers synchronously, so the very first render already has the real
 * value; native's `isReduceMotionEnabled` is a promise, so its answer arrives
 * through the same notification as every change after it, and the snapshot
 * below is what it lands in.
 */
let systemReduceMotion = false;
const systemListeners = new Set<() => void>();
/** Undoes the one platform listener the first subscriber added. */
let releaseSource: (() => void) | undefined;
/**
 * Bumped by every change event and every release, so a query answer that was
 * asked before either cannot overwrite what they brought.
 */
let systemEpoch = 0;

function notifySystem(): void {
  systemListeners.forEach((fn) => fn());
}

function publishSystemReduceMotion(next: boolean): void {
  if (next === systemReduceMotion) return;
  systemReduceMotion = next;
  notifySystem();
}

/**
 * Null where there is no `matchMedia` to ask — server rendering, and old
 * browsers. Held once it exists: every render of every card reads the snapshot
 * through it, and a fresh `MediaQueryList` per read is a parse per read.
 */
let motionQueryOnce: MediaQueryList | null = null;
function motionQuery(): MediaQueryList | null {
  if (motionQueryOnce) return motionQueryOnce;
  if (Platform.OS !== 'web') return null;
  if (typeof window === 'undefined' || !window.matchMedia) return null;
  motionQueryOnce = window.matchMedia('(prefers-reduced-motion: reduce)');
  return motionQueryOnce;
}

function listenToSource(): () => void {
  const mq = motionQuery();
  if (mq) {
    try {
      mq.addEventListener('change', notifySystem);
      return () => mq.removeEventListener('change', notifySystem);
    } catch {
      // Fallback for older browsers
      mq.addListener(notifySystem);
      return () => mq.removeListener(notifySystem);
    }
  }
  if (Platform.OS === 'web') return () => {};

  const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', (next) => {
    systemEpoch += 1;
    publishSystemReduceMotion(next);
  });
  const asked = ++systemEpoch;
  AccessibilityInfo.isReduceMotionEnabled()
    .then((next) => {
      if (asked === systemEpoch) publishSystemReduceMotion(next);
    })
    .catch(() => {});
  return () => sub?.remove();
}

function subscribeSystemReduceMotion(fn: () => void): () => void {
  systemListeners.add(fn);
  if (systemListeners.size === 1) releaseSource = listenToSource();
  return () => {
    if (!systemListeners.delete(fn) || systemListeners.size > 0) return;
    systemEpoch += 1;
    releaseSource?.();
    releaseSource = undefined;
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
