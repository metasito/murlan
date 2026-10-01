import type { Href } from "expo-router";

export function benchLaunchHref(extra: unknown): Href | null {
  const host = (extra as { benchHost?: unknown } | null | undefined)?.benchHost;
  return typeof host === "string" && /^\d{1,3}(\.\d{1,3}){3}$/.test(host) ? (`/bench?host=${host}&scenario=all` as Href) : null;
}
