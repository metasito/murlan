import { Platform } from 'react-native';
import { useState, useEffect } from 'react';

export function usePrefersReducedMotion(): boolean {
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    if (Platform.OS === 'web') {
      // Web: check CSS media query
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
    // Native: would use AccessibilityInfo.isReduceMotionEnabled() here if available
    // For now, default to false on native (can be enhanced later)
  }, []);

  return reduceMotion;
}
