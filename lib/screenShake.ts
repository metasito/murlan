import { useSyncExternalStore } from "react";

// Module-level for the reason lib/accessibility.ts's motion preference is:
// SettingsProvider pushes it in, and the table reads it without a context.
let screenShakeEnabled = true;
const screenShakeListeners = new Set<() => void>();

export function setScreenShakeEnabled(next: boolean): void {
  if (next === screenShakeEnabled) return;
  screenShakeEnabled = next;
  screenShakeListeners.forEach((fn) => fn());
}

function getScreenShakeEnabled(): boolean {
  return screenShakeEnabled;
}

function subscribeScreenShake(fn: () => void): () => void {
  screenShakeListeners.add(fn);
  return () => screenShakeListeners.delete(fn);
}

/** The player's screen-shake setting. Reduced motion is read separately and still wins. */
export function useScreenShakeEnabled(): boolean {
  return useSyncExternalStore(subscribeScreenShake, getScreenShakeEnabled, getScreenShakeEnabled);
}
