import type { Href } from "expo-router";

export const isBenchHost = (host: unknown): host is string => typeof host === "string" && /^\d{1,3}(\.\d{1,3}){3}$/.test(host);

export function benchTargetHost(param: string | undefined, domain: string | undefined): string | null {
  const host = param ?? (domain ? new URL(domain).hostname : "127.0.0.1");
  return isBenchHost(host) ? host : null;
}

const SCENARIO_NAME = /^[A-Za-z][A-Za-z0-9]*$/;

export function benchLaunchHref(extra: unknown): Href | null {
  const { benchHost: host, benchSkip } = (extra ?? {}) as { benchHost?: unknown; benchSkip?: unknown };
  if (!isBenchHost(host)) return null;
  const skip = Array.isArray(benchSkip) ? benchSkip.filter((n): n is string => typeof n === "string" && SCENARIO_NAME.test(n)) : [];
  return `/bench?host=${host}&scenario=all${skip.length ? `&skip=${skip.join(",")}` : ""}` as Href;
}
