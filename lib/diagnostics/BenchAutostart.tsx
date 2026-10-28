import { useEffect, useRef } from "react";
import Constants from "expo-constants";
import { router, usePathname, useRootNavigationState } from "expo-router";
import { crashSink } from "@/lib/errorReporting";
import { diag } from "./index";
import { benchLaunchHref } from "./benchLaunch";

// Module-level: the error boundary that a crash trips unmounts the bench and everything under it.
crashSink.current = (error, componentStack) => {
  const e = error as { message?: unknown; stack?: unknown } | null;
  diag({ k: "crash", t: performance.now(), message: String(e?.message ?? error).slice(0, 500), stack: typeof e?.stack === "string" ? e.stack.slice(0, 3000) : undefined, componentStack: componentStack?.slice(0, 3000) });
};

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
