import { useEffect } from "react";
import { Platform } from "react-native";

let onBack: (() => void) | null = null;
let returning = false;

// Listeners on the window run in the order they were added, and expo-router's useLinking adds its
// own when the navigation container mounts, answering back with a root RESET that drops the screen
// without beforeRemove ever reaching it. app/_layout.tsx imports this module so that it loads, and
// adds this one, first.
if (Platform.OS === "web" && typeof globalThis.addEventListener === "function") {
  globalThis.addEventListener("popstate", (event) => {
    if (!onBack) {
      returning = false;
      return;
    }
    event.stopImmediatePropagation();
    if (returning) {
      returning = false;
      return;
    }
    returning = true;
    globalThis.history.forward();
    onBack();
  });
}

/**
 * While `active`, the browser's back keeps the screen and its URL and calls `onBackPressed`
 * instead; the router never hears it.
 */
export function useBrowserBackGuard(active: boolean, onBackPressed: () => void): void {
  useEffect(() => {
    if (!active) return;
    onBack = onBackPressed;
    return () => {
      if (onBack === onBackPressed) onBack = null;
    };
  }, [active, onBackPressed]);
}
