import { AccessibilityInfo, Platform } from 'react-native';
import { useState, useEffect } from 'react';

/**
 * True when the user has asked the OS (or browser) to reduce motion.
 * Callers must use this to skip infinite/looping animations.
 */
export function usePrefersReducedMotion(): boolean {
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
