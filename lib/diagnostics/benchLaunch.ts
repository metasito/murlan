import type { Href } from "expo-router";

export const isBenchHost = (host: unknown): host is string => typeof host === "string" && /^\d{1,3}(\.\d{1,3}){3}$/.test(host);

export function benchTargetHost(param: string | undefined, domain: string | undefined): string | null {
  const host = param ?? (domain ? new URL(domain).hostname : "127.0.0.1");
  return isBenchHost(host) ? host : null;
}

export function benchLaunchHref(extra: unknown): Href | null {
  const host = (extra as { benchHost?: unknown } | null | undefined)?.benchHost;
  return isBenchHost(host) ? (`/bench?host=${host}&scenario=all` as Href) : null;
}
