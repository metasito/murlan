import { Platform } from "react-native";
import Constants from "expo-constants";
import { apiRequest } from "@/lib/query-client";

const MESSAGE_MAX = 500;
const STACK_MAX = 4000;
const SCREEN_MAX = 120;
/** Two reports of the same thing inside this window are one report. */
const DEDUP_MS = 10_000;

const APP_VERSION = Constants.expoConfig?.version ?? undefined;

let currentScreen: string | undefined;

/** The route a crash happened on. Pushed from the router, read at report time. */
export function setCurrentScreen(screen: string | undefined): void {
  currentScreen = screen;
}

// A handler that reports the error its own reporting threw never stops. The
// server's errorReportLimiter bounds how much traffic that produces, not the
// loop itself, so the loop has to be impossible here.
let reporting = false;

const reportedErrors = new WeakSet<object>();
const reportedSignatures = new Map<string, number>();

/**
 * A global handler and the error boundary both see the same throw, so the same
 * Error object must report once. Identical errors thrown from a render loop are
 * distinct objects, which is what the signature window is for.
 */
function alreadyReported(error: unknown, signature: string, now: number): boolean {
  if (typeof error === "object" && error !== null) {
    if (reportedErrors.has(error)) return true;
    reportedErrors.add(error);
  }
  for (const [seen, at] of reportedSignatures) {
    if (now - at > DEDUP_MS) reportedSignatures.delete(seen);
  }
  if (reportedSignatures.has(signature)) return true;
  reportedSignatures.set(signature, now);
  return false;
}

/** The schema accepts these three and rejects anything else. */
function reportablePlatform(): "ios" | "android" | "web" | undefined {
  return Platform.OS === "ios" || Platform.OS === "android" || Platform.OS === "web"
    ? Platform.OS
    : undefined;
}

/**
 * Sends one crash to `/api/client-errors`, or decides not to. Never throws and
 * never rejects: every caller is either a global error handler or a component
 * already displaying a crash, and both make the failure worse by failing.
 *
 * Returns whether it sent, which is the only way a test can tell "deduplicated"
 * from "silently broken".
 */
export function reportError(error: unknown, componentStack?: string): boolean {
  if (reporting) return false;
  reporting = true;
  try {
    const thrown = error as { message?: unknown; stack?: unknown } | null | undefined;
    const message =
      String(thrown?.message ?? error ?? "unknown").slice(0, MESSAGE_MAX) || "unknown";
    const stack = typeof thrown?.stack === "string" ? thrown.stack.slice(0, STACK_MAX) : undefined;
    if (alreadyReported(error, `${message} @@ ${stack ?? ""}`, Date.now())) return false;

    void apiRequest("POST", "/api/client-errors", {
      message,
      stack,
      componentStack: componentStack?.slice(0, STACK_MAX),
      screen: currentScreen?.slice(0, SCREEN_MAX),
      platform: reportablePlatform(),
      appVersion: APP_VERSION,
    }).catch(() => {});
    return true;
  } catch {
    return false;
  } finally {
    reporting = false;
  }
}

type GlobalHandler = (error: unknown, isFatal?: boolean) => void;
type ReactNativeErrorUtils = {
  getGlobalHandler?: () => GlobalHandler | undefined;
  setGlobalHandler?: (handler: GlobalHandler) => void;
};

/**
 * Catches what the error boundary cannot: rejected promises, and throws from
 * event handlers, socket callbacks and timers. Returns its own teardown.
 */
export function installGlobalErrorHandlers(): () => void {
  if (Platform.OS === "web") {
    if (typeof window === "undefined") return () => {};
    const onError = (event: ErrorEvent) => {
      reportError(event.error ?? event.message);
    };
    const onRejection = (event: PromiseRejectionEvent) => {
      reportError(event.reason);
    };
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }

  const errorUtils = (globalThis as { ErrorUtils?: ReactNativeErrorUtils }).ErrorUtils;
  if (!errorUtils?.setGlobalHandler) return () => {};
  const previous = errorUtils.getGlobalHandler?.();
  errorUtils.setGlobalHandler((error, isFatal) => {
    reportError(error);
    // Chained, not replaced. React Native's own handler is what shows the dev
    // red box and ends a fatal; dropping it swallows both.
    previous?.(error, isFatal);
  });
  return () => {
    if (previous) errorUtils.setGlobalHandler?.(previous);
  };
}

/** Test seam: the module holds dedup state across a whole app run. */
export function resetErrorReportingForTests(): void {
  currentScreen = undefined;
  reporting = false;
  reportedSignatures.clear();
}
