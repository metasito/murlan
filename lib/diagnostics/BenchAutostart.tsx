import { useEffect, useRef } from "react";
import Constants from "expo-constants";
import { router, usePathname, useRootNavigationState } from "expo-router";
import { benchLaunchHref } from "./benchLaunch";

/** A bench install carrying the PC's address starts the run on a plain icon tap (`npm run ios:device -- --gates`). */
export function BenchAutostart() {
  const ready = !!useRootNavigationState()?.key;
  const pathname = usePathname();
  const launched = useRef(false);
  useEffect(() => {
    const href = benchLaunchHref(Constants.expoConfig?.extra);
    if (!ready || !href || launched.current) return;
    launched.current = true;
    if (pathname !== "/bench") router.replace(href);
  }, [ready, pathname]);
  return null;
}
