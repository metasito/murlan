import { AccessibilityInfo, Platform } from 'react-native';
import { useState, useEffect, useSyncExternalStore } from 'react';

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

/** True when the OS (or browser) has asked for reduced motion. */
function useSystemReducedMotion(): boolean {
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    let mounted = true;

    if (Platform.OS === 'web') {
      if (typeof window === 'undefined' || !window.matchMedia) return;
      const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
      setReduceMotion(mq.matches);

      const handler = (e: MediaQueryListEvent) => setReduceMotion(e.matches);
      try {
        mq.addEventListener('change', handler);
        return () => mq.removeEventListener('change', handler);
      } catch {
        // Fallback for older browsers
        mq.addListener(handler);
        return () => mq.removeListener(handler);
      }
    }

    // Native: read the current value, then subscribe to changes.
    AccessibilityInfo.isReduceMotionEnabled()
      .then((v) => {
        if (mounted) setReduceMotion(v);
      })
      .catch(() => {});

    const sub = AccessibilityInfo.addEventListener(
      'reduceMotionChanged',
      (v: boolean) => setReduceMotion(v)
    );

    return () => {
      mounted = false;
      sub?.remove();
    };
  }, []);

  return reduceMotion;
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
  if (preference === 'on') return true;
  if (preference === 'off') return false;
  return system;
}
